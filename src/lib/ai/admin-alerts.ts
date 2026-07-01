import type { AIProvider } from '@prisma/client';

/**
 * P-23 — Computação pura dos alertas do Card D em /admin/ai.
 *
 * Recebe estado bruto do backend (breakerStatus + getConfig + listFeatures)
 * e devolve a lista de alertas visíveis, na ordem de exibição. Separado da
 * page pra ficar testável sem mockar tRPC.
 *
 * Regras cobertas hoje:
 *   1. Provider em circuit aberto → 🔴 com ação [Limpar]
 *   2. Feature ativa (INCLUDED/ADDON_ACTIVE) sem chave própria E tenant sem
 *      chave global → 🔴 (sem-chave — chamada vai falhar)
 *
 * Casos que ficam de fora (registrados como refinamento em P-XX):
 *   - Feature em fallback frequente (precisa consulta em ai_usage_logs)
 *   - Feature acima do threshold de custo mensal
 */

export type AiAlertSeverity = 'red' | 'yellow';

export interface AiAlert {
  id: string;
  severity: AiAlertSeverity;
  kind: 'CIRCUIT_OPEN' | 'MISSING_KEY';
  provider?: AIProvider;
  featureId?: string;
  featureName?: string;
  title: string;
  detail: string;
}

export interface AlertInputs {
  breakers: Array<{
    provider: AIProvider;
    open: boolean;
  }>;
  tenantHasGlobalKey: boolean;
  features: Array<{
    id: string;
    name: string;
    effectiveStatus: 'INCLUDED' | 'ADDON_ACTIVE' | 'DISABLED';
    hasOwnKey: boolean;
  }>;
}

const PROVIDER_LABEL: Record<AIProvider, string> = {
  ANTHROPIC: 'Anthropic',
  OPENAI: 'OpenAI',
  GOOGLE: 'Google',
  PERPLEXITY: 'Perplexity',
};

export function computeAiAlerts(input: AlertInputs): AiAlert[] {
  const out: AiAlert[] = [];

  for (const b of input.breakers) {
    if (!b.open) continue;
    out.push({
      id: `breaker-${b.provider}`,
      severity: 'red',
      kind: 'CIRCUIT_OPEN',
      provider: b.provider,
      title: `Provider ${PROVIDER_LABEL[b.provider]} em circuit aberto`,
      detail:
        'Chamadas ao provider primário estão sendo puladas até o breaker fechar.',
    });
  }

  for (const f of input.features) {
    if (f.effectiveStatus === 'DISABLED') continue;
    if (f.hasOwnKey) continue;
    if (input.tenantHasGlobalKey) continue;
    out.push({
      id: `nokey-${f.id}`,
      severity: 'red',
      kind: 'MISSING_KEY',
      featureId: f.id,
      featureName: f.name,
      title: `Feature "${f.name}" sem chave configurada`,
      detail:
        'Nem esta feature nem o tenant têm chave — as chamadas vão falhar até você configurar.',
    });
  }

  return out;
}
