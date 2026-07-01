import { AiProviderError } from './adapters/types';
import type { LlmClient } from './adapters/types';
import { createClient } from './adapters/registry';
import { getBreaker } from './breakers';
import { resolveAiConfig } from './resolve';
import type { AIProvider } from '@prisma/client';

/**
 * Sprint 15F — Orquestrador com fallback.
 *
 * Loop de tentativas (primary → fallback), respeitando circuit breaker
 * por (provider, tenant).
 *
 * Regras:
 *   • `retryable=false` (chave inválida / model not found / ctx length)
 *      NÃO registra no circuit — falha "esperada" não deve derrubar
 *      o provider. Fallback ainda é tentado se configurado (chave
 *      diferente pode funcionar). Exceção: MODEL_NOT_FOUND e
 *      CONTEXT_LENGTH pulam o fallback (mesma falha esperada).
 *   • `retryable=true` (5xx / rate limit / credit) registra no circuit
 *      e tenta fallback.
 */

export interface CallResult<T> {
  result: T;
  usedProvider: AIProvider;
  usedFallback: boolean;
  configuredProvider: AIProvider;
}

export async function callAiWithFallback<T>(
  featureCode: string,
  tenantId: string,
  fn: (client: LlmClient, model: string) => Promise<T>,
): Promise<CallResult<T>> {
  const config = await resolveAiConfig(featureCode, tenantId);
  const configuredProvider = config.primary.provider;

  const attempts = [
    { ...config.primary, isFallback: false },
    ...(config.fallback ? [{ ...config.fallback, isFallback: true }] : []),
  ];

  let lastError: unknown = null;
  for (const attempt of attempts) {
    const breaker = getBreaker(attempt.provider, tenantId);
    if (breaker.isOpen()) {
      lastError = new Error(`Circuit aberto para ${attempt.provider}`);
      continue;
    }

    try {
      const client = createClient(attempt.provider, attempt.apiKey);
      const result = await fn(client, attempt.model);
      breaker.recordSuccess();
      return {
        result,
        usedProvider: attempt.provider,
        usedFallback: attempt.isFallback,
        configuredProvider,
      };
    } catch (err) {
      lastError = err;

      if (err instanceof AiProviderError) {
        if (err.retryable) {
          breaker.recordFailure();
        }
        // Não faz sentido tentar fallback se o problema é do modelo
        // (fallback tem alta chance de mesma falha esperada).
        if (
          err.kind === 'MODEL_NOT_FOUND' ||
          err.kind === 'CONTEXT_LENGTH'
        ) {
          throw err;
        }
      } else {
        // Erro não-normalizado — trate como retryable pra segurança.
        breaker.recordFailure();
      }
      // Continua pro próximo attempt (fallback ou fim do loop).
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error('Todas as tentativas de IA falharam.');
}
