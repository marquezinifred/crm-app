import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { sendPushToUser } from '@/server/services/push-sender.service';
import { sendEmail } from '@/server/services/email-sender.service';
import { env } from '@/lib/env';
import {
  renderTransferRequestedToManager,
  renderTransferRequestedToOwner,
  renderTransferApprovedToNewOwner,
  renderTransferApproved,
  renderTransferRejected,
  renderTransferCancelled,
  renderTransferTimedOut,
  transferRequestedToManagerPush,
  transferRequestedToOwnerPush,
  transferApprovedToNewOwnerPush,
  transferApprovedPush,
  transferRejectedPush,
  transferCancelledPush,
  transferTimedOutPush,
  type TransferNotificationVars,
  type TransferPushPayload,
} from '@/lib/email/templates';

/**
 * Sprint 15G.5 Fase 2 — Notificações do workflow de transferência de
 * oportunidade (P-87).
 *
 * ⚠️ FRONTEIRA CHIP 2a ↔ 2b (T18 / plano §5 Fase 2)
 * ────────────────────────────────────────────────────────────────────
 * Este arquivo é do **chip 2a** (router). Define `notifyTransferEvent`
 * (assinatura + entrega best-effort: resolve destinatários, push, e-mail).
 * O router (2a) chama SÓ `notifyTransferEvent(event, ctx)`.
 *
 * O **chip 2b** entregou os 7 templates como funções puras em
 * `@/lib/email/templates` (`renderTransfer*` + `transfer*Push` +
 * `TransferNotificationVars`) — em vez de dentro deste arquivo. Este
 * service **delega** a elas (fonte única da copy, sem duplicação). 2b
 * possui o worker de timeout (`src/jobs/opportunity-transfer-timeout.worker.ts`)
 * que hoje compõe a notificação de TIMED_OUT direto com as mesmas
 * funções de template; `notifyTransferEvent('TIMED_OUT', ...)` aqui cobre
 * o mesmo caso, pronto pra o worker consumir se quiser unificar o caminho.
 *
 * Garantias:
 *  - **T5 (best-effort):** `notifyTransferEvent` NUNCA propaga rejection.
 *    O corpo é envolto em try/catch; push/e-mail individuais também engolem
 *    falha. O router ainda usa `void ...catch(console.warn)` como 2ª barreira.
 *  - **T6 (cross-tenant):** a resolução de usuários filtra `tenantId`
 *    explícito. Roda em `runAsSystem` — funciona no contexto tRPC (router)
 *    e fora dele (worker, sem `runWithTenant`).
 *  - PII: só push/e-mail direto ao destinatário; não passa por IA
 *    (DataMasking N/A). Justificativa/motivo ficam SÓ no e-mail (o template
 *    do 2b não os coloca no push).
 * ────────────────────────────────────────────────────────────────────
 */

/**
 * Eventos do ciclo de vida. `REQUESTED`/`APPROVED`/`REJECTED`/`CANCELLED`
 * disparados pelo router (2a); `TIMED_OUT` pelo worker de timeout (2b).
 */
export type TransferEvent =
  | 'REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'TIMED_OUT';

/**
 * Contexto imutável de uma transferência. O caller monta a partir da row
 * `opportunity_transfers` + dados da opp.
 */
export interface TransferNotificationContext {
  tenantId: string;
  transferId: string;
  opportunityId: string;
  opportunityTitle: string;
  companyName?: string | null;
  /** disparador (ancestor que iniciou a transferência) */
  requestedById: string;
  /** dono no momento do disparo */
  originalOwnerId: string;
  /** destinatário (par/superior que decide) */
  targetManagerId: string;
  /** novo owner escolhido no approve (só em APPROVED) */
  newOwnerId?: string | null;
  reason?: string | null;
  decisionReason?: string | null;
}

/** Papel do destinatário na notificação — determina o template. */
type RecipientRole =
  | 'requester'
  | 'originalOwner'
  | 'targetManager'
  | 'newOwner';

interface ResolvedRecipient {
  userId: string;
  role: RecipientRole;
}

type EmailRender = (v: TransferNotificationVars) => { subject: string; html: string };
type PushBuild = (v: TransferNotificationVars) => TransferPushPayload;

/**
 * Quem recebe cada evento (spec §5 Fase 2 / regras §2):
 *  - REQUESTED → destinatário (precisa decidir) + dono original (read-only)
 *  - APPROVED  → disparador + novo owner + dono original
 *  - REJECTED / CANCELLED / TIMED_OUT → disparador + dono original
 *
 * Dedup por userId (mesma pessoa em 2 papéis recebe 1 notificação — o
 * primeiro papel da lista vence, o mais relevante pra copy).
 */
function resolveRecipients(
  event: TransferEvent,
  ctx: TransferNotificationContext,
): ResolvedRecipient[] {
  const raw: ResolvedRecipient[] = [];
  switch (event) {
    case 'REQUESTED':
      raw.push({ userId: ctx.targetManagerId, role: 'targetManager' });
      raw.push({ userId: ctx.originalOwnerId, role: 'originalOwner' });
      break;
    case 'APPROVED':
      raw.push({ userId: ctx.requestedById, role: 'requester' });
      if (ctx.newOwnerId) raw.push({ userId: ctx.newOwnerId, role: 'newOwner' });
      raw.push({ userId: ctx.originalOwnerId, role: 'originalOwner' });
      break;
    case 'REJECTED':
    case 'CANCELLED':
    case 'TIMED_OUT':
      raw.push({ userId: ctx.requestedById, role: 'requester' });
      raw.push({ userId: ctx.originalOwnerId, role: 'originalOwner' });
      break;
  }

  const seen = new Set<string>();
  const deduped: ResolvedRecipient[] = [];
  for (const r of raw) {
    if (seen.has(r.userId)) continue;
    seen.add(r.userId);
    deduped.push(r);
  }
  return deduped;
}

/** Seleciona o par (email render, push build) do 2b por (evento, papel). */
function pickTemplate(
  event: TransferEvent,
  role: RecipientRole,
): { email: EmailRender; push: PushBuild } {
  switch (event) {
    case 'REQUESTED':
      return role === 'targetManager'
        ? { email: renderTransferRequestedToManager, push: transferRequestedToManagerPush }
        : { email: renderTransferRequestedToOwner, push: transferRequestedToOwnerPush };
    case 'APPROVED':
      return role === 'newOwner'
        ? { email: renderTransferApprovedToNewOwner, push: transferApprovedToNewOwnerPush }
        : { email: renderTransferApproved, push: transferApprovedPush };
    case 'REJECTED':
      return { email: renderTransferRejected, push: transferRejectedPush };
    case 'CANCELLED':
      return { email: renderTransferCancelled, push: transferCancelledPush };
    case 'TIMED_OUT':
      return { email: renderTransferTimedOut, push: transferTimedOutPush };
  }
}

function opportunityUrl(ctx: TransferNotificationContext): string {
  return `${env.NEXT_PUBLIC_APP_URL}/pipeline/${ctx.opportunityId}`;
}

function inboxUrl(): string {
  return `${env.NEXT_PUBLIC_APP_URL}/inbox/transferencias-recebidas`;
}

/** Monta os vars do template do 2b, resolvendo nomes já carregados. */
function buildVars(
  ctx: TransferNotificationContext,
  recipientName: string | null,
  names: Map<string, string | null>,
): TransferNotificationVars {
  return {
    recipientName,
    opportunityTitle: ctx.opportunityTitle,
    companyName: ctx.companyName ?? null,
    requesterName: names.get(ctx.requestedById) ?? null,
    targetManagerName: names.get(ctx.targetManagerId) ?? null,
    newOwnerName: ctx.newOwnerId ? names.get(ctx.newOwnerId) ?? null : null,
    reason: ctx.reason ?? null,
    decisionReason: ctx.decisionReason ?? null,
    opportunityUrl: opportunityUrl(ctx),
    inboxUrl: inboxUrl(),
  };
}

/**
 * Carrega e-mail + nome dos usuários envolvidos no tenant (T6: filtro
 * explícito). `runAsSystem` pra funcionar no worker (sem runWithTenant) e no
 * router. Retorna `{ contacts: id→{email,fullName}, names: id→fullName }`.
 */
async function loadInvolvedUsers(
  ids: string[],
  tenantId: string,
): Promise<{
  contacts: Map<string, { email: string; fullName: string | null }>;
  names: Map<string, string | null>;
}> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { contacts: new Map(), names: new Map() };
  const rows = await runAsSystem(() =>
    prisma.user.findMany({
      where: { id: { in: unique }, tenantId, deletedAt: null, active: true },
      select: { id: true, email: true, fullName: true },
    }),
  );
  const contacts = new Map(rows.map((u) => [u.id, { email: u.email, fullName: u.fullName }]));
  const names = new Map(rows.map((u) => [u.id, u.fullName]));
  return { contacts, names };
}

/**
 * Ponto de entrada único. Best-effort total (T5): resolve destinatários,
 * dispara push + e-mail (delegando aos templates do 2b) e NUNCA propaga
 * erro. Retorna void.
 *
 * Chamado pelo router (2a) em cada mutation e disponível pro worker de
 * timeout (2b) com `event='TIMED_OUT'`.
 */
export async function notifyTransferEvent(
  event: TransferEvent,
  ctx: TransferNotificationContext,
): Promise<void> {
  try {
    const recipients = resolveRecipients(event, ctx);
    if (recipients.length === 0) return;

    // Carrega os destinatários + todos os papéis nomeados nos templates.
    const involvedIds = [
      ...recipients.map((r) => r.userId),
      ctx.requestedById,
      ctx.originalOwnerId,
      ctx.targetManagerId,
      ...(ctx.newOwnerId ? [ctx.newOwnerId] : []),
    ];
    const { contacts, names } = await loadInvolvedUsers(involvedIds, ctx.tenantId);

    await Promise.all(
      recipients.map(async (r) => {
        const contact = contacts.get(r.userId);
        if (!contact) return; // destinatário inativo/removido — silencioso

        const { email: renderEmail, push: buildPush } = pickTemplate(event, r.role);
        const vars = buildVars(ctx, contact.fullName, names);

        const pushPayload = buildPush(vars);
        const emailContent = renderEmail(vars);

        const pushResult = sendPushToUser(r.userId, pushPayload).catch((err) => {
          console.warn('[transfer-notification] push falhou (ignorado):', event, err);
        });
        const emailResult = sendEmail({
          to: contact.email,
          subject: emailContent.subject,
          html: emailContent.html,
        }).catch((err) => {
          console.warn('[transfer-notification] e-mail falhou (ignorado):', event, err);
        });

        await Promise.all([pushResult, emailResult]);
      }),
    );
  } catch (err) {
    // Barreira final T5 — nada aqui pode derrubar a mutation/worker.
    console.warn('[transfer-notification] falha geral (ignorada):', event, err);
  }
}
