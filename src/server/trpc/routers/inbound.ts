import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { router } from '@/server/trpc/trpc';
import { withPermission } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { zUuid } from '@/lib/validators';

/**
 * Sprint 15D — router tRPC `inbound`.
 *
 * Cobre:
 *   - config (get/update/regenerateWebhookSecret)                — admin
 *   - queue (list/count) — /inbox/prospects                       — gestor de inbound
 *   - history (last N leads criados via inbound)                  — gestor de inbound
 *   - rejected (list/retry)                                       — gestor de inbound
 *
 * Todas as mutations passam `tenantIdOverride: ctx.tenantId` no audit
 * (regra do bug audit-trpc-context-loss).
 */

const inboundConfigSelect = {
  tenantId: true,
  emailEnabled: true,
  webhookEnabled: true,
  webhookSecret: true,
  notifyOnArrival: true,
  notifyUserIds: true,
  blacklistDomains: true,
  autoAssignByTerritory: true,
  updatedById: true,
  updatedAt: true,
} as const;

function generateWebhookSecret(): string {
  // 32 bytes hex-encoded = 64 chars. Suficiente pra prevenir brute-force
  // (equivalente a UUIDv4 estendido). Prefixo pra identificação visual.
  return `whs_${randomBytes(32).toString('hex')}`;
}

const canConfigure = withPermission('inbound:configure');
const canViewQueue = withPermission('inbound:view_queue');
// Sprint 15E — antes: `opportunity:set_inbound_owner` (Sprint 15D).
// Agora: permission granular `inbound:assign_prospects`.
const canAssignInbound = withPermission('inbound:assign_prospects');

export const inboundRouter = router({
  // ═════════════════════════════════════════════════════════════════
  // Config
  // ═════════════════════════════════════════════════════════════════

  getConfig: canViewQueue.query(async ({ ctx }) => {
    const config = await prisma.inboundCaptureConfig.findUnique({
      where: { tenantId: ctx.tenantId },
      select: inboundConfigSelect,
    });
    if (config) return config;
    // Nenhum registro ainda — devolve defaults sem persistir (lazy init
    // acontece na primeira mutation `updateConfig`).
    return {
      tenantId: ctx.tenantId,
      emailEnabled: true,
      webhookEnabled: true,
      webhookSecret: null as string | null,
      notifyOnArrival: true,
      notifyUserIds: [] as string[],
      blacklistDomains: [] as string[],
      autoAssignByTerritory: false,
      updatedById: null as string | null,
      updatedAt: new Date(),
    };
  }),

  updateConfig: canConfigure
    .input(
      z.object({
        emailEnabled: z.boolean().optional(),
        webhookEnabled: z.boolean().optional(),
        notifyOnArrival: z.boolean().optional(),
        notifyUserIds: z.array(zUuid).optional(),
        blacklistDomains: z.array(z.string().min(2).max(120)).optional(),
        autoAssignByTerritory: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const before = await prisma.inboundCaptureConfig.findUnique({
        where: { tenantId: ctx.tenantId },
        select: inboundConfigSelect,
      });

      const updated = await prisma.inboundCaptureConfig.upsert({
        where: { tenantId: ctx.tenantId },
        create: {
          tenantId: ctx.tenantId,
          emailEnabled: input.emailEnabled ?? true,
          webhookEnabled: input.webhookEnabled ?? true,
          notifyOnArrival: input.notifyOnArrival ?? true,
          notifyUserIds: input.notifyUserIds ?? [],
          blacklistDomains: input.blacklistDomains ?? [],
          autoAssignByTerritory: input.autoAssignByTerritory ?? false,
          updatedById: ctx.user.id,
        },
        update: {
          ...(input.emailEnabled !== undefined && { emailEnabled: input.emailEnabled }),
          ...(input.webhookEnabled !== undefined && { webhookEnabled: input.webhookEnabled }),
          ...(input.notifyOnArrival !== undefined && { notifyOnArrival: input.notifyOnArrival }),
          ...(input.notifyUserIds !== undefined && { notifyUserIds: input.notifyUserIds }),
          ...(input.blacklistDomains !== undefined && { blacklistDomains: input.blacklistDomains }),
          ...(input.autoAssignByTerritory !== undefined && {
            autoAssignByTerritory: input.autoAssignByTerritory,
          }),
          updatedById: ctx.user.id,
        },
        select: inboundConfigSelect,
      });

      await audit({
        action: 'inbound.config.updated',
        tableName: 'inbound_capture_config',
        recordId: ctx.tenantId,
        before,
        after: { ...updated, webhookSecret: updated.webhookSecret ? 'REDACTED' : null },
        tenantIdOverride: ctx.tenantId,
      });

      return updated;
    }),

  regenerateWebhookSecret: canConfigure.mutation(async ({ ctx }) => {
    const newSecret = generateWebhookSecret();
    const updated = await prisma.inboundCaptureConfig.upsert({
      where: { tenantId: ctx.tenantId },
      create: {
        tenantId: ctx.tenantId,
        webhookSecret: newSecret,
        updatedById: ctx.user.id,
      },
      update: {
        webhookSecret: newSecret,
        updatedById: ctx.user.id,
      },
      select: inboundConfigSelect,
    });

    await audit({
      action: 'inbound.config.webhook_secret_rotated',
      tableName: 'inbound_capture_config',
      recordId: ctx.tenantId,
      // Nunca logamos o secret real — só sinaliza a rotação.
      after: { rotatedAt: new Date().toISOString() },
      tenantIdOverride: ctx.tenantId,
    });

    return updated;
  }),

  // ═════════════════════════════════════════════════════════════════
  // Queue — leads inbound aguardando alocação
  // ═════════════════════════════════════════════════════════════════

  queueList: canViewQueue
    .input(
      z
        .object({
          sourceFilter: z.string().optional(),
          minConfidence: z.number().min(0).max(1).optional(),
          take: z.number().int().min(1).max(200).default(100),
        })
        .default({ take: 100 }),
    )
    .query(async ({ input, ctx }) => {
      return prisma.opportunity.findMany({
        where: {
          tenantId: ctx.tenantId,
          isInbound: true,
          ownerId: null,
          stage: 'PROSPECT',
          deletedAt: null,
          ...(input.sourceFilter && { inboundSource: input.sourceFilter }),
          ...(input.minConfidence !== undefined && {
            inboundConfidence: { gte: input.minConfidence },
          }),
        },
        orderBy: [{ inboundReceivedAt: 'desc' }, { createdAt: 'desc' }],
        take: input.take,
        select: {
          id: true,
          title: true,
          estimatedValue: true,
          expectedCloseDate: true,
          description: true,
          inboundSource: true,
          inboundReceivedAt: true,
          inboundParsedBy: true,
          inboundConfidence: true,
          inboundFormId: true,
          clientCompany: {
            select: { id: true, razaoSocial: true, nomeFantasia: true, cnpj: true },
          },
          clientContact: {
            select: { id: true, fullName: true, email: true, phone: true, position: true },
          },
        },
      });
    }),

  queueCount: canViewQueue.query(async ({ ctx }) => {
    return prisma.opportunity.count({
      where: {
        tenantId: ctx.tenantId,
        isInbound: true,
        ownerId: null,
        stage: 'PROSPECT',
        deletedAt: null,
      },
    });
  }),

  /**
   * Aloca opp inbound a um vendedor. Distinta de opportunities.update pra
   * separar RBAC: aqui usamos opportunity:set_inbound_owner (que
   * GESTOR_INBOUND tem), enquanto o update genérico exige opportunity:update.
   */
  assignInbound: canAssignInbound
    .input(z.object({ opportunityId: zUuid, ownerId: zUuid }))
    .mutation(async ({ input, ctx }) => {
      const opp = await prisma.opportunity.findFirst({
        where: {
          id: input.opportunityId,
          tenantId: ctx.tenantId,
          isInbound: true,
          ownerId: null,
          deletedAt: null,
        },
        select: { id: true, title: true, stage: true },
      });
      if (!opp) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Lead inbound não encontrado ou já foi alocado.',
        });
      }

      const owner = await prisma.user.findFirst({
        where: {
          id: input.ownerId,
          tenantId: ctx.tenantId,
          deletedAt: null,
          active: true,
        },
        select: { id: true, fullName: true, email: true },
      });
      if (!owner) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Vendedor selecionado não é ativo no tenant.',
        });
      }

      const updated = await prisma.opportunity.update({
        where: { id: opp.id },
        data: {
          ownerId: input.ownerId,
          updatedBy: ctx.user.id,
        },
        select: { id: true, ownerId: true, stage: true },
      });

      await audit({
        action: 'opportunity.inbound_assigned',
        tableName: 'opportunities',
        recordId: opp.id,
        after: { ownerId: input.ownerId, assignedBy: ctx.user.id },
        tenantIdOverride: ctx.tenantId,
      });

      return updated;
    }),

  // ═════════════════════════════════════════════════════════════════
  // Sellers (vendedores disponíveis) — pra Popover de alocação
  // ═════════════════════════════════════════════════════════════════

  sellersWithLoad: canViewQueue.query(async ({ ctx }) => {
    // Vendedores que podem receber lead = ADMIN, GESTOR, ANALISTA,
    // DIRETOR_COMERCIAL ativos. Ordenados por count de opps ativas asc.
    const users = await prisma.user.findMany({
      where: {
        tenantId: ctx.tenantId,
        active: true,
        deletedAt: null,
        role: { in: ['ADMIN', 'DIRETOR_COMERCIAL', 'GESTOR', 'ANALISTA'] },
      },
      select: { id: true, fullName: true, email: true, role: true },
    });

    // Contagem em batch — 1 query por user seria N+1
    const loads = await prisma.opportunity.groupBy({
      by: ['ownerId'],
      where: {
        tenantId: ctx.tenantId,
        status: 'ACTIVE',
        deletedAt: null,
        ownerId: { in: users.map((u) => u.id) },
      },
      _count: { _all: true },
    });
    const loadMap = new Map<string, number>();
    for (const l of loads) if (l.ownerId) loadMap.set(l.ownerId, l._count._all);

    return users
      .map((u) => ({ ...u, activeOpps: loadMap.get(u.id) ?? 0 }))
      .sort((a, b) => a.activeOpps - b.activeOpps);
  }),

  // ═════════════════════════════════════════════════════════════════
  // Histórico
  // ═════════════════════════════════════════════════════════════════

  historyList: canViewQueue
    .input(z.object({ take: z.number().int().min(1).max(200).default(30) }).default({ take: 30 }))
    .query(async ({ input, ctx }) => {
      return prisma.opportunity.findMany({
        where: {
          tenantId: ctx.tenantId,
          isInbound: true,
          deletedAt: null,
        },
        orderBy: [{ inboundReceivedAt: 'desc' }, { createdAt: 'desc' }],
        take: input.take,
        select: {
          id: true,
          title: true,
          stage: true,
          status: true,
          inboundSource: true,
          inboundReceivedAt: true,
          inboundParsedBy: true,
          inboundConfidence: true,
          ownerId: true,
          clientCompany: { select: { razaoSocial: true } },
          owner: { select: { fullName: true } },
        },
      });
    }),

  rejectedList: canViewQueue
    .input(
      z
        .object({
          status: z.enum(['pending', 'discarded', 'promoted']).optional(),
          take: z.number().int().min(1).max(200).default(30),
        })
        .default({ take: 30 }),
    )
    .query(async ({ input, ctx }) => {
      return prisma.inboundLeadRejected.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(input.status && { status: input.status }),
        },
        orderBy: { receivedAt: 'desc' },
        take: input.take,
      });
    }),

  rejectedDiscard: canConfigure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ input, ctx }) => {
      const before = await prisma.inboundLeadRejected.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND' });

      await prisma.inboundLeadRejected.update({
        where: { id: input.id },
        data: {
          status: 'discarded',
          reviewedById: ctx.user.id,
          reviewedAt: new Date(),
        },
      });

      await audit({
        action: 'inbound.rejected.discarded',
        tableName: 'inbound_leads_rejected',
        recordId: input.id,
        before: { status: before.status },
        after: { status: 'discarded' },
        tenantIdOverride: ctx.tenantId,
      });

      return { ok: true };
    }),
});
