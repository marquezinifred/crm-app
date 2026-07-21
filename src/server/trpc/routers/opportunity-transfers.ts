import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { TransferStatus } from '@prisma/client';
import { router } from '@/server/trpc/trpc';
import { withPermission, FORBIDDEN_MESSAGE } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { zUuid } from '@/lib/validators';
import { env } from '@/lib/env';
import { TransferScopeService } from '@/server/services/transfer-scope.service';
import {
  notifyTransferEvent,
  type TransferNotificationContext,
} from '@/server/services/transfer-notification.service';

/**
 * Sprint 15G.5 Fase 2a — router `opportunityTransfers` (P-87).
 *
 * Workflow de transferência cross-team de responsabilidade de uma
 * oportunidade. 7 procedures (4 mutations + 3 queries).
 *
 * Regras de arquitetura observadas:
 *  - **T12 (RBAC gate):** TODAS gateadas com `withPermission('opportunity:transfer')`.
 *    A permission é o *interruptor de capacidade*; a autoridade real é o
 *    check estrutural por-opp (`TransferScopeService`), avaliado por cima.
 *  - **T3 (kill-switch):** `assertFeatureEnabled()` no topo de cada
 *    procedure. Flag OFF → FORBIDDEN genérico "Recurso indisponível."
 *    (runtime idêntico ao pré-15G.5; guard de write 2c fica inerte).
 *    Consumer runtime único da flag (padrão P-73).
 *  - **T6 (cross-tenant):** toda query filtra `tenantId: ctx.tenantId`
 *    explícito — NUNCA confia só na Prisma extension (memória
 *    feedback_cross_tenant_leak). Cross-tenant → NOT_FOUND (evita
 *    enumeration), não FORBIDDEN.
 *  - **T4 (audit):** `audit({ ..., tenantIdOverride: ctx.tenantId })` em
 *    toda mutation (bug audit-trpc-context-loss).
 *  - **T5 (notificação best-effort):** `void notifyTransferEvent(...)
 *    .catch(console.warn)` — nunca propaga (padrão inbound-assign-push P-31).
 *  - **T7 (FORBIDDEN genérico):** mensagem única visível (`FORBIDDEN_MESSAGE`)
 *    + detalhe técnico no `cause` string server-side (padrão P-98).
 *  - **T8 (máquina de estado):** revalida `status === 'PENDING'` antes de
 *    qualquer transição.
 *  - **T1 (race):** partial UNIQUE `idx_transfers_active_per_opp` garante
 *    1 PENDING/opp. Segundo request → P2002 → CONFLICT.
 *  - **T10 (anti-escalada):** `approve` valida newOwner ∈ subárvore do
 *    destinatário via `canReceiveAsNewOwner`.
 *  - **T17 (não stageHistory):** `approve` grava a troca de owner em
 *    `audit()` (action `opportunity.owner_transferred`), NUNCA em
 *    `stageHistory` — estágio é preservado (regra 4 §2; sem evento de funil).
 *  - Backstop P-42: `update` não exige tenantId no data (WHERE injection
 *    cobre); `create` injeta tenantId explícito.
 */

const canTransfer = withPermission('opportunity:transfer');

/** T3 — kill-switch. Consumer runtime único da flag. */
function assertFeatureEnabled(): void {
  if (!env.OPPORTUNITY_TRANSFER_ENABLED) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Recurso indisponível.',
      cause: 'OPPORTUNITY_TRANSFER_ENABLED=false',
    });
  }
}

/** T1 — detecta violação de unique constraint (partial UNIQUE de PENDING). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2002'
  );
}

const requestInput = z.object({
  opportunityId: zUuid,
  targetManagerId: zUuid,
  reason: z.string().max(2000).optional(),
});

const approveInput = z.object({
  transferId: zUuid,
  newOwnerId: zUuid,
  decisionReason: z.string().max(2000).optional(),
});

const rejectInput = z.object({
  transferId: zUuid,
  decisionReason: z.string().max(2000).optional(),
});

const cancelInput = z.object({
  transferId: zUuid,
});

/** Select compartilhado — dados da opp p/ compor a notificação. */
const oppNotificationSelect = {
  title: true,
  clientCompany: { select: { razaoSocial: true } },
} as const;

/** Monta o contexto de notificação a partir da row do transfer + opp. */
function buildNotificationContext(row: {
  id: string;
  tenantId: string;
  opportunityId: string;
  requestedById: string;
  originalOwnerId: string;
  targetManagerId: string;
  newOwnerId: string | null;
  reason: string | null;
  decisionReason: string | null;
  opportunity: { title: string; clientCompany: { razaoSocial: string } | null };
}): TransferNotificationContext {
  return {
    tenantId: row.tenantId,
    transferId: row.id,
    opportunityId: row.opportunityId,
    opportunityTitle: row.opportunity.title,
    companyName: row.opportunity.clientCompany?.razaoSocial ?? null,
    requestedById: row.requestedById,
    originalOwnerId: row.originalOwnerId,
    targetManagerId: row.targetManagerId,
    newOwnerId: row.newOwnerId,
    reason: row.reason,
    decisionReason: row.decisionReason,
  };
}

export const opportunityTransfersRouter = router({
  // ================================================================
  // request — disparador inicia a transferência (T1/T4/T5/T7)
  // ================================================================
  request: canTransfer.input(requestInput).mutation(async ({ input, ctx }) => {
    assertFeatureEnabled();

    const opp = await prisma.opportunity.findFirst({
      where: { id: input.opportunityId, tenantId: ctx.tenantId, deletedAt: null },
      select: {
        id: true,
        ownerId: true,
        currentTransferId: true,
        title: true,
        clientCompany: { select: { razaoSocial: true } },
      },
    });
    if (!opp) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Oportunidade não encontrada neste tenant.',
      });
    }
    if (!opp.ownerId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Oportunidade sem responsável definido — nada a transferir.',
      });
    }

    // Autoridade estrutural por-opp (T13): caller é ancestor MANAGER do dono.
    const allowed = await TransferScopeService.canTransferOpportunity(
      ctx.user.id,
      input.opportunityId,
      ctx.tenantId,
    );
    if (!allowed) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: FORBIDDEN_MESSAGE,
        cause: `transfer.request: user=${ctx.user.id} não é ancestor do dono da opp ${input.opportunityId}`,
      });
    }

    // Destino válido (T14): par imediato ou superior direto.
    const validTarget = await TransferScopeService.isValidTransferTarget(
      ctx.user.id,
      input.targetManagerId,
      ctx.tenantId,
    );
    if (!validTarget) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: FORBIDDEN_MESSAGE,
        cause: `transfer.request: target=${input.targetManagerId} não é par/superior de user=${ctx.user.id}`,
      });
    }

    // Pré-check barato do estado PENDING (a partial UNIQUE T1 é a barreira real).
    if (opp.currentTransferId) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Já existe transferência pendente para esta oportunidade.',
      });
    }

    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: ctx.tenantId },
      select: { transferTimeoutHours: true },
    });
    const timeoutHours = settings?.transferTimeoutHours ?? 72;
    const expiresAt = new Date(Date.now() + timeoutHours * 60 * 60 * 1000);

    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        const transfer = await tx.opportunityTransfer.create({
          data: {
            tenantId: ctx.tenantId,
            opportunityId: input.opportunityId,
            requestedById: ctx.user.id,
            originalOwnerId: opp.ownerId!,
            targetManagerId: input.targetManagerId,
            status: TransferStatus.PENDING,
            reason: input.reason ?? null,
            expiresAt,
          },
          include: { opportunity: { select: oppNotificationSelect } },
        });
        await tx.opportunity.update({
          where: { id: input.opportunityId },
          data: { currentTransferId: transfer.id },
        });
        return transfer;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Já existe transferência pendente para esta oportunidade.',
        });
      }
      throw err;
    }

    await audit({
      action: 'opportunity.transfer_requested',
      tableName: 'opportunity_transfers',
      recordId: created.id,
      tenantIdOverride: ctx.tenantId,
      after: {
        opportunityId: created.opportunityId,
        originalOwnerId: created.originalOwnerId,
        targetManagerId: created.targetManagerId,
        requestedById: created.requestedById,
        expiresAt: created.expiresAt,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    void notifyTransferEvent('REQUESTED', buildNotificationContext(created)).catch(
      (err) => console.warn('[transfer.request] notificação falhou (ignorada):', err),
    );

    return created;
  }),

  // ================================================================
  // cancel — disparador cancela a própria pendência (T7/T8)
  // ================================================================
  cancel: canTransfer.input(cancelInput).mutation(async ({ input, ctx }) => {
    assertFeatureEnabled();

    const transfer = await prisma.opportunityTransfer.findFirst({
      where: { id: input.transferId, tenantId: ctx.tenantId },
      include: { opportunity: { select: oppNotificationSelect } },
    });
    if (!transfer) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Transferência não encontrada neste tenant.',
      });
    }
    if (transfer.requestedById !== ctx.user.id) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: FORBIDDEN_MESSAGE,
        cause: `transfer.cancel: user=${ctx.user.id} não é o disparador (requested_by=${transfer.requestedById})`,
      });
    }
    if (transfer.status !== TransferStatus.PENDING) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Transferência não está mais pendente.',
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.opportunityTransfer.update({
        where: { id: transfer.id },
        data: {
          status: TransferStatus.CANCELLED,
          decidedAt: new Date(),
          decidedById: ctx.user.id,
        },
        include: { opportunity: { select: oppNotificationSelect } },
      });
      // Regra 6 §2: opp fica com o disparador (owner_id inalterado). Só
      // liberamos a flag pra o guard de write (2c) parar de bloquear.
      await tx.opportunity.update({
        where: { id: transfer.opportunityId },
        data: { currentTransferId: null },
      });
      return t;
    });

    await audit({
      action: 'opportunity.transfer_cancelled',
      tableName: 'opportunity_transfers',
      recordId: transfer.id,
      tenantIdOverride: ctx.tenantId,
      before: { status: TransferStatus.PENDING },
      after: { status: TransferStatus.CANCELLED },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    void notifyTransferEvent('CANCELLED', buildNotificationContext(updated)).catch(
      (err) => console.warn('[transfer.cancel] notificação falhou (ignorada):', err),
    );

    return updated;
  }),

  // ================================================================
  // approve — destinatário aceita e escolhe novo owner (T8/T10/T17)
  // ================================================================
  approve: canTransfer.input(approveInput).mutation(async ({ input, ctx }) => {
    assertFeatureEnabled();

    const transfer = await prisma.opportunityTransfer.findFirst({
      where: { id: input.transferId, tenantId: ctx.tenantId },
      include: { opportunity: { select: oppNotificationSelect } },
    });
    if (!transfer) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Transferência não encontrada neste tenant.',
      });
    }
    if (transfer.targetManagerId !== ctx.user.id) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: FORBIDDEN_MESSAGE,
        cause: `transfer.approve: user=${ctx.user.id} não é o destinatário (target_manager=${transfer.targetManagerId})`,
      });
    }
    if (transfer.status !== TransferStatus.PENDING) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Transferência não está mais pendente.',
      });
    }

    // T10 — anti-escalada: novo owner precisa estar na subárvore do destinatário.
    const canReceive = await TransferScopeService.canReceiveAsNewOwner(
      ctx.user.id,
      input.newOwnerId,
      ctx.tenantId,
    );
    if (!canReceive) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: FORBIDDEN_MESSAGE,
        cause: `transfer.approve: newOwner=${input.newOwnerId} fora da subárvore do destinatário=${ctx.user.id}`,
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.opportunityTransfer.update({
        where: { id: transfer.id },
        data: {
          status: TransferStatus.APPROVED,
          newOwnerId: input.newOwnerId,
          decidedAt: new Date(),
          decidedById: ctx.user.id,
          decisionReason: input.decisionReason ?? null,
        },
        include: { opportunity: { select: oppNotificationSelect } },
      });
      // Troca de owner + libera a flag. Estágio preservado (T17: NUNCA
      // grava stageHistory — não há evento de funil aqui).
      await tx.opportunity.update({
        where: { id: transfer.opportunityId },
        data: {
          ownerId: input.newOwnerId,
          currentTransferId: null,
          updatedBy: ctx.user.id,
        },
      });
      return t;
    });

    // T17 — a troca de owner vai pra audit + trilha de owner dedicada,
    // nunca pra stageHistory.
    await audit({
      action: 'opportunity.owner_transferred',
      tableName: 'opportunities',
      recordId: transfer.opportunityId,
      tenantIdOverride: ctx.tenantId,
      before: { ownerId: transfer.originalOwnerId },
      after: {
        ownerId: input.newOwnerId,
        transferId: transfer.id,
        decidedById: ctx.user.id,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    void notifyTransferEvent('APPROVED', buildNotificationContext(updated)).catch(
      (err) => console.warn('[transfer.approve] notificação falhou (ignorada):', err),
    );

    return updated;
  }),

  // ================================================================
  // reject — destinatário recusa (T8)
  // ================================================================
  reject: canTransfer.input(rejectInput).mutation(async ({ input, ctx }) => {
    assertFeatureEnabled();

    const transfer = await prisma.opportunityTransfer.findFirst({
      where: { id: input.transferId, tenantId: ctx.tenantId },
      include: { opportunity: { select: oppNotificationSelect } },
    });
    if (!transfer) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Transferência não encontrada neste tenant.',
      });
    }
    if (transfer.targetManagerId !== ctx.user.id) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: FORBIDDEN_MESSAGE,
        cause: `transfer.reject: user=${ctx.user.id} não é o destinatário (target_manager=${transfer.targetManagerId})`,
      });
    }
    if (transfer.status !== TransferStatus.PENDING) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Transferência não está mais pendente.',
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.opportunityTransfer.update({
        where: { id: transfer.id },
        data: {
          status: TransferStatus.REJECTED,
          decidedAt: new Date(),
          decidedById: ctx.user.id,
          decisionReason: input.decisionReason ?? null,
        },
        include: { opportunity: { select: oppNotificationSelect } },
      });
      // Regra 6 §2: opp fica com o disparador (owner inalterado); só libera a flag.
      await tx.opportunity.update({
        where: { id: transfer.opportunityId },
        data: { currentTransferId: null },
      });
      return t;
    });

    await audit({
      action: 'opportunity.transfer_rejected',
      tableName: 'opportunity_transfers',
      recordId: transfer.id,
      tenantIdOverride: ctx.tenantId,
      before: { status: TransferStatus.PENDING },
      after: { status: TransferStatus.REJECTED },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    void notifyTransferEvent('REJECTED', buildNotificationContext(updated)).catch(
      (err) => console.warn('[transfer.reject] notificação falhou (ignorada):', err),
    );

    return updated;
  }),

  // ================================================================
  // queries — filtro tenantId explícito (T6)
  // ================================================================

  /** Fila do destinatário: PENDING onde ele é o target_manager. */
  pendingForMe: canTransfer.query(async ({ ctx }) => {
    assertFeatureEnabled();
    return prisma.opportunityTransfer.findMany({
      where: {
        tenantId: ctx.tenantId,
        targetManagerId: ctx.user.id,
        status: TransferStatus.PENDING,
      },
      include: {
        opportunity: {
          select: {
            id: true,
            title: true,
            estimatedValue: true,
            clientCompany: { select: { id: true, razaoSocial: true } },
          },
        },
        requestedBy: { select: { id: true, fullName: true, email: true } },
        originalOwner: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { expiresAt: 'asc' },
    });
  }),

  /** Acompanhamento do disparador: transfers que ele iniciou (filtro opcional por status). */
  myOutgoing: canTransfer
    .input(z.object({ status: z.nativeEnum(TransferStatus).optional() }).optional())
    .query(async ({ input, ctx }) => {
      assertFeatureEnabled();
      return prisma.opportunityTransfer.findMany({
        where: {
          tenantId: ctx.tenantId,
          requestedById: ctx.user.id,
          ...(input?.status ? { status: input.status } : {}),
        },
        include: {
          opportunity: {
            select: {
              id: true,
              title: true,
              estimatedValue: true,
              clientCompany: { select: { id: true, razaoSocial: true } },
            },
          },
          targetManager: { select: { id: true, fullName: true, email: true } },
          originalOwner: { select: { id: true, fullName: true, email: true } },
          newOwner: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { requestedAt: 'desc' },
      });
    }),

  /** Histórico completo de transfers de uma opp (qualquer status). */
  historyForOpportunity: canTransfer
    .input(z.object({ opportunityId: zUuid }))
    .query(async ({ input, ctx }) => {
      assertFeatureEnabled();
      return prisma.opportunityTransfer.findMany({
        where: { tenantId: ctx.tenantId, opportunityId: input.opportunityId },
        include: {
          requestedBy: { select: { id: true, fullName: true, email: true } },
          originalOwner: { select: { id: true, fullName: true, email: true } },
          targetManager: { select: { id: true, fullName: true, email: true } },
          newOwner: { select: { id: true, fullName: true, email: true } },
          decidedBy: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { requestedAt: 'desc' },
      });
    }),
});
