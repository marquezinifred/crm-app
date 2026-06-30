import { env } from '@/lib/env';

/**
 * Pricing de IA — Sprint 15B.
 *
 * Tabela de USD por 1M tokens (input e output) para cada provider/model
 * suportado pelo Venzo. Valores publicados em junho/2026 — recalibrar
 * trimestralmente pelo Platform Owner se a tabela do fornecedor mudar.
 *
 * `priceBrl(provider, model, tokensInput, tokensOutput)` retorna o R$
 * que a Plataforma vai mostrar (USD × USD_BRL_RATE × (1 + margem)).
 * O `costUsd` puro (sem margem nem câmbio) continua em `ai_usage_logs`
 * para auditoria fiscal.
 */

export type PriceEntry = {
  /** USD por 1.000.000 de tokens de input */
  inputUsdPerM: number;
  /** USD por 1.000.000 de tokens de output */
  outputUsdPerM: number;
};

/** Provider → Model → preço. Atualizar conforme tabela do fornecedor. */
export const PRICE_TABLE: Record<string, Record<string, PriceEntry>> = {
  anthropic: {
    'claude-haiku-4-5-20251001': { inputUsdPerM: 0.80, outputUsdPerM: 4.00 },
    'claude-sonnet-4-6':         { inputUsdPerM: 3.00, outputUsdPerM: 15.00 },
    'claude-opus-4-8':           { inputUsdPerM: 15.00, outputUsdPerM: 75.00 },
  },
  openai: {
    'text-embedding-3-small': { inputUsdPerM: 0.02, outputUsdPerM: 0 },
    'gpt-4o-mini':            { inputUsdPerM: 0.15, outputUsdPerM: 0.60 },
    'gpt-4o':                 { inputUsdPerM: 2.50, outputUsdPerM: 10.00 },
  },
  perplexity: {
    'llama-3.1-sonar-small-128k-online': { inputUsdPerM: 0.20, outputUsdPerM: 0.20 },
  },
  google: {
    'gemini-1.5-flash': { inputUsdPerM: 0.075, outputUsdPerM: 0.30 },
    'gemini-1.5-pro':   { inputUsdPerM: 1.25, outputUsdPerM: 5.00 },
  },
};

export const PRICING_FALLBACK: PriceEntry = { inputUsdPerM: 0, outputUsdPerM: 0 };

export function lookupPrice(provider: string, model: string): PriceEntry {
  return PRICE_TABLE[provider]?.[model] ?? PRICING_FALLBACK;
}

/**
 * Custo bruto em USD para os tokens informados.
 */
export function costUsd(
  provider: string,
  model: string,
  tokensInput: number,
  tokensOutput: number,
): number {
  const p = lookupPrice(provider, model);
  return (tokensInput * p.inputUsdPerM + tokensOutput * p.outputUsdPerM) / 1_000_000;
}

/**
 * Preço em R$ apresentado ao Platform Owner / billing — USD × câmbio
 * × (1 + margem).
 */
export function priceBrl(
  provider: string,
  model: string,
  tokensInput: number,
  tokensOutput: number,
): number {
  const raw = costUsd(provider, model, tokensInput, tokensOutput);
  return raw * env.USD_BRL_RATE * (1 + env.AI_PLATFORM_MARGIN);
}

/**
 * Converte qualquer valor USD já calculado em R$ com margem aplicada.
 * Útil pra agregar `ai_usage_logs.cost_usd` (já em USD) em rollups.
 */
export function usdToBrlWithMargin(usd: number): number {
  return usd * env.USD_BRL_RATE * (1 + env.AI_PLATFORM_MARGIN);
}
