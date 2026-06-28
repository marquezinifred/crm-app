import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { AlertStatus, AlertType, Prisma, TaskStatus, UserRole } from '@prisma/client';

/**
 * Cobrança e escalonamento de tarefas (§6.3 do spec):
 *   - No vencimento: alerta TASK_DUE para o assignee
 *   - Após tenant.taskOverdueDays dias em atraso: escala para
 *     supervisor (GESTOR ou DIRETOR_COMERCIAL); cria TASK_OVERDUE
 *
 * Emite entradas em alert_logs em PENDING — o worker email-send consome
 * exatamente como faz com os outros tipos.
 *
 * Dedup: chave (tenantId, type, entityId=taskId, scheduledFor=startOfDay)
 * — não enfileira mais de uma vez no mesmo dia.
 */

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

async function alreadyEnqueued(
  tenantId: string,
  type: AlertType,
  taskId: string,
  scheduledFor: Date,
): Promise<boolean> {
  const existing = await prisma.alertLog.findFirst({
    where: {
      tenantId,
      type,
      entityId: taskId,
      scheduledFor: { gte: startOfDay(scheduledFor), lt: new Date(startOfDay(scheduledFor).getTime() + 86_400_000) },
      status: { in: [AlertStatus.PENDING, AlertStatus.SENT] },
    },
    select: { id: true },
  });
  return !!existing;
}

async function findSupervisorEmail(tenantId: string): Promise<string | null> {
  // Prioriza GESTOR; fallback DIRETOR_COMERCIAL; fallback ADMIN
  const candidates: UserRole[] = ['GESTOR', 'DIRETOR_COMERCIAL', 'ADMIN'];
  for (const role of candidates) {
    const u = await prisma.user.findFirst({
      where: { tenantId, role, active: true, deletedAt: null },
      select: { email: true },
    });
    if (u) return u.email;
  }
  return null;
}

export interface TaskEscalationStats {
  tenantId: string;
  dueToday: number;
  escalated: number;
  skipped: number;
}

export async function scanTaskEscalations(now: Date = new Date()): Promise<TaskEscalationStats[]> {
  return runAsSystem(async () => {
    const tenants = await prisma.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true, taskOverdueDays: true, centralCrmEmail: true },
    });

    const results: TaskEscalationStats[] = [];
    for (const t of tenants) {
      const stats: TaskEscalationStats = {
        tenantId: t.id,
        dueToday: 0,
        escalated: 0,
        skipped: 0,
      };

      const today = startOfDay(now);
      const overdueThreshold = new Date(today.getTime() - t.taskOverdueDays * 86_400_000);

      const tasks = await prisma.task.findMany({
        where: {
          tenantId: t.id,
          deletedAt: null,
          status: { in: [TaskStatus.TODO, TaskStatus.DOING] },
          dueDate: { lte: today },
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          opportunityId: true,
          assignee: { select: { email: true } },
        },
      });

      const supervisor = await findSupervisorEmail(t.id);

      for (const task of tasks) {
        if (!task.dueDate) continue;
        const dueDay = startOfDay(task.dueDate);

        // 1. Cobrança no vencimento ou enquanto atrasada (1x por dia)
        if (task.assignee?.email) {
          const dup = await alreadyEnqueued(t.id, AlertType.TASK_DUE, task.id, today);
          if (dup) {
            stats.skipped += 1;
          } else {
            await prisma.alertLog.create({
              data: {
                tenantId: t.id,
                type: AlertType.TASK_DUE,
                entityType: 'task',
                entityId: task.id,
                scheduledFor: today,
                recipientEmail: task.assignee.email,
                status: AlertStatus.PENDING,
                payload: {
                  taskId: task.id,
                  taskTitle: task.title,
                  opportunityId: task.opportunityId,
                  dueDate: task.dueDate.toISOString(),
                  centralCrmEmail: t.centralCrmEmail,
                } as Prisma.InputJsonValue,
              } as Prisma.AlertLogUncheckedCreateInput,
            });
            stats.dueToday += 1;
          }
        }

        // 2. Escalonamento: dueDate <= overdueThreshold
        if (dueDay.getTime() <= overdueThreshold.getTime() && supervisor) {
          const dup = await alreadyEnqueued(t.id, AlertType.TASK_OVERDUE, task.id, today);
          if (dup) continue;
          await prisma.alertLog.create({
            data: {
              tenantId: t.id,
              type: AlertType.TASK_OVERDUE,
              entityType: 'task',
              entityId: task.id,
              scheduledFor: today,
              recipientEmail: supervisor,
              status: AlertStatus.PENDING,
              payload: {
                taskId: task.id,
                taskTitle: task.title,
                opportunityId: task.opportunityId,
                dueDate: task.dueDate.toISOString(),
                assigneeEmail: task.assignee?.email,
                centralCrmEmail: t.centralCrmEmail,
              } as Prisma.InputJsonValue,
            } as Prisma.AlertLogUncheckedCreateInput,
          });
          stats.escalated += 1;
        }
      }

      results.push(stats);
    }
    return results;
  });
}
