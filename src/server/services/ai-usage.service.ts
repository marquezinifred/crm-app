import { prisma } from '@/server/db/client';
import { AIProvider, Prisma } from '@prisma/client';

/**
 * Tabela de preços por provider/modelo (USD por milhão de tokens).
 * Manter atualizada com mudanças oficiais — spec §10.2 deixa isto sob
 * responsabilidade do Super Admin via UI futura. Sprint 4 hardcoda.
 */
export const AI_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
  'claude-opus-4-7': { input: 5.0, output: 25.0 },
  // OpenAI
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const p = AI_PRICING[model];
  if (!p) return 0;
  return (promptTokens * p.input + completionTokens * p.output) / 1_000_000;
}

export interface LogUsageInput {
  tenantId: string;
  userId: string | null;
  provider: AIProvider;
  model: string;
  promptTokens: number;
  completionTokens: number;
  requestType: string;
  latencyMs?: number;
  success?: boolean;
  errorCode?: string | null;
}

export async function logAiUsage(input: LogUsageInput): Promise<void> {
  const totalTokens = input.promptTokens + input.completionTokens;
  const costUsd = calculateCost(input.model, input.promptTokens, input.completionTokens);
  try {
    await prisma.aIUsageLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        provider: input.provider,
        model: input.model,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        totalTokens,
        costUsd,
        requestType: input.requestType,
        latencyMs: input.latencyMs ?? null,
        success: input.success ?? true,
        errorCode: input.errorCode ?? null,
      } as Prisma.AIUsageLogUncheckedCreateInput,
    });
  } catch (err) {
    console.error('[ai-usage] falha ao gravar log:', err);
  }
}

/** Agrega tokens + custo do tenant no mês corrente. Para o painel admin. */
export async function getMonthlyUsage(tenantId: string): Promise<{
  totalTokens: number;
  costUsd: number;
  breakdown: Array<{ provider: AIProvider; model: string; tokens: number; cost: number }>;
}> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const rows = await prisma.aIUsageLog.groupBy({
    by: ['provider', 'model'],
    where: { tenantId, createdAt: { gte: start }, success: true },
    _sum: { totalTokens: true, costUsd: true },
  });

  let totalTokens = 0;
  let costUsd = 0;
  const breakdown = rows.map((r) => {
    const t = r._sum.totalTokens ?? 0;
    const c = Number(r._sum.costUsd ?? 0);
    totalTokens += t;
    costUsd += c;
    return { provider: r.provider, model: r.model, tokens: t, cost: c };
  });
  return { totalTokens, costUsd, breakdown };
}
