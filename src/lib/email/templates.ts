/**
 * Templates de e-mail simples (string interpolada).
 * Sprint 11+ pode migrar para React Email se precisar de rich formatting.
 */

export interface RelationshipAlertVars {
  recipientName?: string;
  entityName: string;
  entityType: 'COMPANY' | 'CONTACT';
  dateType: string;
  dateLabel?: string | null;
  scheduledFor: Date;
  leadDays: number;
  appUrl: string;
  entityUrl: string;
}

export function renderRelationshipAlert(v: RelationshipAlertVars) {
  const subject =
    v.leadDays === 0
      ? `Hoje: ${v.dateLabel ?? v.dateType.toLowerCase()} — ${v.entityName}`
      : `Em ${v.leadDays} dia(s): ${v.dateLabel ?? v.dateType.toLowerCase()} — ${v.entityName}`;
  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #111; margin-bottom: 8px;">${subject}</h2>
      <p style="color: #444; margin: 0 0 12px;">
        ${v.recipientName ? `Olá ${v.recipientName},` : 'Olá,'}
      </p>
      <p style="color: #444;">
        Lembrete: <strong>${v.entityName}</strong> tem uma data importante (${v.dateLabel ?? v.dateType.toLowerCase()})
        ${v.leadDays === 0 ? 'hoje' : `daqui a ${v.leadDays} dia(s)`}, em
        <strong>${v.scheduledFor.toLocaleDateString('pt-BR')}</strong>.
      </p>
      <p style="margin: 24px 0;">
        <a href="${v.entityUrl}" style="background: #111; color: #fff; padding: 10px 16px; border-radius: 6px; text-decoration: none;">
          Abrir no CRM
        </a>
      </p>
      <p style="color: #888; font-size: 12px;">
        Você recebeu este alerta porque é o responsável pelo relacionamento.
        Configure antecedência em ${v.appUrl}/admin/alerts
      </p>
    </div>
  `;
  return { subject, html };
}

export interface PipelineAlertVars {
  recipientName?: string;
  opportunityTitle: string;
  stage: string;
  marker: string;
  scheduledFor: Date;
  leadDays: number;
  opportunityUrl: string;
  appUrl: string;
}

export interface TaskAlertVars {
  recipientName?: string;
  taskTitle: string;
  opportunityTitle?: string;
  dueDate: Date;
  daysOverdue: number;
  taskUrl: string;
  isEscalation?: boolean;
}

export function renderTaskAlert(v: TaskAlertVars) {
  const overdueLabel = v.daysOverdue === 0 ? 'vence hoje' : `atrasada há ${v.daysOverdue} dia(s)`;
  const prefix = v.isEscalation ? '[Escalonamento] ' : '';
  const subject = `${prefix}Tarefa ${overdueLabel}: ${v.taskTitle}`;
  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #111;">${subject}</h2>
      <p style="color: #444;">${v.recipientName ? `Olá ${v.recipientName},` : 'Olá,'}</p>
      <p style="color: #444;">
        ${v.isEscalation
          ? 'Esta tarefa está atrasada e foi escalada para sua atenção.'
          : 'Lembrete: esta tarefa ' + overdueLabel + '.'}
      </p>
      <ul style="color: #444; line-height: 1.6;">
        <li><strong>Tarefa:</strong> ${v.taskTitle}</li>
        ${v.opportunityTitle ? `<li><strong>Oportunidade:</strong> ${v.opportunityTitle}</li>` : ''}
        <li><strong>Vencimento:</strong> ${v.dueDate.toLocaleDateString('pt-BR')}</li>
      </ul>
      <p style="margin: 24px 0;">
        <a href="${v.taskUrl}" style="background: #111; color: #fff; padding: 10px 16px; border-radius: 6px; text-decoration: none;">
          Abrir tarefa
        </a>
      </p>
    </div>
  `;
  return { subject, html };
}

export function renderPipelineAlert(v: PipelineAlertVars) {
  const subject =
    v.leadDays === 0
      ? `Hoje: ${v.marker} — ${v.opportunityTitle}`
      : `Em ${v.leadDays} dia(s): ${v.marker} — ${v.opportunityTitle}`;
  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #111; margin-bottom: 8px;">${subject}</h2>
      <p style="color: #444;">
        ${v.recipientName ? `Olá ${v.recipientName},` : 'Olá,'}
      </p>
      <p style="color: #444;">
        Marco do pipeline para a oportunidade <strong>${v.opportunityTitle}</strong> (${v.stage}):
        <strong>${v.marker}</strong> ${v.leadDays === 0 ? 'é hoje' : `está em ${v.leadDays} dia(s)`},
        em <strong>${v.scheduledFor.toLocaleDateString('pt-BR')}</strong>.
      </p>
      <p style="margin: 24px 0;">
        <a href="${v.opportunityUrl}" style="background: #111; color: #fff; padding: 10px 16px; border-radius: 6px; text-decoration: none;">
          Abrir oportunidade
        </a>
      </p>
    </div>
  `;
  return { subject, html };
}

// ---------------------------------------------------------------------
// Sprint 15G.5 — Transferência de oportunidade (notificações)
//
// 7 templates de notificação (email + push) para o workflow de
// transferência cross-team. O *wiring* (resolver destinatários + chamar
// estes templates + enviar) fica no `transfer-notification.service.ts`
// (chip 2a) para os eventos REQUESTED/APPROVED/REJECTED/CANCELLED e no
// `opportunity-transfer-timeout.worker.ts` (chip 2b) para TIMED_OUT.
// Aqui ficam APENAS os templates (conteúdo), sem orquestração.
//
// PII em push: título da opp + razão social são info comercial (não PII
// sensível — padrão P-31). Justificativas em texto livre (reason /
// decisionReason) ficam SÓ no e-mail, nunca no push.
// ---------------------------------------------------------------------

/** Payload de push estruturalmente compatível com `PushPayload` do push-sender. */
export interface TransferPushPayload {
  title: string;
  body: string;
  url: string;
}

export interface TransferNotificationVars {
  /** Nome de quem recebe o e-mail (só afeta a saudação). */
  recipientName?: string | null;
  opportunityTitle: string;
  /** Razão social — info comercial, não PII sensível (P-31). */
  companyName?: string | null;
  /** Disparador (ancestor na árvore de vendas). */
  requesterName?: string | null;
  /** Destinatário (par/superior que decide). */
  targetManagerName?: string | null;
  /** Novo dono escolhido no approve (∈ subárvore do destinatário). */
  newOwnerName?: string | null;
  /** Justificativa do disparador (só no e-mail). */
  reason?: string | null;
  /** Justificativa do decisor (só no e-mail). */
  decisionReason?: string | null;
  /** Link para a oportunidade (/pipeline/{id}). */
  opportunityUrl: string;
  /** Link para a fila do destinatário (/inbox/transferencias-recebidas). */
  inboxUrl?: string;
}

/** Rótulo da opp com a empresa entre parênteses quando disponível. */
function transferOppLabel(v: TransferNotificationVars): string {
  return v.companyName ? `${v.opportunityTitle} (${v.companyName})` : v.opportunityTitle;
}

function transferEmailShell(
  heading: string,
  bodyHtml: string,
  ctaHref: string,
  ctaLabel: string,
): string {
  return `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="color: #111; margin-bottom: 8px;">${heading}</h2>
      ${bodyHtml}
      <p style="margin: 24px 0;">
        <a href="${ctaHref}" style="background: #111; color: #fff; padding: 10px 16px; border-radius: 6px; text-decoration: none;">
          ${ctaLabel}
        </a>
      </p>
    </div>
  `;
}

function greeting(name?: string | null): string {
  return `<p style="color: #444; margin: 0 0 12px;">${name ? `Olá ${name},` : 'Olá,'}</p>`;
}

function reasonBlock(label: string, text?: string | null): string {
  if (!text) return '';
  return `<p style="color: #444;"><strong>${label}:</strong> ${text}</p>`;
}

// 1/7 — REQUESTED → destinatário (target manager): ação necessária.
export function renderTransferRequestedToManager(v: TransferNotificationVars) {
  const label = transferOppLabel(v);
  const subject = `Transferência recebida para análise: ${label}`;
  const body =
    greeting(v.recipientName) +
    `<p style="color: #444;">
      ${v.requesterName ? `<strong>${v.requesterName}</strong> solicitou` : 'Foi solicitada'}
      a transferência da oportunidade <strong>${label}</strong> para você.
      Analise e escolha <strong>aceitar</strong> (atribuindo um responsável da sua equipe)
      ou <strong>recusar</strong>.
    </p>` +
    reasonBlock('Motivo', v.reason);
  return {
    subject,
    html: transferEmailShell(subject, body, v.inboxUrl ?? v.opportunityUrl, 'Ver solicitação'),
  };
}

// 2/7 — REQUESTED → dono original: FYI + entra em modo somente-leitura.
export function renderTransferRequestedToOwner(v: TransferNotificationVars) {
  const label = transferOppLabel(v);
  const subject = `Sua oportunidade está em transferência: ${label}`;
  const body =
    greeting(v.recipientName) +
    `<p style="color: #444;">
      ${v.requesterName ? `<strong>${v.requesterName}</strong> iniciou` : 'Foi iniciada'}
      a transferência da oportunidade <strong>${label}</strong>.
      Enquanto a solicitação estiver pendente, ela fica em modo
      <strong>somente leitura</strong> para você — sem edições, atividades ou
      mudança de estágio.
    </p>`;
  return {
    subject,
    html: transferEmailShell(subject, body, v.opportunityUrl, 'Abrir oportunidade'),
  };
}

// 3/7 — APPROVED → novo owner: você recebeu a oportunidade.
export function renderTransferApprovedToNewOwner(v: TransferNotificationVars) {
  const label = transferOppLabel(v);
  const subject = `Você recebeu uma oportunidade: ${label}`;
  const body =
    greeting(v.recipientName ?? v.newOwnerName) +
    `<p style="color: #444;">
      ${v.targetManagerName ? `<strong>${v.targetManagerName}</strong> atribuiu` : 'Foi atribuída'}
      a você a oportunidade <strong>${label}</strong>. Ela já está no seu pipeline,
      com o estágio e o histórico preservados.
    </p>`;
  return {
    subject,
    html: transferEmailShell(subject, body, v.opportunityUrl, 'Abrir oportunidade'),
  };
}

// 4/7 — APPROVED → disparador + dono original: transferência aprovada.
export function renderTransferApproved(v: TransferNotificationVars) {
  const label = transferOppLabel(v);
  const subject = `Transferência aprovada: ${label}`;
  const body =
    greeting(v.recipientName) +
    `<p style="color: #444;">
      ${v.targetManagerName ? `<strong>${v.targetManagerName}</strong> aprovou` : 'Foi aprovada'}
      a transferência da oportunidade <strong>${label}</strong>.
      ${v.newOwnerName ? `Novo responsável: <strong>${v.newOwnerName}</strong>.` : ''}
    </p>` +
    reasonBlock('Observação do decisor', v.decisionReason);
  return {
    subject,
    html: transferEmailShell(subject, body, v.opportunityUrl, 'Abrir oportunidade'),
  };
}

// 5/7 — REJECTED → disparador + dono original: transferência recusada.
export function renderTransferRejected(v: TransferNotificationVars) {
  const label = transferOppLabel(v);
  const subject = `Transferência recusada: ${label}`;
  const body =
    greeting(v.recipientName) +
    `<p style="color: #444;">
      ${v.targetManagerName ? `<strong>${v.targetManagerName}</strong> recusou` : 'Foi recusada'}
      a transferência da oportunidade <strong>${label}</strong>.
      Ela permanece sob a gestão de quem disparou a transferência.
    </p>` +
    reasonBlock('Motivo da recusa', v.decisionReason);
  return {
    subject,
    html: transferEmailShell(subject, body, v.opportunityUrl, 'Abrir oportunidade'),
  };
}

// 6/7 — CANCELLED → dono original + destinatário: transferência cancelada.
export function renderTransferCancelled(v: TransferNotificationVars) {
  const label = transferOppLabel(v);
  const subject = `Transferência cancelada: ${label}`;
  const body =
    greeting(v.recipientName) +
    `<p style="color: #444;">
      ${v.requesterName ? `<strong>${v.requesterName}</strong> cancelou` : 'Foi cancelada'}
      a solicitação de transferência da oportunidade <strong>${label}</strong>.
    </p>`;
  return {
    subject,
    html: transferEmailShell(subject, body, v.opportunityUrl, 'Abrir oportunidade'),
  };
}

// 7/7 — TIMED_OUT → disparador + dono original: solicitação expirou.
export function renderTransferTimedOut(v: TransferNotificationVars) {
  const label = transferOppLabel(v);
  const subject = `Transferência expirada: ${label}`;
  const body =
    greeting(v.recipientName) +
    `<p style="color: #444;">
      A solicitação de transferência da oportunidade <strong>${label}</strong> expirou
      sem decisão do destinatário e foi encerrada automaticamente.
      A oportunidade permanece sob a gestão de quem a disparou.
    </p>`;
  return {
    subject,
    html: transferEmailShell(subject, body, v.opportunityUrl, 'Abrir oportunidade'),
  };
}

// ----- Push builders (título/corpo curtos; sem texto livre nem PII sensível) -----

export function transferRequestedToManagerPush(v: TransferNotificationVars): TransferPushPayload {
  return {
    title: 'Nova transferência para análise',
    body: v.requesterName
      ? `${transferOppLabel(v)} — de ${v.requesterName}`
      : transferOppLabel(v),
    url: v.inboxUrl ?? v.opportunityUrl,
  };
}

export function transferRequestedToOwnerPush(v: TransferNotificationVars): TransferPushPayload {
  return {
    title: 'Oportunidade em transferência',
    body: `${transferOppLabel(v)} entrou em modo somente leitura`,
    url: v.opportunityUrl,
  };
}

export function transferApprovedToNewOwnerPush(v: TransferNotificationVars): TransferPushPayload {
  return {
    title: 'Você recebeu uma oportunidade',
    body: transferOppLabel(v),
    url: v.opportunityUrl,
  };
}

export function transferApprovedPush(v: TransferNotificationVars): TransferPushPayload {
  return {
    title: 'Transferência aprovada',
    body: v.newOwnerName
      ? `${transferOppLabel(v)} — novo responsável: ${v.newOwnerName}`
      : transferOppLabel(v),
    url: v.opportunityUrl,
  };
}

export function transferRejectedPush(v: TransferNotificationVars): TransferPushPayload {
  return {
    title: 'Transferência recusada',
    body: transferOppLabel(v),
    url: v.opportunityUrl,
  };
}

export function transferCancelledPush(v: TransferNotificationVars): TransferPushPayload {
  return {
    title: 'Transferência cancelada',
    body: transferOppLabel(v),
    url: v.opportunityUrl,
  };
}

export function transferTimedOutPush(v: TransferNotificationVars): TransferPushPayload {
  return {
    title: 'Transferência expirada',
    body: transferOppLabel(v),
    url: v.opportunityUrl,
  };
}
