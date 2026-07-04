import { env } from '@/lib/env';
import { getAnthropicForTenant } from './claude';
import { callAiFeature } from './feature-gate';
import { callAiWithFallback } from './call';
import type { LlmChatParams, LlmEmbedParams } from './adapters/types';
import type { AIProvider } from '@prisma/client';
import { addBreadcrumb } from '@/lib/monitoring/sentry';

/**
 * Sprint 15F — despacho unificado que respeita a feature flag
 * `MULTI_AI_ENABLED`. Todos os 5 services de IA consomem esta função
 * em vez de decidir a rota individualmente — assim o rollout gradual
 * (Fase 2 do plano de rollout) fica fácil de reverter.
 *
 * Semântica:
 *   • Legado (flag=false): resolve via `callAiFeature` (gate + limits)
 *     + `getAnthropicForTenant` — só suporta Anthropic. Fallback
 *     ignorado. `usedFallback` sempre false, `configuredProvider`
 *     sempre 'ANTHROPIC'.
 *   • Novo (flag=true): `callAiWithFallback` com o adapter certo.
 *
 * O caller passa **texto já mascarado** — DataMaskingService continua
 * responsabilidade do service (regra crítica da spec §3.2.7).
 */

export interface DispatchChatOutput {
  text: string;
  inputTokens: number;
  outputTokens: number;
  usedProvider: AIProvider;
  configuredProvider: AIProvider;
  usedFallback: boolean;
  model: string;
}

export interface DispatchChatInput {
  featureCode: string;
  tenantId: string;
  chat: Omit<LlmChatParams, 'model'> & { model?: string };
}

export async function dispatchChat(
  input: DispatchChatInput,
): Promise<DispatchChatOutput> {
  addBreadcrumb({
    category: 'ai.dispatch',
    message: input.featureCode,
    level: 'info',
    data: {
      tenantId: input.tenantId,
      multiEnabled: env.MULTI_AI_ENABLED,
      model: input.chat.model,
    },
  });
  if (env.MULTI_AI_ENABLED) {
    const call = await callAiWithFallback(
      input.featureCode,
      input.tenantId,
      async (client, model) => {
        return client.chat({ ...input.chat, model });
      },
    );
    return {
      text: call.result.text,
      inputTokens: call.result.usage.inputTokens,
      outputTokens: call.result.usage.outputTokens,
      usedProvider: call.usedProvider,
      configuredProvider: call.configuredProvider,
      usedFallback: call.usedFallback,
      model: input.chat.model ?? '',
    };
  }

  // Legado — Anthropic-only.
  return callAiFeature(
    input.featureCode,
    { tenantId: input.tenantId },
    async ({ model }) => {
      const client = await getAnthropicForTenant(input.tenantId);
      const completion = await client.messages.create({
        model: input.chat.model ?? model,
        max_tokens: input.chat.maxTokens,
        temperature: input.chat.temperature,
        system: input.chat.systemPrompt,
        messages: input.chat.messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
      });
      const text = completion.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join('');
      return {
        text,
        inputTokens: completion.usage.input_tokens,
        outputTokens: completion.usage.output_tokens,
        usedProvider: 'ANTHROPIC' as const,
        configuredProvider: 'ANTHROPIC' as const,
        usedFallback: false,
        model: input.chat.model ?? model,
      };
    },
  );
}

export interface DispatchEmbedInput {
  featureCode: string;
  tenantId: string;
  embed: LlmEmbedParams;
}

export interface DispatchEmbedOutput {
  vectors: number[][];
  inputTokens: number;
  usedProvider: AIProvider;
  configuredProvider: AIProvider;
  usedFallback: boolean;
  model: string;
}

/**
 * Embeddings — path novo (multi-provider) OU cai pro OpenAI legado
 * quando flag=false. Sem OpenAI adapter, semantic-search já cai pro
 * tsvector no serviço original.
 */
export async function dispatchEmbed(
  input: DispatchEmbedInput,
): Promise<DispatchEmbedOutput> {
  if (env.MULTI_AI_ENABLED) {
    const call = await callAiWithFallback(
      input.featureCode,
      input.tenantId,
      async (client, model) => {
        if (!client.embed) {
          throw new Error(
            `Adapter ${client.provider} não suporta embed. resolveAiConfig deveria ter bloqueado.`,
          );
        }
        return client.embed({ model, input: input.embed.input });
      },
    );
    return {
      vectors: call.result.vectors,
      inputTokens: call.result.usage.inputTokens,
      usedProvider: call.usedProvider,
      configuredProvider: call.configuredProvider,
      usedFallback: call.usedFallback,
      model: input.embed.model,
    };
  }

  // Legado — o service atual de semantic-search já tem seu próprio
  // fallback pra tsvector. Não expomos embed no path legado — retorna
  // vazio pra sinalizar que quem chamar tem que ter fallback próprio.
  return {
    vectors: [],
    inputTokens: 0,
    usedProvider: 'OPENAI' as const,
    configuredProvider: 'OPENAI' as const,
    usedFallback: false,
    model: input.embed.model,
  };
}
