import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { router } from '@/server/trpc/trpc';
import { withPermission } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { sendPushToUser } from '@/server/services/push-sender.service';
import { createInboundLead } from '@/server/services/inbound-lead-creator.service';
import { parseLead, type ParsedLead, type ParseSource } from '@/server/services/inbound-parser.service';
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
        select: {
          id: true,
          title: true,
          stage: true,
          clientCompany: { select: { razaoSocial: true } },
        },
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

      // P-31 — Push best-effort pro vendedor alocado. Falha não desfaz a
      // alocação (usuário vê o card no /pipeline mesmo sem push).
      const empresa = opp.clientCompany?.razaoSocial ?? 'Empresa';
      void sendPushToUser(input.ownerId, {
        title: 'Novo prospect atribuído',
        body: `${empresa} — comece a qualificação.`,
        url: `/pipeline/${opp.id}`,
      }).catch((err) => {
        console.warn('[inbound.assignInbound] push falhou (ignorado):', {
          ownerId: input.ownerId,
          opportunityId: opp.id,
          err,
        });
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
          // P-30 — filtro por reason. `parse_error` casa qualquer variante
          // (o service persiste como `parse_error:<name>` do erro original).
          reason: z
            .enum([
              'low_confidence',
              'blacklisted_domain',
              'parse_error',
              'no_signal',
              'rate_limited',
              'rate_limited_per_sender',
            ])
            .optional(),
          take: z.number().int().min(1).max(200).default(30),
        })
        .default({ take: 30 }),
    )
    .query(async ({ input, ctx }) => {
      return prisma.inboundLeadRejected.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(input.status && { status: input.status }),
          ...(input.reason && (
            input.reason === 'parse_error'
              ? { reason: { startsWith: 'parse_error' } }
              : { reason: input.reason }
          )),
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

  // ═════════════════════════════════════════════════════════════════
  // P-30 — Promoção manual + retry parser
  // ═════════════════════════════════════════════════════════════════

  /**
   * Força criação de opp a partir de lead rejeitado — bypassa checks
   * de confidence e blacklist. Requer `parsedJson` presente (rejects
   * sem dados parseados precisam de retry parser antes).
   */
  rejectedPromote: canConfigure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ input, ctx }) => {
      const rejected = await prisma.inboundLeadRejected.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!rejected) throw new TRPCError({ code: 'NOT_FOUND' });
      if (rejected.status !== 'pending') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Lead já foi revisado (promovido ou descartado).',
        });
      }
      if (!rejected.parsedJson) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Lead sem dados parseados. Use "Retry parser" primeiro.',
        });
      }

      const preParsed = reconstructParsedLead(rejected.parsedJson);
      const raw = rejected.rawPayload as string | Record<string, unknown>;

      const result = await createInboundLead({
        tenantId: ctx.tenantId,
        source: rejected.source as ParseSource,
        raw,
        preParsed,
        forcePromoted: true,
        receivedAt: rejected.receivedAt,
      });

      if (result.kind !== 'created') {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Falha ao promover — service devolveu rejected.',
        });
      }

      await prisma.inboundLeadRejected.update({
        where: { id: input.id },
        data: {
          status: 'promoted',
          reviewedById: ctx.user.id,
          reviewedAt: new Date(),
        },
      });

      await audit({
        action: 'inbound.rejected.promoted',
        tableName: 'inbound_leads_rejected',
        recordId: input.id,
        before: { status: rejected.status, reason: rejected.reason },
        after: { status: 'promoted', opportunityId: result.opportunityId },
        tenantIdOverride: ctx.tenantId,
      });

      return { ok: true, opportunityId: result.opportunityId };
    }),

  /**
   * Re-executa parser (útil quando prompt IA foi atualizado ou nova
   * versão do parser saiu). Retorna preview — não altera o registro.
   * Gestor decide separadamente se promove com o novo parsed.
   */
  rejectedRetryParser: canConfigure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ input, ctx }) => {
      const rejected = await prisma.inboundLeadRejected.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!rejected) throw new TRPCError({ code: 'NOT_FOUND' });

      const raw = rejected.rawPayload as string | Record<string, unknown>;
      let parsed: ParsedLead | null;
      try {
        parsed = await parseLead({
          tenantId: ctx.tenantId,
          raw,
          source: rejected.source as ParseSource,
        });
      } catch (err) {
        // Feature gate ou IA falhou — devolve erro estruturado; UI já
        // exibe via friendlyTrpcError.
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Parser falhou: ${err instanceof Error ? err.message : 'unknown'}`,
        });
      }

      await audit({
        action: 'inbound.rejected.retry_parser',
        tableName: 'inbound_leads_rejected',
        recordId: input.id,
        after: {
          confidence: parsed?.confidence ?? null,
          parsedBy: parsed?.parsedBy ?? null,
        },
        tenantIdOverride: ctx.tenantId,
      });

      return {
        parsed,
        wouldPromote: parsed !== null && parsed.confidence >= 0.4,
      };
    }),
});

/**
 * Reconstitui ParsedLead a partir do `parsedJson` persistido. `confidence`
 * foi salva como string por causa do JSON encoding — cast pra number.
 */
function reconstructParsedLead(json: unknown): ParsedLead {
  const obj = (json ?? {}) as Record<string, unknown>;
  const rawConfidence = obj.confidence;
  const confidence =
    typeof rawConfidence === 'number'
      ? rawConfidence
      : typeof rawConfidence === 'string'
        ? Number(rawConfidence)
        : 0;
  return {
    contact: (obj.contact as ParsedLead['contact']) ?? {},
    company: (obj.company as ParsedLead['company']) ?? {},
    interest: (obj.interest as ParsedLead['interest']) ?? {},
    tracking: obj.tracking as Record<string, string> | undefined,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    parsedBy: typeof obj.parsedBy === 'string' ? obj.parsedBy : 'manual_promoted',
  };
}
