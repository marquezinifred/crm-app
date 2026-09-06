import { TRPCError } from '@trpc/server';
import type { SalesQuota } from '@prisma/client';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { SalesUnitRepository } from '@/server/db/repositories/sales-unit.repository';

/**
 * Sprint 15H Bloco B (Chip 1b) — Service base de Metas por Unidade.
 *
 * Escopo deste chip: fundação (migration 0035 + este service). O router
 * completo (7 procedures) vem no Chip 2b e as telas (`/admin/sales-quotas`
 * + `/reports/quota-tree`) nas Fases 3. Nada aqui lê a flag
 * `SALES_QUOTAS_ENABLED` — o gate runtime fica no router/UI (padrão P-73:
 * um único leitor da flag).
 *
 * Multi-tenancy: TODA query filtra `tenantId` explícito (CLAUDE.md §4.1 +
 * memory `cross-tenant-leak-recurrence`). Convenção A7 (Sprint 15G):
 * queries ltree do subtree são delegadas ao `SalesUnitRepository` — nunca
 * reimplementadas aqui. Mutations soft-deletam e auditam com
 * `tenantIdOverride` (memory `audit-trpc-context-loss`).
 */

export interface PeriodRange {
  start: Date;
  end: Date;
}

export interface QuotaProgress {
  unitId: string;
  unitName: string;
  period: string;
  target: number | null;
  actual: number;
  progressPct: number | null;
}

const PERIOD_QUARTER = /^(\d{4})-Q([1-4])$/;
const PERIOD_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const PERIOD_SEMESTER = /^(\d{4})-H([1-2])$/;
const PERIOD_ANNUAL = /^(\d{4})$/;

/**
 * Converte um `period` ("YYYY-QN" | "YYYY-MM" | "YYYY-HN" | "YYYY") no
 * intervalo de datas [start, end] em UTC (end inclusivo, fim do dia).
 * Usado pra filtrar opps WON por `actualCloseDate`. Lança BAD_REQUEST em
 * formato inválido. Função pura (exportada pra teste isolado).
 */
export function periodToDateRange(period: string): PeriodRange {
  const utcStart = (y: number, monthIndex: number) =>
    new Date(Date.UTC(y, monthIndex, 1, 0, 0, 0, 0));
  // Último instante do último dia do mês `monthIndex` (0-based).
  const utcEnd = (y: number, monthIndex: number) =>
    new Date(Date.UTC(y, monthIndex + 1, 0, 23, 59, 59, 999));

  let m: RegExpMatchArray | null;

  if ((m = period.match(PERIOD_QUARTER))) {
    const year = Number(m[1]);
    const q = Number(m[2]); // 1..4
    const startMonth = (q - 1) * 3; // 0,3,6,9
    return { start: utcStart(year, startMonth), end: utcEnd(year, startMonth + 2) };
  }

  if ((m = period.match(PERIOD_MONTH))) {
    const year = Number(m[1]);
    const monthIndex = Number(m[2]) - 1; // 0..11
    return { start: utcStart(year, monthIndex), end: utcEnd(year, monthIndex) };
  }

  if ((m = period.match(PERIOD_SEMESTER))) {
    const year = Number(m[1]);
    const h = Number(m[2]); // 1..2
    const startMonth = (h - 1) * 6; // 0 ou 6
    return { start: utcStart(year, startMonth), end: utcEnd(year, startMonth + 5) };
  }

  if ((m = period.match(PERIOD_ANNUAL))) {
    const year = Number(m[1]);
    return { start: utcStart(year, 0), end: utcEnd(year, 11) };
  }

  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: `Período inválido: "${period}". Use "YYYY-QN", "YYYY-MM", "YYYY-HN" ou "YYYY".`,
  });
}

/** Validação leve de formato de período sem lançar (pra guards de UI/router). */
export function isValidPeriod(period: string): boolean {
  return (
    PERIOD_QUARTER.test(period) ||
    PERIOD_MONTH.test(period) ||
    PERIOD_SEMESTER.test(period) ||
    PERIOD_ANNUAL.test(period)
  );
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

export const QuotaService = {
  /**
   * Progresso de uma meta: soma de `closedValue` das opps WON (status='WON')
   * cujo owner está no subtree da unit, com `actualCloseDate` dentro do
   * período. `target`/`progressPct` são null quando não há meta configurada
   * pra (unit, period) — a UI distingue "sem meta" de "meta zerada".
   *
   * Fonte da verdade do "ganho" é `status='WON'` (não o stage): uma opp
   * ganha continua contando mesmo que o stage-label divirja.
   */
  async computeQuotaProgress(
    unitId: string,
    period: string,
    tenantId: string,
  ): Promise<QuotaProgress> {
    const unit = await prisma.salesUnit.findFirst({
      where: { id: unitId, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!unit) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Unidade não encontrada.',
      });
    }

    const range = periodToDateRange(period);

    const memberIds = await SalesUnitRepository.getSubtreeMemberIdsByUnit(
      unitId,
      tenantId,
    );

    // Sem membros no subtree → 0 (evita `in: []` desnecessário no banco).
    const wonSum =
      memberIds.length === 0
        ? 0
        : toNumber(
            (
              await prisma.opportunity.aggregate({
                where: {
                  tenantId,
                  ownerId: { in: memberIds },
                  status: 'WON',
                  actualCloseDate: { gte: range.start, lte: range.end },
                },
                _sum: { closedValue: true },
              })
            )._sum.closedValue,
          );

    const quota = await prisma.salesQuota.findFirst({
      where: { tenantId, unitId, period, deletedAt: null },
      select: { targetValue: true },
    });

    const target = quota ? toNumber(quota.targetValue) : null;
    const progressPct =
      target && target > 0 ? (wonSum / target) * 100 : null;

    return {
      unitId: unit.id,
      unitName: unit.name,
      period,
      target,
      actual: wonSum,
      progressPct,
    };
  },

  /**
   * Cria uma meta pra (unit, period). Valida período + unit no tenant +
   * ausência de meta ATIVA duplicada (a partial UNIQUE do banco é o
   * backstop; o pré-check dá erro amigável).
   */
  async createQuota(input: {
    tenantId: string;
    unitId: string;
    period: string;
    targetValue: number;
    currency?: string;
    createdBy?: string | null;
  }): Promise<SalesQuota> {
    if (!isValidPeriod(input.period)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Período inválido: "${input.period}". Use "YYYY-QN", "YYYY-MM", "YYYY-HN" ou "YYYY".`,
      });
    }
    if (!(input.targetValue >= 0)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Meta (target) deve ser um valor não negativo.',
      });
    }

    const unit = await prisma.salesUnit.findFirst({
      where: { id: input.unitId, tenantId: input.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!unit) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Unidade não encontrada.' });
    }

    const existing = await prisma.salesQuota.findFirst({
      where: {
        tenantId: input.tenantId,
        unitId: input.unitId,
        period: input.period,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Já existe uma meta ativa para esta unidade neste período.',
      });
    }

    const quota = await prisma.salesQuota.create({
      data: {
        tenantId: input.tenantId,
        unitId: input.unitId,
        period: input.period,
        targetValue: input.targetValue,
        currency: input.currency ?? 'BRL',
        createdBy: input.createdBy ?? null,
      },
    });

    await audit({
      action: 'sales_quota.created',
      tableName: 'sales_quotas',
      recordId: quota.id,
      tenantIdOverride: input.tenantId,
      after: {
        unitId: quota.unitId,
        period: quota.period,
        targetValue: toNumber(quota.targetValue),
        currency: quota.currency,
      },
    });

    return quota;
  },

  /**
   * Atualiza target/currency de uma meta ativa. Cross-tenant guard via
   * `tenantId` no filtro (findFirst) — meta de outro tenant → NOT_FOUND.
   */
  async updateQuota(input: {
    tenantId: string;
    id: string;
    targetValue?: number;
    currency?: string;
  }): Promise<SalesQuota> {
    const existing = await prisma.salesQuota.findFirst({
      where: { id: input.id, tenantId: input.tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Meta não encontrada.' });
    }

    if (input.targetValue !== undefined && !(input.targetValue >= 0)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Meta (target) deve ser um valor não negativo.',
      });
    }

    const quota = await prisma.salesQuota.update({
      where: { id: input.id },
      data: {
        ...(input.targetValue !== undefined ? { targetValue: input.targetValue } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
      },
    });

    await audit({
      action: 'sales_quota.updated',
      tableName: 'sales_quotas',
      recordId: quota.id,
      tenantIdOverride: input.tenantId,
      before: {
        targetValue: toNumber(existing.targetValue),
        currency: existing.currency,
      },
      after: {
        targetValue: toNumber(quota.targetValue),
        currency: quota.currency,
      },
    });

    return quota;
  },

  /** Lista metas ATIVAS do tenant num período, ordenadas por criação. */
  async listQuotasByPeriod(input: {
    tenantId: string;
    period: string;
  }): Promise<SalesQuota[]> {
    return prisma.salesQuota.findMany({
      where: {
        tenantId: input.tenantId,
        period: input.period,
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
  },

  /**
   * Soft delete de uma meta. Cross-tenant guard via `tenantId` no filtro.
   * Idempotência prática: só marca metas ainda ativas (deletedAt null).
   */
  async removeQuota(input: { tenantId: string; id: string }): Promise<void> {
    const existing = await prisma.salesQuota.findFirst({
      where: { id: input.id, tenantId: input.tenantId, deletedAt: null },
      select: { id: true, unitId: true, period: true },
    });
    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Meta não encontrada.' });
    }

    await prisma.salesQuota.update({
      where: { id: input.id },
      data: { deletedAt: new Date() },
    });

    await audit({
      action: 'sales_quota.deleted',
      tableName: 'sales_quotas',
      recordId: existing.id,
      tenantIdOverride: input.tenantId,
      before: { unitId: existing.unitId, period: existing.period },
    });
  },
};
