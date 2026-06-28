import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/env';

/**
 * Wrapper do Anthropic SDK — Sprint 0 só expõe o cliente base.
 * Sprint 4 adiciona:
 *   - circuit breaker (3 falhas → aberto por 5min)
 *   - logging em ai_usage_logs com tokens/custo
 *   - integração obrigatória com DataMaskingService antes de toda chamada
 */

let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (_client) return _client;
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não configurada');
  }
  _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

export const MODELS = {
  HAIKU: env.ANTHROPIC_MODEL_HAIKU,
  SONNET: env.ANTHROPIC_MODEL_SONNET,
} as const;
