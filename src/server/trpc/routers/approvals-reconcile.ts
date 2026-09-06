import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { ApprovalStatus, Prisma } from '@prisma/client';
import { router } from '@/server/trpc/trpc';
import { withPermission } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { hasPermission } from '@/server/services/permissions.service';
import { approverSatisfiesRule } from '@/server/services/approval-reconcile.service';
import type { Permission } from '@/lib/auth/permissions-catalog';
import { zUuid } from '@/lib/validators';

/**
 * Sprint 15H Bloco A (chip 2a) — router de reconcile de approvals órfãs (P-77).
 *
 * O worker `approvals-reconcile` (Fase 1) marca approvals PENDING como
 * `ORPHANED` quando o approver fixo não satisfaz mais o critério da rule.
 * Este router dá ao admin a fila dessas órfãs + a reatribuição manual a um
 * approver válido (ORPHANED → PENDING), que devolve a approval ao fluxo
 * normal de `/approvals` do novo responsável.
 *
 * Decisões de arquitetura:
 *  - **RBAC:** leitura (`listOrphaned`, `candidatesForReassign`) gateada por
 *    `approval:reconcile`; a mutação (`reassign`) por `approval:reassign`
 *    (spec §3.5 — split read/manage, padrão Sprint 15E). Ambas em ADMIN e
 *    DIRETOR_COMERCIAL por default; concedíveis a outros via override.
 *  - **Feature flag (spec §3.6 + §9):** `APPROVAL_RECONCILE_ENABLED` controla
 *    o *worker* (que CRIA órfãs). Este router é o recurso manual de rollback
 *    — a spec §9 exige explicitamente que, com a flag OFF, o admin ainda
 *    possa "re-atribuir via UI" as órfãs já marcadas. Por isso a rota é
 *    gateada por *permission*, NÃO pela flag: flag-gate aqui estrangularia o
 *    caminho de rollback. Sob flag OFF nenhuma órfã nova aparece (worker
 *    parado), então a fila fica naturalmente estável.
 *  - **Cross-tenant:** toda query filtra `tenantId: ctx.tenantId` explícito
 *    (memória feedback_cross_tenant_leak); cross-tenant → NOT_FOUND (evita
 *    enumeration), nunca FORBIDDEN.
 *  - **Audit:** `audit({ ..., tenantIdOverride: ctx.tenantId })` na mutation
 *    (bug audit-trpc-context-loss).
 *  - **Reuse da lógica pura:** a validação "novo approver satisfaz a rule?"
 *    delega a `approverSatisfiesRule` (inverso de `evaluateApprovalOrphan`),
 *    a MESMA matriz que o worker usa pra orfanar — zero duplicação.
 *  - **Transição idempotente:** `updateMany WHERE status=ORPHANED` — corrida
 *    com approve/reject/outro reassign não re-transiciona (count !== 1 →
 *    CONFLICT legível).
 */

const canReconcile = withPermission('approval:reconcile');
const canReassign = withPermission('approval:reassign');

export const approvalsReconcileRouter = router({
  /** Fila das approvals ORPHANED do tenant, com contexto pra UI. */
  listOrphaned: canReconcile.query(({ ctx }) =>
    prisma.approval.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: ApprovalStatus.ORPHANED,
        deletedAt: null,
      },
      orderBy: { orphanedAt: 'desc' },
      select: {
        id: true,
        status: true,
        approverId: true,
        orphanedAt: true,
        orphanedReason: true,
        applicableRuleId: true,
        approver: { select: { id: true, fullName: true, role: true, active: true } },
        applicableRule: {
          select: { id: true, name: true, enabled: true, deletedAt: true },
        },
        proposalVersion: {
          select: {
            version: true,
            totalValue: true,
            marginPct: true,
            proposal: {
              select: {
                id: true,
                title: true,
                opportunity: {
                  select: {
                    id: true,
                    title: true,
                    clientCompany: { select: { razaoSocial: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
  ),

  /**
   * Candidatos válidos a reassign de UMA órfã — os users ativos que
   * satisfazem o critério da rule. Lista-hint pra o Select da UI; a mutação
   * `reassign` revalida de forma autoritativa.
   */
  candidatesForReassign: canReconcile
    .input(z.object({ approvalId: zUuid }))
    .query(async ({ input, ctx }) => {
      const approval = await prisma.approval.findFirst({
        where: {
          id: input.approvalId,
          tenantId: ctx.tenantId,
          status: ApprovalStatus.ORPHANED,
          deletedAt: null,
        },
        select: {
          id: true,
          approverId: true,
          applicableRuleId: true,
          applicableRule: {
            select: {
              deletedAt: true,
              enabled: true,
              approverRoles: true,
              approverPermission: true,
            },
          },
        },
      });
      if (!approval) throw new TRPCError({ code: 'NOT_FOUND' });

      const rule = approval.applicableRule;

      // Rule deletada/desabilitada → não há critério a satisfazer; ninguém
      // pode ser reatribuído (recurso é rejeitar, fora do escopo do chip 2a).
      if (rule && (rule.deletedAt || !rule.enabled)) return [];

      const baseWhere: Prisma.UserWhereInput = {
        tenantId: ctx.tenantId,
        active: true,
        deletedAt: null,
        id: { not: approval.approverId },
      };

      let where: Prisma.UserWhereInput;
      if (rule?.approverPermission) {
        where = { ...baseWhere, cachedPermissions: { has: rule.approverPermission } };
      } else if (rule && rule.approverRoles.length > 0) {
        where = { ...baseWhere, role: { in: rule.approverRoles } };
      } else {
        // Sem snapshot da rule (órfã por approver_inactive de approval legada):
        // qualquer aprovador ativo satisfaz. Narrow pro pool natural de
        // aprovadores comerciais (proposal:approve).
        where = { ...baseWhere, cachedPermissions: { has: 'proposal:approve' } };
      }

      return prisma.user.findMany({
        where,
        select: { id: true, fullName: true, role: true },
        orderBy: { fullName: 'asc' },
      });
    }),

  /**
   * Reatribui uma órfã a um novo approver válido (ORPHANED → PENDING).
   * O candidato DEVE satisfazer a rule da approval (reuse da lógica pura).
   */
  reassign: canReassign
    .input(
      z.object({
        approvalId: zUuid,
        newApproverId: zUuid,
        comment: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const approval = await prisma.approval.findFirst({
        where: { id: input.approvalId, tenantId: ctx.tenantId, deletedAt: null },
        select: {
          id: true,
          status: true,
          approverId: true,
          applicableRuleId: true,
          applicableRule: {
            select: {
              deletedAt: true,
              enabled: true,
              approverRoles: true,
              approverPermission: true,
            },
          },
        },
      });
      if (!approval) throw new TRPCError({ code: 'NOT_FOUND' });
      if (approval.status !== ApprovalStatus.ORPHANED) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Esta aprovação não está órfã.',
        });
      }

      const candidate = await prisma.user.findFirst({
        where: { id: input.newApproverId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true, active: true, deletedAt: true, role: true },
      });
      if (!candidate) throw new TRPCError({ code: 'NOT_FOUND' });

      // Resolve a permission só quando a rule é permission-based (evita query
      // extra). Reusa a MESMA checagem do worker de reconcile (lógica pura).
      let approverHasPermission: boolean | null = null;
      if (approval.applicableRule?.approverPermission) {
        approverHasPermission = await hasPermission(
          candidate.id,
          approval.applicableRule.approverPermission as Permission,
        );
      }

      const satisfies = approverSatisfiesRule({
        approver: {
          active: candidate.active,
          deletedAt: candidate.deletedAt,
          role: candidate.role,
        },
        applicableRuleId: approval.applicableRuleId,
        rule: approval.applicableRule,
        approverHasPermission,
      });
      if (!satisfies) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'O aprovador escolhido não satisfaz o critério da regra desta aprovação.',
        });
      }

      // Transição idempotente: só reatribui se AINDA ORPHANED (guarda corrida
      // + reprocessamento). tenantId no WHERE (defesa em profundidade).
      const updated = await prisma.approval.updateMany({
        where: {
          id: approval.id,
          tenantId: ctx.tenantId,
          status: ApprovalStatus.ORPHANED,
        },
        data: {
          status: ApprovalStatus.PENDING,
          approverId: candidate.id,
          orphanedAt: null,
          orphanedReason: null,
          comment: input.comment ?? null,
          decidedAt: null,
          updatedBy: ctx.user.id,
        } as Prisma.ApprovalUncheckedUpdateManyInput,
      });
      if (updated.count !== 1) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A aprovação mudou de estado. Recarregue e tente de novo.',
        });
      }

      await audit({
        action: 'approval.reassigned',
        tableName: 'approvals',
        recordId: approval.id,
        before: { status: ApprovalStatus.ORPHANED, approverId: approval.approverId },
        after: { status: ApprovalStatus.PENDING, approverId: candidate.id },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });

      return {
        id: approval.id,
        approverId: candidate.id,
        status: ApprovalStatus.PENDING,
      };
    }),
});
