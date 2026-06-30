/**
 * Formatadores compartilhados — Sprint 14.5.
 *
 * - `formatBRL`: valor monetário completo (R$ 287.555,00) para tooltips e
 *   contextos que comportam espaço.
 * - `formatBRLCompact`: forma curta (R$ 288k / R$ 1,2M) para cards densos
 *   como o OpportunityCard onde o overflow estraga o layout.
 *
 * Ambos usam `Intl.NumberFormat` para evitar inconsistências de
 * separadores entre browsers.
 */

const BRL_FULL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatBRL(value: number): string {
  if (!Number.isFinite(value)) return 'R$ —';
  return BRL_FULL.format(value);
}

export function formatBRLCompact(value: number): string {
  if (!Number.isFinite(value)) return 'R$ —';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const v = value / 1_000_000;
    return `R$ ${v.toFixed(v >= 10 ? 0 : 1)}M`.replace('.', ',');
  }
  if (abs >= 1_000) {
    const v = value / 1_000;
    return `R$ ${v.toFixed(0)}k`;
  }
  return `R$ ${value.toFixed(0)}`;
}

export function formatPercent(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(fractionDigits)}%`;
}

export function formatRelativeDate(d: Date): string {
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  if (days === -1) return 'ontem';
  if (days < 0) return `há ${-days}d`;
  return `em ${days}d`;
}

// ─── Máscaras CNPJ / CEP (Sprint 15C) ─────────────────────────────
// Mantêm o estado canônico (apenas dígitos) e expõem só a string
// formatada na UI. Usar `unformatX` antes de validar/persistir.

export function formatCNPJ(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  }
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function unformatCNPJ(value: string): string {
  return value.replace(/\D/g, '');
}

export function formatCEP(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function unformatCEP(value: string): string {
  return value.replace(/\D/g, '');
}
