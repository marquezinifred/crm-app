import { makeWorker, QUEUE_NAMES } from './queues';
import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { usdToBrlWithMargin } from '@/lib/ai/pricing';
import { Prisma } from '@prisma/client';

/**
 * Worker `ai-usage-rollup` — Sprint 15B.
 *
 * Roda 00:30 BRT diariamente. Para cada (tenant, provider, model) do dia
 * anterior:
 *  - agrega request_count + tokens + cost (USD) de `ai_usage_logs`
 *  - converte para R$ com margem da Plataforma
 *  - upsert em `ai_usage_daily`
 *  - compara com média 7d → cria `ai_anomaly_alerts` se passou do threshold
 *    configurado por tenant em `tenant_ai_limits`
 */

export interface AiUsageRollupJobData {
  /** Data alvo no formato YYYY-MM-DD. Default: ontem. */
  date?: string;
}

export async function runAiUsageRollup(targetDate?: Date): Promise<{
  rowsProcessed: number;
  anomaliesFound: number;
}> {
  const day = targetDate ?? yesterday();
  day.setHours(0, 0, 0, 0);
  const next = new Date(day);
  next.setDate(day.getDate() + 1);

  return runAsSystem(async () => {
    // 1. Agrega ai_usage_logs do dia em groupBy(tenant, provider, model)
    const groups = await prisma.aIUsageLog.groupBy({
      by: ['tenantId', 'provider', 'model'],
      where: { createdAt: { gte: day, lt: next } },
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, costUsd: true },
    });

    let rowsProcessed = 0;
    let anomaliesFound = 0;

    for (const g of groups) {
      const tokensInput = BigInt(g._sum.promptTokens ?? 0);
      const tokensOutput = BigInt(g._sum.completionTokens ?? 0);
      const costUsd = Number(g._sum.costUsd ?? 0);
      const costBrl = usdToBrlWithMargin(costUsd);

      await prisma.aiUsageDaily.upsert({
        where: {
          tenantId_provider_model_date: {
            tenantId: g.tenantId,
            provider: g.provider,
            model: g.model,
            date: day,
          },
        },
        create: {
          tenantId: g.tenantId,
          provider: g.provider,
          model: g.model,
          date: day,
          requestCount: g._count._all,
          tokensInput,
          tokensOutput,
          costBrl: new Prisma.Decimal(costBrl),
        },
        update: {
          requestCount: g._count._all,
          tokensInput,
          tokensOutput,
          costBrl: new Prisma.Decimal(costBrl),
        },
      });
      rowsProcessed++;

      // 2. Anomaly detection: tokens hoje > threshold × média 7d
      const sevenAgo = new Date(day);
      sevenAgo.setDate(day.getDate() - 7);
      const past = await prisma.aiUsageDaily.findMany({
        where: {
          tenantId: g.tenantId,
          provider: g.provider,
          model: g.model,
          date: { gte: sevenAgo, lt: day },
        },
        select: { tokensInput: true, tokensOutput: true },
      });
      if (past.length < 3) continue;

      const avg7d =
        past.reduce(
          (acc, r) => acc + Number(r.tokensInput) + Number(r.tokensOutput),
          0,
        ) / past.length;
      const todayTotal = Number(tokensInput) + Number(tokensOutput);

      const limits = await prisma.tenantAiLimits.findUnique({
        where: { tenantId: g.tenantId },
      });
      const threshold = Number(limits?.anomalyThresholdMultiplier ?? 3.0);

      if (avg7d > 0 && todayTotal > avg7d * threshold) {
        await prisma.aiAnomalyAlert.create({
          data: {
            tenantId: g.tenantId,
            type: 'TOKEN_SPIKE',
            details: {
              provider: g.provider,
              model: g.model,
              date: day.toISOString().slice(0, 10),
              today: todayTotal,
              avg7d: Math.round(avg7d),
              multiplier: Number((todayTotal / avg7d).toFixed(2)),
              threshold,
            },
          } as Prisma.AiAnomalyAlertUncheckedCreateInput,
        });
        anomaliesFound++;
      }
    }

    return { rowsProcessed, anomaliesFound };
  });
}

function yesterday(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

export function startAiUsageRollupWorker() {
  return makeWorker<AiUsageRollupJobData>(QUEUE_NAMES.aiUsageRollup, async (job) => {
    const target = job.data?.date ? new Date(job.data.date) : undefined;
    const result = await runAiUsageRollup(target);
    console.info(`[ai-usage-rollup] ${JSON.stringify(result)}`);
    return result;
  });
}
