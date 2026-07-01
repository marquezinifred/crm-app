import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router } from '@/server/trpc/trpc';
import { withPermission } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { zUuid } from '@/lib/validators';
import { PartnerEngagementStatus, Prisma } from '@prisma/client';

/**
 * Fluxo de engajamento de parceiro em oportunidade (§3.1 / §12 do spec):
 *   1. Gestor interno OU parceiro vincula partnerCompany à oportunidade
 *      → cria PartnerEngagement(status=PENDING_APPROVAL)
 *   2. Responsável interno (GESTOR/DIRETOR_COMERCIAL) aprova ou rejeita
 *   3. Após APPROVED, o parceiro passa a ter visibilidade da oportunidade
 */

const canRequest = withPermission('partner:invite');
// Sprint 15E — antes: `withRoles('ADMIN', 'DIRETOR_COMERCIAL',
// 'DIRETOR_OPERACOES', 'GESTOR')`. Simplificado pra permission granular
// (matriz não concede a GESTOR por default — decisão da revisão PO).
const canApprove = withPermission('partner:approve_engagement');

export const partnerEngagementsRouter = router({
  request: canRequest
    .input(
      z.object({
        opportunityId: zUuid,
        partnerCompanyId: zUuid,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.partnerEngagement.findUnique({
        where: {
          opportunityId_partnerCompanyId: {
            opportunityId: input.opportunityId,
            partnerCompanyId: input.partnerCompanyId,
          },
        },
      });
      if (existing && existing.status !== PartnerEngagementStatus.REJECTED) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Engajamento já existe (status=${existing.status})`,
        });
      }
      const engagement = await prisma.partnerEngagement.upsert({
        where: {
          opportunityId_partnerCompanyId: {
            opportunityId: input.opportunityId,
            partnerCompanyId: input.partnerCompanyId,
          },
        },
        update: {
          status: PartnerEngagementStatus.PENDING_APPROVAL,
          requestedById: ctx.user.id,
          approvedById: null,
          decidedAt: null,
          rejectionReason: null,
        },
        create: {
          tenantId: ctx.tenantId,
          opportunityId: input.opportunityId,
          partnerCompanyId: input.partnerCompanyId,
          status: PartnerEngagementStatus.PENDING_APPROVAL,
          requestedById: ctx.user.id,
        } as Prisma.PartnerEngagementUncheckedCreateInput,
      });
      await audit({
        action: 'partner_engagement.request',
        tableName: 'partner_engagements',
        recordId: engagement.id,
        after: engagement,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return engagement;
    }),

  decide: canApprove
    .input(
      z.object({
        id: zUuid,
        decision: z.enum(['APPROVE', 'REJECT']),
        rejectionReason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const before = await prisma.partnerEngagement.findFirst({
        where: { id: input.id, status: PartnerEngagementStatus.PENDING_APPROVAL },
      });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND' });

      const next =
        input.decision === 'APPROVE'
          ? PartnerEngagementStatus.APPROVED
          : PartnerEngagementStatus.REJECTED;

      const updated = await prisma.partnerEngagement.update({
        where: { id: input.id },
        data: {
          status: next,
          approvedById: ctx.user.id,
          decidedAt: new Date(),
          rejectionReason:
            input.decision === 'REJECT' ? input.rejectionReason ?? null : null,
        },
      });

      // Se aprovado, escreve partnerCompanyId na oportunidade
      if (next === PartnerEngagementStatus.APPROVED) {
        await prisma.opportunity.update({
          where: { id: before.opportunityId },
          data: { partnerCompanyId: before.partnerCompanyId },
        });
      }

      await audit({
        action: `partner_engagement.${input.decision === 'APPROVE' ? 'approve' : 'reject'}`,
        tableName: 'partner_engagements',
        recordId: updated.id,
        before,
        after: updated,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return updated;
    }),

  revoke: canApprove
    .input(z.object({ id: zUuid, reason: z.string().max(500).optional() }))
    .mutation(async ({ input, ctx }) => {
      const before = await prisma.partnerEngagement.findFirst({
        where: { id: input.id, status: PartnerEngagementStatus.APPROVED },
      });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
      const updated = await prisma.partnerEngagement.update({
        where: { id: input.id },
        data: {
          status: PartnerEngagementStatus.REVOKED,
          approvedById: ctx.user.id,
          decidedAt: new Date(),
          rejectionReason: input.reason ?? null,
        },
      });
      // Remove o partner da oportunidade
      await prisma.opportunity.updateMany({
        where: {
          id: before.opportunityId,
          partnerCompanyId: before.partnerCompanyId,
        },
        data: { partnerCompanyId: null },
      });
      await audit({
        action: 'partner_engagement.revoke',
        tableName: 'partner_engagements',
        recordId: updated.id,
        before,
        after: updated,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return updated;
    }),

  listPending: canApprove.query(() =>
    prisma.partnerEngagement.findMany({
      where: { status: PartnerEngagementStatus.PENDING_APPROVAL },
      orderBy: { createdAt: 'desc' },
      include: {
        opportunity: { select: { id: true, title: true } },
        partnerCompany: { select: { id: true, razaoSocial: true } },
        requestedBy: { select: { id: true, fullName: true } },
      },
    }),
  ),
});
