import { generateDailyAlerts } from '@/server/services/alert-generator.service';
import { scanTaskEscalations } from '@/server/services/task-escalation.service';
import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { AlertStatus } from '@prisma/client';
import {
  makeWorker,
  makeQueue,
  QUEUE_NAMES,
  type AlertsScanJobData,
  type EmailSendJobData,
} from './queues';

/**
 * Worker do scan diário. Executa o gerador (relacionamento + pipeline) +
 * escalonamento de tarefas atrasadas, e enfileira UM job de envio de
 * e-mail por alert_log criado em PENDING.
 */
export function startAlertsScanWorker() {
  const emailQueue = makeQueue<EmailSendJobData>(QUEUE_NAMES.emailSend);

  return makeWorker<AlertsScanJobData>(QUEUE_NAMES.alertsScan, async ({ data }) => {
    const today = data.today ? new Date(data.today) : new Date();

    const [alertStats, taskStats] = await Promise.all([
      generateDailyAlerts({ today }),
      scanTaskEscalations(today),
    ]);
    const alertsEnqueued = alertStats.reduce((s, x) => s + x.enqueued, 0);
    const tasksDue = taskStats.reduce((s, x) => s + x.dueToday, 0);
    const tasksEscalated = taskStats.reduce((s, x) => s + x.escalated, 0);
    console.info(
      `[alerts-scan] today=${today.toISOString().slice(0, 10)} ` +
        `tenants=${alertStats.length} new_alerts=${alertsEnqueued} ` +
        `tasks_due=${tasksDue} tasks_escalated=${tasksEscalated}`,
    );

    // Pega todos os alerts em PENDING e despacha
    const pending = await runAsSystem(() =>
      prisma.alertLog.findMany({
        where: { status: AlertStatus.PENDING },
        select: { id: true },
      }),
    );
    for (const p of pending) {
      await emailQueue.add('send', { alertLogId: p.id }, { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } });
    }
    return { tenants: alertStats.length, enqueuedEmails: pending.length };
  });
}
