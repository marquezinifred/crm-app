import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { AlertStatus, AlertType } from '@prisma/client';
import { sendEmail } from '@/server/services/email-sender.service';
import { env } from '@/lib/env';
import {
  renderRelationshipAlert,
  renderPipelineAlert,
  renderTaskAlert,
} from '@/lib/email/templates';
import { makeWorker, QUEUE_NAMES, type EmailSendJobData } from './queues';

/**
 * Lê um alert_log PENDING, monta o template, envia via Resend e atualiza
 * status. Envia para responsavel + Central de CRM (cc).
 */
export function startEmailSendWorker() {
  return makeWorker<EmailSendJobData>(QUEUE_NAMES.emailSend, async ({ data }) => {
    const alertId = data.alertLogId;
    await runAsSystem(async () => {
      const alert = await prisma.alertLog.findUnique({ where: { id: alertId } });
      if (!alert || alert.status === AlertStatus.SENT) return;

      const payload = (alert.payload ?? {}) as Record<string, unknown>;
      const appUrl = env.NEXT_PUBLIC_APP_URL;
      const tos = [alert.recipientEmail];
      const central = payload.centralCrmEmail;
      if (typeof central === 'string' && central && central !== alert.recipientEmail) {
        tos.push(central);
      }

      let rendered: { subject: string; html: string };
      if (alert.type === AlertType.RELATIONSHIP_DATE) {
        rendered = renderRelationshipAlert({
          entityName: String(payload.label ?? payload.dateType ?? 'Data importante'),
          entityType: alert.entityType === 'COMPANY' ? 'COMPANY' : 'CONTACT',
          dateType: String(payload.dateType ?? 'CUSTOM'),
          dateLabel: (payload.label as string | null | undefined) ?? null,
          scheduledFor: alert.scheduledFor,
          leadDays: Number(payload.leadDays ?? 0),
          appUrl,
          entityUrl: `${appUrl}/${alert.entityType.toLowerCase()}s/${alert.entityId}`,
        });
      } else if (alert.type === AlertType.PIPELINE_DATE) {
        rendered = renderPipelineAlert({
          opportunityTitle: String(payload.opportunityTitle ?? 'Oportunidade'),
          stage: String(payload.stage ?? ''),
          marker: String(payload.marker ?? ''),
          scheduledFor: alert.scheduledFor,
          leadDays: Number(payload.leadDays ?? 0),
          opportunityUrl: `${appUrl}/pipeline/${payload.opportunityId}`,
          appUrl,
        });
      } else {
        // TASK_DUE | TASK_OVERDUE
        const dueDate = payload.dueDate ? new Date(String(payload.dueDate)) : alert.scheduledFor;
        const daysOverdue = Math.max(
          0,
          Math.floor((Date.now() - dueDate.getTime()) / 86_400_000),
        );
        rendered = renderTaskAlert({
          taskTitle: String(payload.taskTitle ?? 'Tarefa'),
          opportunityTitle: payload.opportunityId ? String(payload.opportunityId) : undefined,
          dueDate,
          daysOverdue,
          taskUrl: payload.opportunityId
            ? `${appUrl}/pipeline/${payload.opportunityId}`
            : `${appUrl}/tasks`,
          isEscalation: alert.type === AlertType.TASK_OVERDUE,
        });
      }

      const result = await sendEmail({ to: tos, ...rendered });
      if (result.ok) {
        await prisma.alertLog.update({
          where: { id: alertId },
          data: {
            status: AlertStatus.SENT,
            sentAt: new Date(),
            errorMessage: null,
          },
        });
      } else {
        await prisma.alertLog.update({
          where: { id: alertId },
          data: {
            status: AlertStatus.FAILED,
            errorMessage: result.error,
          },
        });
        throw new Error(result.error); // re-lança para BullMQ retentar
      }
    });
  });
}
