import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router } from '@/server/trpc/trpc';
import { withPermission } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { createApprovalsForProposalVersion, getApprovalState } from '@/server/services/approval-engine.service';
import { compareDocumentVersions } from '@/server/services/document-compare.service';
import { zUuid } from '@/lib/validators';
import { ApprovalStatus, Prisma } from '@prisma/client';

const canRead = withPermission('proposal:read');
const canCreate = withPermission('proposal:create');
const canUpdate = withPermission('proposal:update');
const canApprove = withPermission('proposal:approve');

export const proposalsRouter = router({
  listByOpportunity: canRead
    .input(z.object({ opportunityId: zUuid }))
    .query(({ input }) =>
      prisma.proposal.findMany({
        where: { opportunityId: input.opportunityId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            include: {
              approvals: {
                select: {
                  id: true,
                  status: true,
                  approverId: true,
                  approver: { select: { fullName: true, role: true } },
                  comment: true,
                  decidedAt: true,
                },
              },
            },
          },
        },
      }),
    ),

  create: canCreate
    .input(
      z.object({
        opportunityId: zUuid,
        title: z.string().min(2).max(200),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const created = await prisma.proposal.create({
        data: {
          tenantId: ctx.tenantId,
          opportunityId: input.opportunityId,
          title: input.title,
          currentVersion: 0,
          createdBy: ctx.user.id,
        } as Prisma.ProposalUncheckedCreateInput,
      });
      await audit({
        action: 'proposal.create',
        tableName: 'proposals',
        recordId: created.id,
        after: created,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return created;
    }),

  addVersion: canCreate
    .input(
      z.object({
        proposalId: zUuid,
        contentJson: z.unknown(),
        totalValue: z.coerce.number().nonnegative().finite(),
        marginPct: z.coerce.number().min(-100).max(100).optional().nullable(),
        documentKey: z.string().max(500).optional().nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const proposal = await prisma.proposal.findFirst({
        where: { id: input.proposalId, deletedAt: null },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      });
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });

      const nextVersion = (proposal.versions[0]?.version ?? 0) + 1;
      const version = await prisma.proposalVersion.create({
        data: {
          tenantId: ctx.tenantId,
          proposalId: input.proposalId,
          version: nextVersion,
          contentJson: input.contentJson as Prisma.InputJsonValue,
          totalValue: input.totalValue,
          marginPct: input.marginPct ?? null,
          documentKey: input.documentKey ?? null,
          createdBy: ctx.user.id,
        } as Prisma.ProposalVersionUncheckedCreateInput,
      });
      await prisma.proposal.update({
        where: { id: input.proposalId },
        data: { currentVersion: nextVersion, updatedBy: ctx.user.id },
      });

      // Dispara approval engine
      const approvalResult = await createApprovalsForProposalVersion(
        ctx.tenantId,
        version.id,
      );

      await audit({
        action: 'proposal.add_version',
        tableName: 'proposal_versions',
        recordId: version.id,
        after: {
          version: nextVersion,
          totalValue: input.totalValue,
          marginPct: input.marginPct,
          rulesMatched: approvalResult.rulesMatched,
          approvalsCreated: approvalResult.approvalsCreated,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return {
        versionId: version.id,
        version: nextVersion,
        approvals: approvalResult,
      };
    }),

  compareVersions: canUpdate
    .input(
      z.object({
        proposalId: zUuid,
        fromVersion: z.number().int().min(1),
        toVersion: z.number().int().min(1),
        fromText: z.string().max(40000).optional(),
        toText: z.string().max(40000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const proposal = await prisma.proposal.findFirst({
        where: { id: input.proposalId, deletedAt: null },
        include: {
          versions: {
            where: { version: { in: [input.fromVersion, input.toVersion] } },
            select: { version: true, totalValue: true, marginPct: true, contentJson: true },
          },
        },
      });
      if (!proposal || proposal.versions.length !== 2) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      // Diferenças triviais de metadados (sempre incluídas)
      const v1 = proposal.versions.find((v) => v.version === input.fromVersion)!;
      const v2 = proposal.versions.find((v) => v.version === input.toVersion)!;
      const valueDelta = Number(v2.totalValue) - Number(v1.totalValue);
      const marginDelta =
        v1.marginPct && v2.marginPct
          ? Number(v2.marginPct) - Number(v1.marginPct)
          : null;

      const ai = await compareDocumentVersions({
        tenantId: ctx.tenantId,
        userId: ctx.user.id,
        fromVersion: input.fromVersion,
        toVersion: input.toVersion,
        fromText: input.fromText,
        toText: input.toText,
      });

      return {
        metadata: {
          valueDelta,
          valueDeltaPct: Number(v1.totalValue) > 0
            ? Math.round((valueDelta / Number(v1.totalValue)) * 1000) / 10
            : null,
          marginDelta,
        },
        ai,
      };
    }),

  approvalState: canRead
    .input(z.object({ proposalVersionId: zUuid }))
    .query(({ input }) => getApprovalState(input.proposalVersionId)),
});

export const approvalsRouter = router({
  myPending: canApprove.query(({ ctx }) =>
    prisma.approval.findMany({
      where: {
        approverId: ctx.user.id,
        status: ApprovalStatus.PENDING,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        proposalVersion: {
          include: {
            proposal: {
              select: {
                id: true,
                title: true,
                opportunity: {
                  select: { id: true, title: true, clientCompany: { select: { razaoSocial: true } } },
                },
              },
            },
          },
        },
      },
    }),
  ),

  decide: canApprove
    .input(
      z.object({
        id: zUuid,
        decision: z.enum(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']),
        comment: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const before = await prisma.approval.findFirst({
        where: { id: input.id, status: ApprovalStatus.PENDING },
      });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
      if (before.approverId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Você não é o aprovador desta.' });
      }
      const updated = await prisma.approval.update({
        where: { id: input.id },
        data: {
          status: input.decision,
          comment: input.comment ?? null,
          decidedAt: new Date(),
          updatedBy: ctx.user.id,
        } as Prisma.ApprovalUncheckedUpdateInput,
      });
      await audit({
        action: `approval.${input.decision.toLowerCase()}`,
        tableName: 'approvals',
        recordId: updated.id,
        before,
        after: updated,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return updated;
    }),
});
