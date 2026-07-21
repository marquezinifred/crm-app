import { TransferStatus } from '@prisma/client';
import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { env } from '@/lib/env';
import { sendEmail } from '@/server/services/email-sender.service';
import { sendPushToUser } from '@/server/services/push-sender.service';
import {
  renderTransferTimedOut,
  transferTimedOutPush,
  type TransferNotificationVars,
} from '@/lib/email/templates';
import {
  makeWorker,
  QUEUE_NAMES,
  type OpportunityTransferTimeoutJobData,
} from './queues';

/**
 * Sprint 15G.5 — Worker de timeout de transferência (chip 2b).
 *
 * De hora em hora, varre os `opportunity_transfers` PENDING cujo
 * `expires_at < now()` e os expira: status → TIMED_OUT + limpa
 * `opportunities.current_transfer_id`. A opp permanece com o disparador
 * (regra 6 do §2 — ação manual dele depois). Best-effort por tenant
 * (padrão alert-generator): se um tenant falha, loga e segue.
 *
 * Idempotente (T5/T8): a transição usa `updateMany WHERE status=PENDING`,
 * então rodar 2×, ou uma corrida com approve/reject concorrente, não
 * reprocessa nem re-notifica (count !== 1 → pula).
 *
 * Kill-switch (T3): `OPPORTUNITY_TRANSFER_ENABLED=false` → no-op total.
 * As PENDING vencidas ficam intactas e são expiradas no próximo tick
 * quando a flag religar (T16 — sem drain script).
 */

export interface TransferTimeoutStats {
  tenantId: string;
  expired: number;
  notified: number;
}

export interface TransferTimeoutOptions {
  /** Sobrescreve "agora" — usado em testes. Default: new Date(). */
  now?: Date;
}

type DueTransfer = {
  id: string;
  opportunityId: string;
  requestedById: string;
  originalOwnerId: string;
  opportunity: { title: string; clientCompany: { razaoSocial: string } | null } | null;
  requestedBy: { id: string; email: string; fullName: string | null } | null;
  originalOwner: { id: string; email: string; fullName: string | null } | null;
};

/**
 * Notifica disparador + dono original que a transferência expirou.
 * Best-effort (T5): `Promise.allSettled` garante que a falha de um canal
 * (ou de um destinatário) não impede os demais e nunca propaga rejection.
 */
async function notifyTimedOut(tr: DueTransfer): Promise<void> {
  const opportunityUrl = `${env.NEXT_PUBLIC_APP_URL}/pipeline/${tr.opportunityId}`;
  const base: TransferNotificationVars = {
    opportunityTitle: tr.opportunity?.title ?? 'Oportunidade',
    companyName: tr.opportunity?.clientCompany?.razaoSocial ?? null,
    requesterName: tr.requestedBy?.fullName ?? null,
    opportunityUrl,
  };

  const push = transferTimedOutPush(base);

  const emailTargets: Array<{ email: string; name: string | null }> = [
    { email: tr.requestedBy?.email, name: tr.requestedBy?.fullName ?? null },
    { email: tr.originalOwner?.email, name: tr.originalOwner?.fullName ?? null },
  ].filter((r): r is { email: string; name: string | null } => !!r.email);

  const emailJobs = emailTargets.map((r) => {
    const msg = renderTransferTimedOut({ ...base, recipientName: r.name });
    return sendEmail({ to: r.email, subject: msg.subject, html: msg.html });
  });

  const pushJobs = [tr.requestedById, tr.originalOwnerId].map((uid) =>
    sendPushToUser(uid, push),
  );

  await Promise.allSettled([...emailJobs, ...pushJobs]);
}

async function expireForTenant(tenantId: string, now: Date): Promise<TransferTimeoutStats> {
  const stats: TransferTimeoutStats = { tenantId, expired: 0, notified: 0 };

  // T6 — filtro tenantId explícito (RLS como 2ª barreira).
  const due = (await prisma.opportunityTransfer.findMany({
    where: { tenantId, status: TransferStatus.PENDING, expiresAt: { lt: now } },
    select: {
      id: true,
      opportunityId: true,
      requestedById: true,
      originalOwnerId: true,
      opportunity: {
        select: { title: true, clientCompany: { select: { razaoSocial: true } } },
      },
      requestedBy: { select: { id: true, email: true, fullName: true } },
      originalOwner: { select: { id: true, email: true, fullName: true } },
    },
  })) as DueTransfer[];

  for (const tr of due) {
    // Transição idempotente: só expira se AINDA PENDING (T8). Guarda contra
    // corrida com approve/reject e contra reprocessamento (rodar 2×).
    const updated = await prisma.opportunityTransfer.updateMany({
      where: { id: tr.id, status: TransferStatus.PENDING },
      data: { status: TransferStatus.TIMED_OUT, decidedAt: now },
    });
    if (updated.count !== 1) continue;

    // Limpa a flag da opp — só se ainda apontar pra ESTE transfer.
    await prisma.opportunity.updateMany({
      where: { id: tr.opportunityId, currentTransferId: tr.id },
      data: { currentTransferId: null },
    });
    stats.expired += 1;

    // Best-effort (T5): notificação nunca aborta o processamento dos demais.
    try {
      await notifyTimedOut(tr);
      stats.notified += 1;
    } catch (err) {
      console.warn(`[transfer-timeout] notificação falhou (transfer ${tr.id}):`, err);
    }
  }

  return stats;
}

/**
 * Entry point (testável): itera tenants ativos e expira as PENDING vencidas.
 * Retorna stats por tenant. No-op quando a flag está OFF (T3).
 */
export async function expireDueTransfers(
  opts: TransferTimeoutOptions = {},
): Promise<TransferTimeoutStats[]> {
  if (!env.OPPORTUNITY_TRANSFER_ENABLED) return [];
  const now = opts.now ?? new Date();

  return runAsSystem(async () => {
    const tenants = await prisma.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    const results: TransferTimeoutStats[] = [];
    for (const t of tenants) {
      try {
        results.push(await expireForTenant(t.id, now));
      } catch (err) {
        // Best-effort por tenant (padrão alert-generator): loga e segue.
        console.error(`[transfer-timeout] tenant ${t.id} falhou:`, err);
      }
    }
    return results;
  });
}

export function startOpportunityTransferTimeoutWorker() {
  return makeWorker<OpportunityTransferTimeoutJobData>(
    QUEUE_NAMES.opportunityTransferTimeout,
    async ({ data }) => {
      const now = data?.now ? new Date(data.now) : new Date();
      const stats = await expireDueTransfers({ now });
      const expired = stats.reduce((s, x) => s + x.expired, 0);
      const notified = stats.reduce((s, x) => s + x.notified, 0);
      console.info(
        `[transfer-timeout] enabled=${env.OPPORTUNITY_TRANSFER_ENABLED} ` +
          `tenants=${stats.length} expired=${expired} notified=${notified}`,
      );
      return { tenants: stats.length, expired, notified };
    },
  );
}
