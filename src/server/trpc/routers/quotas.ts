import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router } from '@/server/trpc/trpc';
import { withPermission, adminOnlyProcedure } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { zUuid, zPositiveDecimal } from '@/lib/validators';
import { env } from '@/lib/env';
import { QuotaService, isValidPeriod } from '@/server/services/quota.service';
import { SalesUnitRepository } from '@/server/db/repositories/sales-unit.repository';

/**
 * Sprint 15H Bloco B (Chip 2b) — router `quotas`: metas por unidade ×
 * período + leitura de progresso (opps WON no subtree ltree da unit).
 *
 * 7 procedures (§4.3 da spec):
 *   - `listByPeriod`   (sales_structure:read)   — metas ativas do tenant no período
 *   - `getByUnit`      (sales_structure:read)   — meta + progresso de 1 unit
 *   - `dashboardTree`  (sales_structure:read)   — árvore + progresso por nível
 *   - `create`         (sales_structure:manage) — cria meta (unit, period)
 *   - `update`         (sales_structure:manage) — edita target/currency
 *   - `delete`         (sales_structure:manage) — soft delete
 *   - `updatePeriodType` (adminOnly)            — muda tenant.quotaPeriodType
 *
 * Regras de arquitetura observadas:
 *  - **RBAC granular (Sprint 15E):** leitura sob `sales_structure:read`,
 *    CRUD sob `sales_structure:manage` (permissions REUSADAS do Sprint 15G —
 *    metas são um atributo da estrutura comercial, não um recurso à parte;
 *    nenhuma permission nova precisou entrar no catálogo). `updatePeriodType`
 *    é config de tenant → `adminOnlyProcedure` (§4.3 "adminOnly").
 *  - **Kill-switch (P-73):** `assertFeatureEnabled()` no topo de cada
 *    procedure. Flag `SALES_QUOTAS_ENABLED=false` → FORBIDDEN genérico
 *    "Recurso indisponível." (feature inerte; rollback = flag OFF). Consumer
 *    runtime único da flag neste chip.
 *  - **Cross-tenant (memory feedback_cross_tenant_leak):** toda query filtra
 *    `tenantId: ctx.tenantId` explícito. Metas/units de outro tenant →
 *    NOT_FOUND (via findFirst por tenantId no service), não FORBIDDEN.
 *  - **Audit (memory audit-trpc-context-loss):** `create`/`update`/`delete`
 *    auditam DENTRO do `QuotaService` com `tenantIdOverride`; `updatePeriodType`
 *    (mutation exclusiva do router) audita aqui com `tenantIdOverride`.
 *  - **A7 (Sprint 15G):** subtree ltree via `SalesUnitRepository` /
 *    `QuotaService` — NUNCA reimplementado aqui.
 */

/** Kill-switch — consumer runtime único da flag (padrão P-73). */
function assertFeatureEnabled(): void {
  if (!env.SALES_QUOTAS_ENABLED) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Recurso indisponível.',
      cause: 'SALES_QUOTAS_ENABLED=false',
    });
  }
}

const canReadStructure = withPermission('sales_structure:read');
const canManageStructure = withPermission('sales_structure:manage');

/**
 * Formato de período validado no boundary do input (mesma regra do service,
 * `isValidPeriod`) — rejeita cedo com mensagem amigável em vez de deixar o
 * `periodToDateRange` lançar lá dentro.
 */
const periodSchema = z
  .string()
  .refine(isValidPeriod, {
    message: 'Período inválido. Use "YYYY-QN", "YYYY-MM", "YYYY-HN" ou "YYYY".',
  });

const QUOTA_PERIOD_TYPES = ['QUARTERLY', 'MONTHLY', 'SEMIANNUAL', 'ANNUAL'] as const;

const createInput = z.object({
  unitId: zUuid,
  period: periodSchema,
  targetValue: zPositiveDecimal,
  currency: z.string().min(3).max(3).optional(),
});

const updateInput = z.object({
  id: zUuid,
  targetValue: zPositiveDecimal.optional(),
  currency: z.string().min(3).max(3).optional(),
});

export const quotasRouter = router({
  // ================================================================
  // Leitura
  // ================================================================

  /** Metas ATIVAS do tenant num período (delega ao service, filtro tenant). */
  listByPeriod: canReadStructure
    .input(z.object({ period: periodSchema }))
    .query(async ({ input, ctx }) => {
      assertFeatureEnabled();
      return QuotaService.listQuotasByPeriod({
        tenantId: ctx.tenantId,
        period: input.period,
      });
    }),

  /**
   * Meta + progresso de UMA unit num período. `target`/`progressPct` vêm
   * null quando não há meta configurada (a UI distingue "sem meta" de
   * "meta zerada"). Cross-tenant → NOT_FOUND (findFirst por tenantId no
   * service).
   */
  getByUnit: canReadStructure
    .input(z.object({ unitId: zUuid, period: periodSchema }))
    .query(async ({ input, ctx }) => {
      assertFeatureEnabled();
      return QuotaService.computeQuotaProgress(
        input.unitId,
        input.period,
        ctx.tenantId,
      );
    }),

  /**
   * Árvore completa do tenant (ltree via Repository) enriquecida com o
   * progresso de cada unit no período — insumo da UI drill-down
   * `/reports/quota-tree` (Fase 3b).
   *
   * Progresso é computado por-nó via `QuotaService.computeQuotaProgress`
   * (reuso — subtree/agregação não são reimplementados). Custo O(N) em
   * queries por árvore; aceitável pro MVP dado que árvores por tenant são
   * pequenas. Otimização em batch fica como débito pra Sprint 15I.
   */
  dashboardTree: canReadStructure
    .input(z.object({ period: periodSchema }))
    .query(async ({ input, ctx }) => {
      assertFeatureEnabled();
      const tree = await SalesUnitRepository.getTree(ctx.tenantId);
      const nodes = await Promise.all(
        tree.map(async (node) => ({
          ...node,
          progress: await QuotaService.computeQuotaProgress(
            node.id,
            input.period,
            ctx.tenantId,
          ),
        })),
      );
      return { period: input.period, nodes };
    }),

  // ================================================================
  // CRUD (audit interno no service com tenantIdOverride)
  // ================================================================

  /**
   * Cria meta pra (unit, period). CONFLICT em duplicata ATIVA (partial
   * UNIQUE `WHERE deleted_at IS NULL`); recriar após soft-delete é OK.
   */
  create: canManageStructure
    .input(createInput)
    .mutation(async ({ input, ctx }) => {
      assertFeatureEnabled();
      return QuotaService.createQuota({
        tenantId: ctx.tenantId,
        unitId: input.unitId,
        period: input.period,
        targetValue: input.targetValue,
        currency: input.currency,
        createdBy: ctx.user.id,
      });
    }),

  /** Edita target/currency de uma meta ativa. Cross-tenant → NOT_FOUND. */
  update: canManageStructure
    .input(updateInput)
    .mutation(async ({ input, ctx }) => {
      assertFeatureEnabled();
      return QuotaService.updateQuota({
        tenantId: ctx.tenantId,
        id: input.id,
        targetValue: input.targetValue,
        currency: input.currency,
      });
    }),

  /** Soft delete de uma meta. Cross-tenant → NOT_FOUND. */
  delete: canManageStructure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ input, ctx }) => {
      assertFeatureEnabled();
      await QuotaService.removeQuota({ tenantId: ctx.tenantId, id: input.id });
      return { ok: true as const };
    }),

  // ================================================================
  // Config de tenant (adminOnly) — mutation exclusiva do router
  // ================================================================

  /**
   * Muda `tenant.quotaPeriodType` (governa o formato de `period` das metas).
   * `adminOnlyProcedure` (§4.3). Filtro `where: { id: ctx.tenantId }` é o
   * cross-tenant guard; audit com `tenantIdOverride` aqui (não passa pelo
   * service).
   */
  updatePeriodType: adminOnlyProcedure
    .input(z.object({ periodType: z.enum(QUOTA_PERIOD_TYPES) }))
    .mutation(async ({ input, ctx }) => {
      assertFeatureEnabled();

      const before = await prisma.tenant.findFirst({
        where: { id: ctx.tenantId },
        select: { quotaPeriodType: true },
      });
      if (!before) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant não encontrado.' });
      }

      const updated = await prisma.tenant.update({
        where: { id: ctx.tenantId },
        data: { quotaPeriodType: input.periodType },
        select: { id: true, quotaPeriodType: true },
      });

      await audit({
        action: 'sales_quota.period_type_updated',
        tableName: 'tenants',
        recordId: ctx.tenantId,
        tenantIdOverride: ctx.tenantId,
        before: { quotaPeriodType: before.quotaPeriodType },
        after: { quotaPeriodType: updated.quotaPeriodType },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return updated;
    }),
});
