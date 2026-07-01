/**
 * Sprint 15F — Interface unificada de providers de IA.
 *
 * Cada adapter (Anthropic / OpenAI / Google / Perplexity) implementa
 * `LlmClient`. `resolveAiConfig` valida `supportsEmbedding` antes de
 * chegar ao callback — evita erro de runtime opaco dentro de `fn`.
 */

import type { AIProvider } from '@prisma/client';

export interface LlmMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LlmChatParams {
  model: string;
  messages: LlmMessage[];
  systemPrompt?: string;
  maxTokens: number;
  temperature?: number;
}

export interface LlmChatResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  raw: unknown;
}

export interface LlmEmbedParams {
  model: string;
  input: string[];
}

export interface LlmEmbedResult {
  vectors: number[][];
  usage: { inputTokens: number };
}

export interface LlmClient {
  provider: AIProvider;
  supportsEmbedding: boolean;
  chat(params: LlmChatParams): Promise<LlmChatResult>;
  embed?(params: LlmEmbedParams): Promise<LlmEmbedResult>;
}

/**
 * Erro normalizado de qualquer provider. `retryable=false` significa
 * que o circuit breaker NÃO registra falha (chave inválida, model
 * not found, context length). Fallback ainda é tentado quando faz
 * sentido — a decisão fica em `callAiWithFallback`.
 */
export class AiProviderError extends Error {
  public readonly provider: AIProvider;
  public readonly status: number | null;
  public readonly retryable: boolean;
  public readonly kind:
    | 'AUTH'
    | 'RATE_LIMIT'
    | 'INSUFFICIENT_CREDIT'
    | 'SERVER'
    | 'TIMEOUT'
    | 'MODEL_NOT_FOUND'
    | 'CONTEXT_LENGTH'
    | 'UNKNOWN';

  constructor(opts: {
    provider: AIProvider;
    status: number | null;
    retryable: boolean;
    kind: AiProviderError['kind'];
    message: string;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = 'AiProviderError';
    this.provider = opts.provider;
    this.status = opts.status;
    this.retryable = opts.retryable;
    this.kind = opts.kind;
    if (opts.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = opts.cause;
    }
  }
}

/**
 * Traduz HTTP status → kind + retryable padronizado.
 *
 * Regras da spec Sprint 15F (seção 3.2.2):
 *   5xx / timeout          → retryable=true  (circuit registra + fallback tenta)
 *   429                    → retryable=true
 *   400 credit / 402       → retryable=true  (temporário — recarga)
 *   401 / 403              → retryable=false (chave inválida — circuit NÃO registra
 *                                             mas fallback com chave diferente tenta)
 *   Model not found / ctx  → retryable=false (fallback tem mesma probabilidade)
 */
export function classifyStatus(
  status: number | null,
  bodyText: string,
): { kind: AiProviderError['kind']; retryable: boolean } {
  if (status == null) {
    return { kind: 'TIMEOUT', retryable: true };
  }
  if (status >= 500) return { kind: 'SERVER', retryable: true };
  if (status === 429) return { kind: 'RATE_LIMIT', retryable: true };
  if (status === 401 || status === 403) return { kind: 'AUTH', retryable: false };
  if (status === 402) return { kind: 'INSUFFICIENT_CREDIT', retryable: true };
  if (status === 400) {
    const lower = bodyText.toLowerCase();
    if (lower.includes('credit') || lower.includes('billing')) {
      return { kind: 'INSUFFICIENT_CREDIT', retryable: true };
    }
    if (lower.includes('model') && lower.includes('not')) {
      return { kind: 'MODEL_NOT_FOUND', retryable: false };
    }
    if (lower.includes('context') || lower.includes('max_tokens')) {
      return { kind: 'CONTEXT_LENGTH', retryable: false };
    }
  }
  return { kind: 'UNKNOWN', retryable: status >= 500 };
}
