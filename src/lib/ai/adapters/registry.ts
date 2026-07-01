import type { AIProvider } from '@prisma/client';
import type { LlmClient } from './types';
import { AnthropicAdapter } from './anthropic';
import { OpenAIAdapter, PerplexityAdapter } from './openai';
import { GoogleAdapter } from './google';

/**
 * Constrói o adapter concreto pra um (provider, apiKey).
 *
 * Sem cache de instâncias — o custo é baixo (só constrói SDK) e cache
 * cross-tenant seria risco de vazamento de chave. Se latência virar
 * problema, cachear POR (provider, apiKey-fingerprint) com TTL curto.
 */
export function createClient(
  provider: AIProvider,
  apiKey: string,
): LlmClient {
  switch (provider) {
    case 'ANTHROPIC':
      return new AnthropicAdapter(apiKey);
    case 'OPENAI':
      return new OpenAIAdapter(apiKey);
    case 'PERPLEXITY':
      return new PerplexityAdapter(apiKey);
    case 'GOOGLE':
      return new GoogleAdapter(apiKey);
  }
}

/**
 * Query barata pra saber se um provider suporta embedding SEM construir
 * uma instância real com chave. Usado por resolveAiConfig na validação
 * de features SEARCH.
 */
export function providerSupportsEmbedding(provider: AIProvider): boolean {
  switch (provider) {
    case 'ANTHROPIC':
    case 'PERPLEXITY':
      return false;
    case 'OPENAI':
    case 'GOOGLE':
      return true;
  }
}
