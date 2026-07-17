import { z } from 'zod';
import { router, protectedProcedure } from '@/server/trpc/trpc';
import { adminOnlyProcedure } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { renewContract } from '@/server/services/contract-renewal.service';
import { dispatchHandoff } from '@/server/services/contract-handoff.service';
import { zUuid, zEmail } from '@/lib/validators';
import { ApprovalRuleCriteria, UserRole, Prisma } from '@prisma/client';

const APPROVER_ROLES = [
  'ADMIN',
  'DIRETOR_COMERCIAL',
  'DIRETOR_FINANCEIRO',
  'GESTOR',
] as const satisfies readonly UserRole[];

export const approvalRulesRouter = router({
  // P-91 — gate admin: regras de aprovação são config sensível
  // (threshold + approvers). Mutations já eram admin.
  list: adminOnlyProcedure.query(({ ctx }) =>
    prisma.approvalRule.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    }),
  ),

  create: adminOnlyProcedure
    .input(
      z.object({
        name: z.string().min(2).max(120),
        criteria: z.nativeEnum(ApprovalRuleCriteria),
        thresholdNumeric: z.coerce.number().nonnegative().finite().optional().nullable(),
        approverRoles: z.array(z.enum(APPROVER_ROLES)).min(1).max(4),
        enabled: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const r = await prisma.approvalRule.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name,
          criteria: input.criteria,
          thresholdNumeric: input.thresholdNumeric ?? null,
          approverRoles: input.approverRoles,
          enabled: input.enabled,
          createdBy: ctx.user.id,
        } as Prisma.ApprovalRuleUncheckedCreateInput,
      });
      await audit({
        action: 'approval_rule.create',
        tableName: 'approval_rules',
        recordId: r.id,
        after: r,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return r;
    }),

  update: adminOnlyProcedure
    .input(
      z.object({
        id: zUuid,
        name: z.string().min(2).max(120).optional(),
        thresholdNumeric: z.coerce.number().nonnegative().finite().optional().nullable(),
        approverRoles: z.array(z.enum(APPROVER_ROLES)).min(1).max(4).optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const updated = await prisma.approvalRule.update({
        where: { id },
        data: { ...data, updatedBy: ctx.user.id } as Prisma.ApprovalRuleUncheckedUpdateInput,
      });
      await audit({
        action: 'approval_rule.update',
        tableName: 'approval_rules',
        recordId: id,
        after: updated,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return updated;
    }),

  remove: adminOnlyProcedure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ input, ctx }) => {
      const updated = await prisma.approvalRule.update({
        where: { id: input.id },
        data: { deletedAt: new Date(), updatedBy: ctx.user.id, enabled: false },
      });
      await audit({
        action: 'approval_rule.delete',
        tableName: 'approval_rules',
        recordId: input.id,
        after: { deleted: true },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return { ok: true, id: updated.id };
    }),
});

export const contractsConfigRouter = router({
  // P-91 — gate admin: config de handoff/renovação (emails do time interno
  // + lead days de contratos). Sensitive.
  getConfig: adminOnlyProcedure.query(async ({ ctx }) => {
    const t = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { handoffEmails: true, contractRenewalLeadDays: true },
    });
    return t ?? { handoffEmails: [], contractRenewalLeadDays: [90, 60, 30] };
  }),

  updateConfig: adminOnlyProcedure
    .input(
      z.object({
        handoffEmails: z.array(zEmail).max(10),
        contractRenewalLeadDays: z.array(z.number().int().min(1).max(365)).min(1).max(6),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await prisma.tenant.update({
        where: { id: ctx.tenantId },
        data: input,
      });
      await audit({
        action: 'tenant.update_contracts_config',
        tableName: 'tenants',
        recordId: ctx.tenantId,
        after: input,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return { ok: true };
    }),

  // ----- Renovação + handoff manual -----
  renew: adminOnlyProcedure
    .input(z.object({ contractId: zUuid }))
    .mutation(({ input, ctx }) =>
      renewContract({ contractId: input.contractId, userId: ctx.user.id }),
    ),

  dispatchHandoff: adminOnlyProcedure
    .input(z.object({ contractId: zUuid }))
    .mutation(async ({ input, ctx }) => {
      const r = await dispatchHandoff(input.contractId);
      await audit({
        action: 'contract.dispatch_handoff',
        tableName: 'contracts',
        recordId: input.contractId,
        after: r,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return r;
    }),

  activeContracts: protectedProcedure.query(({ ctx }) =>
    prisma.contract.findMany({
      where: {
        tenantId: ctx.tenantId,
        deletedAt: null,
        status: { in: ['ACTIVE', 'RENEWED'] },
      },
      orderBy: { endDate: 'asc' },
      include: {
        opportunity: {
          select: {
            id: true,
            title: true,
            clientCompany: { select: { razaoSocial: true } },
          },
        },
        installments: { select: { id: true, status: true, value: true }, orderBy: { number: 'asc' } },
      },
    }),
  ),
});
