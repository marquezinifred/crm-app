import type { AIProvider } from '@prisma/client';

/**
 * P-23 — Computação pura dos alertas do Card D em /admin/ai.
 *
 * Recebe estado bruto do backend (breakerStatus + getConfig + listFeatures
 * + featureUsageForAlerts) e devolve a lista de alertas visíveis, na
 * ordem de exibição. Separado da page pra ficar testável sem mockar tRPC.
 *
 * Regras cobertas:
 *   1. CIRCUIT_OPEN — provider em circuit aberto (🔴 com [Limpar])
 *   2. MISSING_KEY — feature ativa (INCLUDED/ADDON_ACTIVE) sem chave
 *      própria E tenant sem chave global (🔴)
 *   3. FALLBACK_FREQUENT — feature caiu no fallback ≥ N vezes nas
 *      últimas 24h (🟡, threshold interno em FALLBACK_ALERT_THRESHOLD)
 *   4. COST_ABOVE_THRESHOLD — custo mensal da feature > costAlertBrlMonthly
 *      configurado no TenantAiFeature (🟡)
 */

/**
 * Limite pra alerta FALLBACK_FREQUENT. Não exposto na UI ainda —
 * débito P-XX se virar necessidade de configuração por-tenant.
 */
export const FALLBACK_ALERT_THRESHOLD = 3;
export const FALLBACK_ALERT_WINDOW_HOURS = 24;

export type AiAlertSeverity = 'red' | 'yellow';

export interface AiAlert {
  id: string;
  severity: AiAlertSeverity;
  kind: 'CIRCUIT_OPEN' | 'MISSING_KEY' | 'FALLBACK_FREQUENT' | 'COST_ABOVE_THRESHOLD';
  provider?: AIProvider;
  featureId?: string;
  featureName?: string;
  featureCode?: string;
  fallbackCount?: number;
  windowHours?: number;
  costBrl?: number;
  thresholdBrl?: number;
  title: string;
  detail: string;
}

export interface FeatureUsageForAlerts {
  featureId: string;
  featureCode: string;
  featureName: string;
  fallbackCountLast24h: number;
  costBrlMtd: number;
  costAlertBrlMonthly: number | null;
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
  /**
   * Uso agregado por feature — opcional pra manter compat com callers
   * antigos (a page renderiza os 2 primeiros tipos mesmo sem essa info).
   */
  featureUsage?: FeatureUsageForAlerts[];
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

  for (const u of input.featureUsage ?? []) {
    if (u.fallbackCountLast24h >= FALLBACK_ALERT_THRESHOLD) {
      out.push({
        id: `fallback-${u.featureId}`,
        severity: 'yellow',
        kind: 'FALLBACK_FREQUENT',
        featureId: u.featureId,
        featureName: u.featureName,
        featureCode: u.featureCode,
        fallbackCount: u.fallbackCountLast24h,
        windowHours: FALLBACK_ALERT_WINDOW_HOURS,
        title: `Feature "${u.featureName}" caiu no fallback ${u.fallbackCountLast24h} vez${u.fallbackCountLast24h === 1 ? '' : 'es'} nas últimas ${FALLBACK_ALERT_WINDOW_HOURS}h`,
        detail:
          'Provider primário está falhando repetidamente. Considere trocar de provider ou revisar a chave.',
      });
    }
  }

  for (const u of input.featureUsage ?? []) {
    if (u.costAlertBrlMonthly === null) continue;
    if (u.costBrlMtd <= u.costAlertBrlMonthly) continue;
    out.push({
      id: `cost-${u.featureId}`,
      severity: 'yellow',
      kind: 'COST_ABOVE_THRESHOLD',
      featureId: u.featureId,
      featureName: u.featureName,
      featureCode: u.featureCode,
      costBrl: u.costBrlMtd,
      thresholdBrl: u.costAlertBrlMonthly,
      title: `Feature "${u.featureName}" gastou ${formatBrl(u.costBrlMtd)} neste mês`,
      detail: `Limite configurado: ${formatBrl(u.costAlertBrlMonthly)}. Revise consumo ou ajuste o alerta.`,
    });
  }

  return out;
}

function formatBrl(v: number): string {
  return v.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  });
}
