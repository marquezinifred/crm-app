import { z } from 'zod';
import { router, protectedProcedure } from '@/server/trpc/trpc';
import { adminOnlyProcedure, withCapability } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import {
  computeFunnel,
  avgDaysPerStage,
  winLossBreakdown,
  performanceByOwner,
  projectRevenue,
  DEFAULT_CONVERSION_RATES,
  type OpportunitySnap,
} from '@/server/services/analytics.service';
import { suggestConversionRates } from '@/server/services/conversion-rate-suggestion.service';
import { zUuid } from '@/lib/validators';
import { OpportunityStage, Prisma, UserRole } from '@prisma/client';

const filterInput = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  ownerId: zUuid.optional(),
  stage: z.nativeEnum(OpportunityStage).optional(),
  segmentId: zUuid.optional(),
  territoryId: zUuid.optional(),
});

type FilterInput = z.infer<typeof filterInput>;

/**
 * Visibilidade (§7.4): ANALISTA vê só próprias; DIRETOR/GESTOR/ADMIN veem
 * tudo. Para PERFORMANCE, ANALISTA enxerga próprias linhas + média anônima
 * do time (sem detalhe individual de outros).
 */
function visibility(
  role: UserRole,
  userId: string,
  partnerCompanyId: string | null,
): Prisma.OpportunityWhereInput {
  if (
    role === 'SUPER_ADMIN' ||
    role === 'ADMIN' ||
    role === 'DIRETOR_COMERCIAL' ||
    role === 'DIRETOR_FINANCEIRO' ||
    role === 'GESTOR'
  ) {
    return {};
  }
  if (role === 'ANALISTA') {
    return { OR: [{ ownerId: userId }, { team: { some: { userId } } }] };
  }
  if (role === 'PARCEIRO' && partnerCompanyId) {
    return {
      partnerCompanyId,
      partnerEngagements: { some: { partnerCompanyId, status: 'APPROVED' } },
    };
  }
  return { id: '00000000-0000-0000-0000-000000000000' };
}

function whereFromFilters(f: FilterInput): Prisma.OpportunityWhereInput {
  return {
    deletedAt: null,
    ...(f.ownerId ? { ownerId: f.ownerId } : {}),
    ...(f.stage ? { stage: f.stage } : {}),
    ...(f.segmentId ? { clientCompany: { segmentId: f.segmentId } } : {}),
    ...(f.territoryId ? { clientCompany: { territoryId: f.territoryId } } : {}),
    ...(f.from || f.to
      ? {
          createdAt: {
            ...(f.from ? { gte: f.from } : {}),
            ...(f.to ? { lte: f.to } : {}),
          },
        }
      : {}),
  };
}

async function loadOpps(
  role: UserRole,
  userId: string,
  partnerCompanyId: string | null,
  filters: FilterInput,
): Promise<OpportunitySnap[]> {
  const opps = await prisma.opportunity.findMany({
    where: {
      ...visibility(role, userId, partnerCompanyId),
      ...whereFromFilters(filters),
    },
    include: { owner: { select: { fullName: true } } },
  });
  return opps.map((o) => ({
    id: o.id,
    stage: o.stage,
    status: o.status,
    estimatedValue: Number(o.estimatedValue ?? 0),
    closedValue: o.closedValue ? Number(o.closedValue) : null,
    ownerId: o.ownerId,
    ownerName: o.owner?.fullName ?? '—',
    lossReason: o.lossReason,
    createdAt: o.createdAt,
    currentStageEnteredAt: o.currentStageEnteredAt,
    actualCloseDate: o.actualCloseDate,
  }));
}

const canRead = withCapability('opportunity', 'read');

export const reportsRouter = router({
  funnel: canRead.input(filterInput.default({})).query(async ({ input, ctx }) => {
    const opps = await loadOpps(ctx.user.role, ctx.user.id, ctx.user.partnerCompanyId, input);
    return computeFunnel(opps);
  }),

  winLoss: canRead.input(filterInput.default({})).query(async ({ input, ctx }) => {
    const opps = await loadOpps(ctx.user.role, ctx.user.id, ctx.user.partnerCompanyId, input);
    return winLossBreakdown(opps);
  }),

  timePerStage: canRead.input(filterInput.default({})).query(async ({ input, ctx }) => {
    const oppIds = (await loadOpps(ctx.user.role, ctx.user.id, ctx.user.partnerCompanyId, input)).map((o) => o.id);
    if (oppIds.length === 0) {
      return {} as ReturnType<typeof avgDaysPerStage>;
    }
    const history = await prisma.opportunityStageHistory.findMany({
      where: { opportunityId: { in: oppIds } },
      select: { opportunityId: true, fromStage: true, toStage: true, at: true },
    });
    return avgDaysPerStage(history);
  }),

  performanceByOwner: canRead.input(filterInput.default({})).query(async ({ input, ctx }) => {
    const opps = await loadOpps(ctx.user.role, ctx.user.id, ctx.user.partnerCompanyId, input);
    const report = performanceByOwner(opps);
    // ANALISTA: filtra para mostrar apenas a própria linha + manter teamAverage
    if (ctx.user.role === 'ANALISTA') {
      const ownRow = report.rows.find((r) => r.ownerId === ctx.user.id);
      return {
        rows: ownRow ? [ownRow] : [],
        teamAverage: report.teamAverage,
        anonymized: true,
      };
    }
    return { ...report, anonymized: false };
  }),

  revenueProjection: canRead.input(filterInput.default({})).query(async ({ input, ctx }) => {
    const opps = await loadOpps(ctx.user.role, ctx.user.id, ctx.user.partnerCompanyId, input);
    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { conversionRates: true },
    });
    const rates =
      (tenant?.conversionRates as Partial<Record<OpportunityStage, number>> | null) ?? {};
    return projectRevenue(opps, rates);
  }),

  // ----- Conversion rates config -----
  conversionRates: protectedProcedure.query(async ({ ctx }) => {
    const t = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { conversionRates: true },
    });
    return (t?.conversionRates as Record<OpportunityStage, number> | null) ?? DEFAULT_CONVERSION_RATES;
  }),

  updateConversionRates: adminOnlyProcedure
    .input(
      z.object({
        rates: z.record(z.nativeEnum(OpportunityStage), z.number().min(0).max(100)),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await prisma.tenant.update({
        where: { id: ctx.tenantId },
        data: { conversionRates: input.rates as Prisma.InputJsonValue },
      });
      await audit({
        action: 'tenant.update_conversion_rates',
        tableName: 'tenants',
        recordId: ctx.tenantId,
        after: input.rates,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return { ok: true };
    }),

  suggestConversionRates: adminOnlyProcedure.mutation(({ ctx }) =>
    suggestConversionRates(ctx.tenantId, ctx.user.id),
  ),
});
