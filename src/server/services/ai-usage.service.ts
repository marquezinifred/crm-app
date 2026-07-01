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
  // Sprint 15F — tracking de fallback
  usedFallback?: boolean;
  configuredProvider?: AIProvider | null;
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
        usedFallback: input.usedFallback ?? false,
        configuredProvider: input.configuredProvider ?? null,
      } as Prisma.AIUsageLogUncheckedCreateInput,
    });
  } catch (err) {
    console.error('[ai-usage] falha ao gravar log:', err);
  }
}

export interface MonthlyUsageBreakdownRow {
  provider: AIProvider;
  model: string;
  tokens: number;
  cost: number;
  requests: number;
  fallbackTokens: number;
  fallbackCost: number;
  fallbackRequests: number;
}

/**
 * Agrega tokens + custo do tenant no mês corrente. Para o painel admin.
 *
 * P-23 refino — separa uso primary vs fallback por (provider, modelo)
 * pra Card C mostrar as duas barras. Groupby usa `usedFallback` como
 * pivot no cliente.
 */
export async function getMonthlyUsage(tenantId: string): Promise<{
  totalTokens: number;
  costUsd: number;
  totalFallbackTokens: number;
  totalFallbackCostUsd: number;
  breakdown: MonthlyUsageBreakdownRow[];
}> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const rows = await prisma.aIUsageLog.groupBy({
    by: ['provider', 'model', 'usedFallback'],
    where: { tenantId, createdAt: { gte: start }, success: true },
    _sum: { totalTokens: true, costUsd: true },
    _count: { _all: true },
  });

  const pivot = new Map<string, MonthlyUsageBreakdownRow>();
  let totalTokens = 0;
  let costUsd = 0;
  let totalFallbackTokens = 0;
  let totalFallbackCostUsd = 0;

  for (const r of rows) {
    const key = `${r.provider}::${r.model}`;
    const cur =
      pivot.get(key) ??
      {
        provider: r.provider,
        model: r.model,
        tokens: 0,
        cost: 0,
        requests: 0,
        fallbackTokens: 0,
        fallbackCost: 0,
        fallbackRequests: 0,
      };
    const t = r._sum.totalTokens ?? 0;
    const c = Number(r._sum.costUsd ?? 0);
    const n = r._count._all;
    if (r.usedFallback) {
      cur.fallbackTokens += t;
      cur.fallbackCost += c;
      cur.fallbackRequests += n;
      totalFallbackTokens += t;
      totalFallbackCostUsd += c;
    } else {
      cur.tokens += t;
      cur.cost += c;
      cur.requests += n;
    }
    totalTokens += t;
    costUsd += c;
    pivot.set(key, cur);
  }

  return {
    totalTokens,
    costUsd,
    totalFallbackTokens,
    totalFallbackCostUsd,
    breakdown: Array.from(pivot.values()).sort((a, b) => b.cost + b.fallbackCost - (a.cost + a.fallbackCost)),
  };
}
