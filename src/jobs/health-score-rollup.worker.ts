import { makeWorker, QUEUE_NAMES } from './queues';
import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { computeHealthScore } from '@/server/services/health-score.service';
import { Prisma } from '@prisma/client';

/**
 * Worker `health-score-rollup` — Sprint 15B.
 *
 * Roda 02:00 BRT diariamente. Para cada tenant ativo calcula os 8 sinais
 * de saúde + score composto + bucket + razões e grava em
 * `tenant_health_snapshots`. Upsert por (tenantId, date).
 */

export interface HealthScoreRollupJobData {
  date?: string;
}

export async function runHealthScoreRollup(targetDate?: Date): Promise<{
  tenantsProcessed: number;
  red: number;
  yellow: number;
  green: number;
}> {
  const day = targetDate ?? new Date();
  day.setHours(0, 0, 0, 0);

  return runAsSystem(async () => {
    const tenants = await prisma.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    let red = 0,
      yellow = 0,
      green = 0;

    for (const t of tenants) {
      try {
        const out = await computeHealthScore(t.id);
        await prisma.tenantHealthSnapshot.upsert({
          where: { tenantId_date: { tenantId: t.id, date: day } },
          create: {
            tenantId: t.id,
            date: day,
            signalLogins: out.signals.logins,
            signalOppsCreated: out.signals.oppsCreated,
            signalFeaturesUsed: out.signals.featuresUsed,
            signalNps: out.signals.nps,
            signalOpenTickets: out.signals.openTickets,
            signalTrialProgress: out.signals.trialProgress,
            signalEvaluations: out.signals.evaluations,
            signalResourceUsage: out.signals.resourceUsage,
            healthScore: out.score,
            bucket: out.bucket,
            reasons: out.reasons as unknown as Prisma.InputJsonValue,
          },
          update: {
            signalLogins: out.signals.logins,
            signalOppsCreated: out.signals.oppsCreated,
            signalFeaturesUsed: out.signals.featuresUsed,
            signalNps: out.signals.nps,
            signalOpenTickets: out.signals.openTickets,
            signalTrialProgress: out.signals.trialProgress,
            signalEvaluations: out.signals.evaluations,
            signalResourceUsage: out.signals.resourceUsage,
            healthScore: out.score,
            bucket: out.bucket,
            reasons: out.reasons as unknown as Prisma.InputJsonValue,
          },
        });
        if (out.bucket === 'RED') red++;
        else if (out.bucket === 'YELLOW') yellow++;
        else green++;
      } catch (err) {
        console.error(
          `[health-score-rollup] tenant ${t.id} falhou: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return { tenantsProcessed: tenants.length, red, yellow, green };
  });
}

export function startHealthScoreRollupWorker() {
  return makeWorker<HealthScoreRollupJobData>(
    QUEUE_NAMES.healthScoreRollup,
    async (job) => {
      const target = job.data?.date ? new Date(job.data.date) : undefined;
      const result = await runHealthScoreRollup(target);
      console.info(`[health-score-rollup] ${JSON.stringify(result)}`);
      return result;
    },
  );
}
