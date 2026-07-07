import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router } from '@/server/trpc/trpc';
import { withPermission } from '@/server/trpc/middlewares';
import { hasPermission } from '@/server/services/permissions.service';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import {
  advanceStage,
  cancelOpportunity,
  STAGE_ORDER,
  StageTransitionError,
} from '@/server/services/opportunity-stage.service';
import {
  opportunityCreateInput,
  opportunityUpdateInput,
  opportunityListInput,
  opportunityKanbanInput,
  opportunityAdvanceInput,
  opportunityCancelInput,
  opportunityTeamMemberInput,
} from '@/lib/validators/opportunity';
import { zUuid } from '@/lib/validators';
import { Prisma } from '@prisma/client';

const canRead = withPermission('opportunity:read');
const canCreate = withPermission('opportunity:create');
const canUpdate = withPermission('opportunity:update');
const canAdvance = withPermission('opportunity:advance_stage');
const canCancel = withPermission('opportunity:cancel');

/**
 * Filtro de visibilidade — refatorado no Sprint 15E (§6.4 spec).
 *
 * Antes: gate role-based hardcoded (ADMIN/DIRETOR/GESTOR viam tudo,
 * ANALISTA só própria, PARCEIRO row-level).
 *
 * Sprint 15E: gate por permission única `opportunity:read_others`.
 *
 * Sprint 15G Fase 1b: `opportunity:read_others` foi removida e
 * substituída por duas permissions granulares — `opportunity:read_team`
 * (visão da equipe gerenciada) e `opportunity:read_all` (tenant inteiro).
 * Fase 3 vai wirar o filtro real por team (dependência de SalesUnit da
 * Fase 2). Nesta fase transitória o filtro segue binário: qualquer uma
 * das duas permissions destrava visão tenant-wide. Isso preserva
 * comportamento para ADMIN/DIRETOR_C/DIRETOR_O (têm ambas), DIRETOR_F
 * (só read_all) e GESTOR (só read_team). ANALISTA segue vendo só as
 * próprias — override individual pode conceder read_team ou read_all.
 * PARCEIRO segue com row-level filter (não é permission-based).
 */
async function visibilityWhere(
  userId: string,
  role: string,
  partnerCompanyId: string | null,
): Promise<Prisma.OpportunityWhereInput> {
  if (role === 'PARCEIRO') {
    if (partnerCompanyId) {
      return {
        partnerCompanyId,
        partnerEngagements: {
          some: { partnerCompanyId, status: 'APPROVED' },
        },
      };
    }
    // PARCEIRO sem partnerCompany resolvido → nada
    return { id: '00000000-0000-0000-0000-000000000000' };
  }

  const [canSeeTeam, canSeeAllTenant] = await Promise.all([
    hasPermission(userId, 'opportunity:read_team'),
    hasPermission(userId, 'opportunity:read_all'),
  ]);
  if (canSeeTeam || canSeeAllTenant) return {};
  return {
    OR: [
      { ownerId: userId },
      { team: { some: { userId } } },
    ],
  };
}

export const opportunitiesRouter = router({
  list: canRead.input(opportunityListInput).query(async ({ input, ctx }) => {
    const where: Prisma.OpportunityWhereInput = {
      deletedAt: null,
      ...(await visibilityWhere(ctx.user.id, ctx.user.role, ctx.user.partnerCompanyId)),
      ...(input.stage ? { stage: input.stage } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      ...(input.clientCompanyId ? { clientCompanyId: input.clientCompanyId } : {}),
      ...(input.partnerCompanyId ? { partnerCompanyId: input.partnerCompanyId } : {}),
      ...(input.search
        ? {
            OR: [
              { title: { contains: input.search, mode: 'insensitive' } },
              { clientCompany: { razaoSocial: { contains: input.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.opportunity.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        include: {
          clientCompany: { select: { id: true, razaoSocial: true, nomeFantasia: true } },
          owner: { select: { id: true, fullName: true } },
        },
      }),
      prisma.opportunity.count({ where }),
    ]);
    return { rows, total, page: input.page, pageSize: input.pageSize };
  }),

  /**
   * Kanban: agrupa oportunidades ativas pelos 7 estágios e devolve um dicionário
   * { PROSPECT: [...], LEAD: [...], ... } com cards prontos pro render.
   * Inclui sumário (count + soma de valor) por coluna.
   */
  kanban: canRead.input(opportunityKanbanInput).query(async ({ input, ctx }) => {
    const where: Prisma.OpportunityWhereInput = {
      deletedAt: null,
      status: 'ACTIVE',
      ...(await visibilityWhere(ctx.user.id, ctx.user.role, ctx.user.partnerCompanyId)),
      ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      ...(input.segmentId ? { clientCompany: { segmentId: input.segmentId } } : {}),
      ...(input.territoryId ? { clientCompany: { territoryId: input.territoryId } } : {}),
    };
    const rows = await prisma.opportunity.findMany({
      where,
      orderBy: [{ currentStageEnteredAt: 'asc' }],
      include: {
        clientCompany: { select: { id: true, razaoSocial: true, nomeFantasia: true } },
        owner: { select: { id: true, fullName: true } },
      },
    });

    const columns: Record<
      (typeof STAGE_ORDER)[number],
      { rows: typeof rows; total: number; sumValue: number }
    > = Object.fromEntries(
      STAGE_ORDER.map((s) => [s, { rows: [], total: 0, sumValue: 0 }]),
    ) as never;

    for (const r of rows) {
      const col = columns[r.stage];
      col.rows.push(r);
      col.total += 1;
      col.sumValue += Number(r.estimatedValue ?? 0);
    }
    return { columns };
  }),

  byId: canRead.input(z.object({ id: zUuid })).query(async ({ input, ctx }) => {
    const opp = await prisma.opportunity.findFirst({
      where: {
        id: input.id,
        deletedAt: null,
        ...(await visibilityWhere(ctx.user.id, ctx.user.role, ctx.user.partnerCompanyId)),
      },
      include: {
        clientCompany: true,
        clientContact: true,
        partnerCompany: true,
        owner: { select: { id: true, fullName: true, email: true } },
        team: { include: { user: { select: { id: true, fullName: true, email: true } } } },
        stageHistory: { orderBy: { at: 'desc' }, take: 50 },
      },
    });
    if (!opp) throw new TRPCError({ code: 'NOT_FOUND' });
    return opp;
  }),

  create: canCreate.input(opportunityCreateInput).mutation(async ({ input, ctx }) => {
    const opp = await prisma.opportunity.create({
      data: {
        tenantId: ctx.tenantId,
        createdBy: ctx.user.id,
        ...input,
      } as Prisma.OpportunityUncheckedCreateInput,
    });
    await prisma.opportunityStageHistory.create({
      data: {
        tenantId: ctx.tenantId,
        opportunityId: opp.id,
        fromStage: null,
        toStage: opp.stage,
        movedById: ctx.user.id,
        note: 'Criação',
      } as Prisma.OpportunityStageHistoryUncheckedCreateInput,
    });
    await audit({
      action: 'opportunity.create',
      tableName: 'opportunities',
      recordId: opp.id,
      after: opp,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      tenantIdOverride: ctx.tenantId,
    });
    return opp;
  }),

  update: canUpdate.input(opportunityUpdateInput).mutation(async ({ input, ctx }) => {
    const { id, ...data } = input;
    const before = await prisma.opportunity.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
    const updated = await prisma.opportunity.update({
      where: { id },
      data: { ...data, updatedBy: ctx.user.id } as Prisma.OpportunityUncheckedUpdateInput,
    });
    await audit({
      action: 'opportunity.update',
      tableName: 'opportunities',
      recordId: updated.id,
      before,
      after: updated,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      tenantIdOverride: ctx.tenantId,
    });
    return updated;
  }),

  advanceStage: canAdvance.input(opportunityAdvanceInput).mutation(async ({ input, ctx }) => {
    try {
      return await advanceStage({
        opportunityId: input.id,
        fromStage: input.fromStage,
        toStage: input.toStage,
        userId: ctx.user.id,
        note: input.note,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    } catch (err) {
      if (err instanceof StageTransitionError) {
        if (err.code === 'MISSING_FIELDS') {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: err.message,
            cause: err.details,
          });
        }
        if (err.code === 'NOT_FOUND') throw new TRPCError({ code: 'NOT_FOUND' });
        throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }),

  cancel: canCancel.input(opportunityCancelInput).mutation(async ({ input, ctx }) => {
    await cancelOpportunity({
      opportunityId: input.id,
      reason: input.reason,
      lossReason: input.lossReason,
      userId: ctx.user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: true };
  }),

  // ----- Equipe -----
  team: router({
    add: canUpdate.input(opportunityTeamMemberInput).mutation(async ({ input, ctx }) => {
      const member = await prisma.opportunityTeam.create({
        data: {
          tenantId: ctx.tenantId,
          opportunityId: input.opportunityId,
          userId: input.userId,
          roleInTeam: input.roleInTeam ?? null,
          createdBy: ctx.user.id,
        } as Prisma.OpportunityTeamUncheckedCreateInput,
      });
      await audit({
        action: 'opportunity.team.add',
        tableName: 'opportunity_team',
        recordId: member.id,
        after: member,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return member;
    }),
    remove: canUpdate.input(z.object({ opportunityId: zUuid, userId: zUuid })).mutation(
      async ({ input, ctx }) => {
        const result = await prisma.opportunityTeam.deleteMany({
          where: { opportunityId: input.opportunityId, userId: input.userId },
        });
        if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
        await audit({
          action: 'opportunity.team.remove',
          tableName: 'opportunity_team',
          recordId: input.opportunityId,
          before: { userId: input.userId },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          tenantIdOverride: ctx.tenantId,
        });
        return { ok: true };
      },
    ),
  }),

  history: canRead.input(z.object({ opportunityId: zUuid })).query(async ({ input }) =>
    prisma.opportunityStageHistory.findMany({
      where: { opportunityId: input.opportunityId },
      orderBy: { at: 'desc' },
      include: { movedBy: { select: { id: true, fullName: true } } },
    }),
  ),
});
