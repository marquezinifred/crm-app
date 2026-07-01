import Anthropic from '@anthropic-ai/sdk';
import { TRPCError } from '@trpc/server';

/**
 * Mapeia erros estruturados da Anthropic (`APIError`) para `TRPCError`
 * com código e mensagem que o usuário final consegue agir. Ex.: "sem
 * créditos", "chave inválida", "rate limit — tente em 30s".
 *
 * 5xx e erros de rede caem em `null` — caller mantém o comportamento
 * de circuit breaker + fallback silencioso (aiGenerated: false).
 *
 * Retorna `null` se o erro não é da Anthropic ou é 5xx (retryable).
 */
export function mapAnthropicError(err: unknown): TRPCError | null {
  if (!(err instanceof Anthropic.APIError)) return null;

  const status = err.status;
  const rawMsg = err.message ?? '';

  if (status === 400 && /credit balance/i.test(rawMsg)) {
    return new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        'Sem créditos na conta Anthropic. Adicione créditos em https://console.anthropic.com/settings/billing.',
    });
  }

  if (status === 402) {
    return new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Sem créditos na conta Anthropic.',
    });
  }

  if (status === 401 || status === 403) {
    return new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Chave Anthropic inválida ou revogada. Atualize em /admin/ai.',
    });
  }

  if (status === 429) {
    const retryAfterHeader = err.headers?.['retry-after'];
    const retryAfter =
      typeof retryAfterHeader === 'string' && retryAfterHeader.trim().length > 0
        ? retryAfterHeader.trim()
        : null;
    return new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: retryAfter
        ? `Rate limit Anthropic. Tente novamente em ${retryAfter}s.`
        : 'Rate limit Anthropic. Tente novamente em alguns segundos.',
    });
  }

  // 5xx e status desconhecidos: deixa caller aplicar circuit breaker /
  // fallback silencioso. Retorna null pra sinalizar "não é erro
  // acionável pelo usuário".
  return null;
}
