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
