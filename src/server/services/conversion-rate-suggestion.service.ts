import { prisma } from '@/server/db/client';
import { masking } from '@/lib/ai/masking';
import { getAnthropicForTenant, MODELS } from '@/lib/ai/claude';
import { callAiFeature } from '@/lib/ai/feature-gate';
import { logAiUsage } from './ai-usage.service';
import { CircuitBreaker } from './ai-circuit-breaker';
import {
  STAGE_ORDER_ARR,
  DEFAULT_CONVERSION_RATES,
  computeFunnel,
  type OpportunitySnap,
} from './analytics.service';
import { AIProvider, OpportunityStage } from '@prisma/client';

/**
 * Sugere taxas de conversão por estágio para o tenant.
 *
 * Estratégia (§7.3 do spec):
 *   1. Se o tenant tem ≥ 30 oportunidades fechadas (WON/LOST), usa o histórico
 *      próprio: calcula taxa real estágio→próximo a partir do funil.
 *   2. Caso contrário, chama Claude Haiku com contexto de segmento e
 *      território. O modelo devolve sugestão + racional (mock de "benchmark
 *      de mercado" — Sprint posterior integra Perplexity de verdade).
 *
 * Sempre devolve a fonte para o Admin decidir se aceita.
 */

const breaker = new CircuitBreaker({ name: 'claude-haiku-conversion-rates' });

export interface ConversionRateSuggestion {
  source: 'history' | 'ai' | 'default';
  rationale: string;
  rates: Record<OpportunityStage, number>;
  sampleSize?: number;
  costUsd?: number;
}

const MIN_SAMPLES_FOR_HISTORY = 30;

export async function suggestConversionRates(
  tenantId: string,
  userId: string,
): Promise<ConversionRateSuggestion> {
  // 1. Tenta usar histórico
  const closed = await prisma.opportunity.count({
    where: { tenantId, deletedAt: null, status: { in: ['WON', 'LOST'] } },
  });

  if (closed >= MIN_SAMPLES_FOR_HISTORY) {
    const opps = await prisma.opportunity.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true,
        stage: true,
        status: true,
        estimatedValue: true,
        closedValue: true,
        ownerId: true,
        lossReason: true,
        createdAt: true,
        currentStageEnteredAt: true,
        actualCloseDate: true,
      },
    });
    const snaps: OpportunitySnap[] = opps.map((o) => ({
      ...o,
      estimatedValue: Number(o.estimatedValue ?? 0),
      closedValue: o.closedValue ? Number(o.closedValue) : null,
      ownerName: '',
    }));
    const funnel = computeFunnel(snaps);
    const rates = {} as Record<OpportunityStage, number>;
    for (const f of funnel) {
      rates[f.stage] = f.conversionToNextPct ?? DEFAULT_CONVERSION_RATES[f.stage];
    }
    return {
      source: 'history',
      rationale: `Calculado a partir de ${closed} oportunidades fechadas do próprio tenant.`,
      rates,
      sampleSize: closed,
    };
  }

  // 2. Fallback IA com contexto do tenant
  if (breaker.isOpen()) {
    return {
      source: 'default',
      rationale: 'IA indisponível. Usando taxas padrão B2B genéricas.',
      rates: { ...DEFAULT_CONVERSION_RATES },
    };
  }

  const ctxSeg = await prisma.segment.findMany({
    where: { tenantId, deletedAt: null },
    select: { name: true },
    take: 5,
  });
  const ctxTer = await prisma.territory.findMany({
    where: { tenantId, deletedAt: null },
    select: { name: true },
    take: 5,
  });

  const prompt = `Você é um analista comercial sênior B2B no Brasil. Sugira taxas de conversão de pipeline (% de cada estágio que avança para o próximo) para uma empresa que vende serviços/SaaS atuando nos seguintes contextos:

Segmentos: ${ctxSeg.map((s) => s.name).join(', ') || 'não informado'}
Territórios: ${ctxTer.map((t) => t.name).join(', ') || 'não informado'}

Estágios do funil: ${STAGE_ORDER_ARR.join(' → ')}.

Responda SOMENTE com JSON válido no formato:
{
  "rationale": "1-2 frases explicando o racional",
  "rates": {
    "PROSPECT": 0-100,
    "LEAD": 0-100,
    "OPORTUNIDADE": 0-100,
    "PROPOSTA": 0-100,
    "NEGOCIACAO": 0-100,
    "ACEITE": 0-100,
    "CONTRATO": 100
  }
}

CONTRATO deve sempre ser 100 (estágio terminal).`;

  const { masked, map } = masking.mask(prompt);
  const t0 = Date.now();
  let promptTokens = 0;
  let completionTokens = 0;
  let raw = '';
  let success = true;
  try {
    const completion = await callAiFeature(
      'conversion-rate-suggestion',
      { tenantId },
      async ({ model }) => {
        const client = await getAnthropicForTenant(tenantId);
        return client.messages.create({
          model: model || MODELS.HAIKU,
          max_tokens: 512,
          messages: [{ role: 'user', content: masked }],
        });
      },
    );
    promptTokens = completion.usage.input_tokens;
    completionTokens = completion.usage.output_tokens;
    raw = completion.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    breaker.recordSuccess();
  } catch {
    success = false;
    breaker.recordFailure();
  } finally {
    await logAiUsage({
      tenantId,
      userId,
      provider: AIProvider.ANTHROPIC,
      model: MODELS.HAIKU,
      promptTokens,
      completionTokens,
      requestType: 'conversion_rate_suggestion',
      latencyMs: Date.now() - t0,
      success,
    });
  }

  if (!success) {
    return {
      source: 'default',
      rationale: 'Falha ao consultar IA. Usando taxas padrão B2B genéricas.',
      rates: { ...DEFAULT_CONVERSION_RATES },
    };
  }

  try {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const json = fence?.[1] ?? raw;
    const parsed = JSON.parse(json) as {
      rationale?: string;
      rates?: Partial<Record<OpportunityStage, number>>;
    };
    const rates = { ...DEFAULT_CONVERSION_RATES };
    if (parsed.rates) {
      for (const s of STAGE_ORDER_ARR) {
        const v = parsed.rates[s];
        if (typeof v === 'number' && v >= 0 && v <= 100) rates[s] = v;
      }
    }
    rates.CONTRATO = 100;
    return {
      source: 'ai',
      rationale: masking.unmask(parsed.rationale ?? 'Sugestão IA baseada em benchmarks.', map),
      rates,
      costUsd: (promptTokens * 1.0 + completionTokens * 5.0) / 1_000_000,
    };
  } catch {
    return {
      source: 'default',
      rationale: 'IA retornou JSON inválido. Usando taxas padrão.',
      rates: { ...DEFAULT_CONVERSION_RATES },
    };
  }
}
