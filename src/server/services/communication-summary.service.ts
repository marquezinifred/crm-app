import { TRPCError } from '@trpc/server';
import { masking } from '@/lib/ai/masking';
import { getAnthropicForTenant, MODELS } from '@/lib/ai/claude';
import { mapAnthropicError } from '@/lib/ai/anthropic-errors';
import {
  callAiFeature,
  AiLimitExceededError,
  FeatureNotAvailableError,
} from '@/lib/ai/feature-gate';
import { logAiUsage } from './ai-usage.service';
import { CircuitBreaker } from './ai-circuit-breaker';
import { AIProvider } from '@prisma/client';

/**
 * Receptor de comunicações (§6.2 do spec):
 *   - Recebe texto livre (e-mail/WhatsApp colado pelo gestor)
 *   - Mascara PII via DataMaskingService (obrigatório, regra arquitetural)
 *   - Envia para Claude Haiku
 *   - Pede resposta JSON estruturada com 4 blocos + próximos passos
 *   - Desmascara antes de devolver ao usuário
 *   - Grava ai_usage_log com tokens/custo/latência
 *
 * Falhas:
 *   - circuit aberto → retorna mode=manual (UI cai pro form vazio)
 *   - resposta não-JSON → tenta extrair JSON do bloco markdown; se falhar,
 *     devolve resumo bruto no campo "themes"
 */

const breaker = new CircuitBreaker({ name: 'claude-haiku-summary' });

export interface ProposedTask {
  title: string;
  /** ISO date sem hora (YYYY-MM-DD) quando identificável; null caso contrário */
  dueDate: string | null;
  /** Nome ou cargo do responsável, quando mencionado no texto */
  assigneeHint: string | null;
}

export interface CommunicationSummary {
  themes: string[];
  adjustments: string[];
  decisions: string[];
  nextSteps: ProposedTask[];
  /** false quando IA falhou ou circuit aberto */
  aiGenerated: boolean;
  /** Custo em USD desta chamada (0 se manual/cache) */
  costUsd?: number;
}

export interface SummarizeInput {
  text: string;
  tenantId: string;
  userId: string;
  opportunityId?: string;
}

const SYSTEM_PROMPT = `Você é um assistente que extrai informação estruturada de comunicações comerciais (e-mails, WhatsApp, anotações de reunião) em português brasileiro.

A entrada PODE conter tokens marcadores como [PESSOA_1], [EMPRESA_1], [EMAIL_1], [VALOR_1], [PHONE_1], [CPF_1], [CNPJ_1], [ENDERECO_1]. PRESERVE esses tokens EXATAMENTE como aparecem na sua resposta — eles serão substituídos depois.

Responda SOMENTE com um objeto JSON válido, sem markdown, sem prefácio. Esquema:
{
  "themes": ["tema 1", "tema 2", ...],          // até 5 itens curtos
  "adjustments": ["ajuste 1", ...],              // ajustes técnicos/comerciais mencionados
  "decisions": ["decisão tomada 1", ...],        // decisões registradas na conversa
  "nextSteps": [                                  // ações pendentes com responsável e prazo
    { "title": "string", "dueDate": "YYYY-MM-DD" | null, "assigneeHint": "string" | null }
  ]
}

Se algum bloco não tiver conteúdo, retorne array vazio. Não invente datas; só inclua dueDate se mencionada explicitamente.`;

function parseSummaryJson(raw: string): Omit<CommunicationSummary, 'aiGenerated' | 'costUsd'> {
  let text = raw.trim();
  // Remove blocos markdown caso o modelo tenha encapsulado em ```json ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) text = fence[1].trim();
  try {
    const parsed = JSON.parse(text) as Partial<CommunicationSummary>;
    return {
      themes: Array.isArray(parsed.themes) ? parsed.themes : [],
      adjustments: Array.isArray(parsed.adjustments) ? parsed.adjustments : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      nextSteps: Array.isArray(parsed.nextSteps)
        ? parsed.nextSteps.map((t) => ({
            title: String(t.title ?? ''),
            dueDate: t.dueDate ? String(t.dueDate) : null,
            assigneeHint: t.assigneeHint ? String(t.assigneeHint) : null,
          })).filter((t) => t.title.length > 0)
        : [],
    };
  } catch {
    return {
      themes: [text.slice(0, 500)],
      adjustments: [],
      decisions: [],
      nextSteps: [],
    };
  }
}

export async function summarizeCommunication(
  input: SummarizeInput,
): Promise<CommunicationSummary> {
  if (breaker.isOpen()) {
    return {
      themes: [], adjustments: [], decisions: [], nextSteps: [],
      aiGenerated: false,
    };
  }

  const { masked, map } = masking.mask(input.text);

  const t0 = Date.now();
  let promptTokens = 0;
  let completionTokens = 0;
  let success = true;
  let errorCode: string | null = null;
  let rawResponse = '';
  let gateError: FeatureNotAvailableError | AiLimitExceededError | null = null;
  let providerError: TRPCError | null = null;

  try {
    const completion = await callAiFeature(
      'communication-summary',
      { tenantId: input.tenantId },
      async ({ model }) => {
        const client = await getAnthropicForTenant(input.tenantId);
        return client.messages.create({
          model: model || MODELS.HAIKU,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: masked }],
        });
      },
    );
    promptTokens = completion.usage.input_tokens;
    completionTokens = completion.usage.output_tokens;
    rawResponse = completion.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    breaker.recordSuccess();
  } catch (err) {
    success = false;
    errorCode = err instanceof Error ? err.name : 'unknown';
    if (
      err instanceof FeatureNotAvailableError ||
      err instanceof AiLimitExceededError
    ) {
      gateError = err;
    } else {
      const mapped = mapAnthropicError(err);
      if (mapped) {
        errorCode = `anthropic_${(err as { status?: number }).status ?? 'unknown'}`;
        providerError = mapped;
      } else {
        breaker.recordFailure();
      }
    }
  } finally {
    const latencyMs = Date.now() - t0;
    await logAiUsage({
      tenantId: input.tenantId,
      userId: input.userId,
      provider: AIProvider.ANTHROPIC,
      model: MODELS.HAIKU,
      promptTokens,
      completionTokens,
      requestType: 'communication_summary',
      latencyMs,
      success,
      errorCode,
    });
  }

  if (gateError) {
    throw gateError;
  }

  if (providerError) {
    throw providerError;
  }

  if (!success) {
    return {
      themes: [], adjustments: [], decisions: [], nextSteps: [],
      aiGenerated: false,
    };
  }

  const parsed = parseSummaryJson(rawResponse);

  // Desmascara cada string da resposta
  const unmaskList = (xs: string[]) => xs.map((s) => masking.unmask(s, map));
  return {
    themes: unmaskList(parsed.themes),
    adjustments: unmaskList(parsed.adjustments),
    decisions: unmaskList(parsed.decisions),
    nextSteps: parsed.nextSteps.map((t) => ({
      title: masking.unmask(t.title, map),
      dueDate: t.dueDate,
      assigneeHint: t.assigneeHint ? masking.unmask(t.assigneeHint, map) : null,
    })),
    aiGenerated: true,
    costUsd: calculateCostInline(promptTokens, completionTokens),
  };
}

function calculateCostInline(promptTokens: number, completionTokens: number): number {
  // Haiku 4.5: $1/M input, $5/M output
  return (promptTokens * 1.0 + completionTokens * 5.0) / 1_000_000;
}

// Exportado para testes
export const __test = { parseSummaryJson, breaker };
