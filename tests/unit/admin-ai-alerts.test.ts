// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';

import { describe, it, expect } from 'vitest';
import { computeAiAlerts } from '@/lib/ai/admin-alerts';

/**
 * P-23 — Card D lógica pura. Sem tRPC, sem React.
 */

describe('computeAiAlerts', () => {
  const feat = (over: Partial<{
    id: string;
    name: string;
    effectiveStatus: 'INCLUDED' | 'ADDON_ACTIVE' | 'DISABLED';
    hasOwnKey: boolean;
  }> = {}) => ({
    id: over.id ?? 'f1',
    name: over.name ?? 'Feature A',
    effectiveStatus: over.effectiveStatus ?? 'INCLUDED',
    hasOwnKey: over.hasOwnKey ?? false,
  });

  it('retorna lista vazia quando nada está errado', () => {
    const r = computeAiAlerts({
      breakers: [{ provider: 'ANTHROPIC', open: false }],
      tenantHasGlobalKey: true,
      features: [feat()],
    });
    expect(r).toEqual([]);
  });

  it('emite alerta CIRCUIT_OPEN para cada provider com breaker aberto', () => {
    const r = computeAiAlerts({
      breakers: [
        { provider: 'ANTHROPIC', open: true },
        { provider: 'OPENAI', open: false },
        { provider: 'GOOGLE', open: true },
      ],
      tenantHasGlobalKey: true,
      features: [],
    });
    expect(r).toHaveLength(2);
    expect(r[0]!.kind).toBe('CIRCUIT_OPEN');
    expect(r[0]!.provider).toBe('ANTHROPIC');
    expect(r[0]!.severity).toBe('red');
    expect(r[1]!.provider).toBe('GOOGLE');
  });

  it('CIRCUIT_OPEN traduz o nome do provider em portugues', () => {
    const r = computeAiAlerts({
      breakers: [{ provider: 'PERPLEXITY', open: true }],
      tenantHasGlobalKey: true,
      features: [],
    });
    expect(r[0]!.title).toContain('Perplexity');
  });

  it('emite MISSING_KEY quando feature ativa sem chave + tenant sem chave global', () => {
    const r = computeAiAlerts({
      breakers: [],
      tenantHasGlobalKey: false,
      features: [feat({ name: 'Resumo IA', hasOwnKey: false })],
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe('MISSING_KEY');
    expect(r[0]!.featureName).toBe('Resumo IA');
    expect(r[0]!.title).toContain('Resumo IA');
  });

  it('não emite MISSING_KEY quando feature tem chave própria', () => {
    const r = computeAiAlerts({
      breakers: [],
      tenantHasGlobalKey: false,
      features: [feat({ hasOwnKey: true })],
    });
    expect(r).toEqual([]);
  });

  it('não emite MISSING_KEY quando tenant tem chave global (herança cobre)', () => {
    const r = computeAiAlerts({
      breakers: [],
      tenantHasGlobalKey: true,
      features: [feat({ hasOwnKey: false })],
    });
    expect(r).toEqual([]);
  });

  it('não emite MISSING_KEY para feature DISABLED (não vai ser chamada)', () => {
    const r = computeAiAlerts({
      breakers: [],
      tenantHasGlobalKey: false,
      features: [feat({ effectiveStatus: 'DISABLED', hasOwnKey: false })],
    });
    expect(r).toEqual([]);
  });

  it('emite MISSING_KEY para ADDON_ACTIVE (feature ativa via add-on também)', () => {
    const r = computeAiAlerts({
      breakers: [],
      tenantHasGlobalKey: false,
      features: [feat({ effectiveStatus: 'ADDON_ACTIVE', hasOwnKey: false })],
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe('MISSING_KEY');
  });

  it('combina CIRCUIT_OPEN + MISSING_KEY na ordem: breakers primeiro, missing depois', () => {
    const r = computeAiAlerts({
      breakers: [{ provider: 'ANTHROPIC', open: true }],
      tenantHasGlobalKey: false,
      features: [feat({ id: 'x', name: 'Busca' })],
    });
    expect(r).toHaveLength(2);
    expect(r[0]!.kind).toBe('CIRCUIT_OPEN');
    expect(r[1]!.kind).toBe('MISSING_KEY');
  });

  it('IDs de alerta são únicos por (kind, provider|featureId)', () => {
    const r = computeAiAlerts({
      breakers: [
        { provider: 'ANTHROPIC', open: true },
        { provider: 'OPENAI', open: true },
      ],
      tenantHasGlobalKey: false,
      features: [
        feat({ id: 'a', name: 'A' }),
        feat({ id: 'b', name: 'B' }),
      ],
    });
    const ids = new Set(r.map((a) => a.id));
    expect(ids.size).toBe(r.length);
    expect(ids.has('breaker-ANTHROPIC')).toBe(true);
    expect(ids.has('breaker-OPENAI')).toBe(true);
    expect(ids.has('nokey-a')).toBe(true);
    expect(ids.has('nokey-b')).toBe(true);
  });

  // ── P-23 refino: FALLBACK_FREQUENT + COST_ABOVE_THRESHOLD ────────

  const usage = (over: Partial<{
    featureId: string;
    featureCode: string;
    featureName: string;
    fallbackCountLast24h: number;
    costBrlMtd: number;
    costAlertBrlMonthly: number | null;
  }> = {}) => ({
    featureId: over.featureId ?? 'u1',
    featureCode: over.featureCode ?? 'communication-summary',
    featureName: over.featureName ?? 'Resumos',
    fallbackCountLast24h: over.fallbackCountLast24h ?? 0,
    costBrlMtd: over.costBrlMtd ?? 0,
    costAlertBrlMonthly: over.costAlertBrlMonthly ?? null,
  });

  it('emite FALLBACK_FREQUENT quando fallbackCountLast24h >= 3', () => {
    const r = computeAiAlerts({
      breakers: [],
      tenantHasGlobalKey: true,
      features: [],
      featureUsage: [usage({ fallbackCountLast24h: 3 })],
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe('FALLBACK_FREQUENT');
    expect(r[0]!.severity).toBe('yellow');
    expect(r[0]!.fallbackCount).toBe(3);
    expect(r[0]!.windowHours).toBe(24);
    expect(r[0]!.title).toContain('Resumos');
    expect(r[0]!.title).toContain('3');
  });

  it('não emite FALLBACK_FREQUENT quando < 3 (limite exato)', () => {
    const r = computeAiAlerts({
      breakers: [],
      tenantHasGlobalKey: true,
      features: [],
      featureUsage: [usage({ fallbackCountLast24h: 2 })],
    });
    expect(r).toEqual([]);
  });

  it('emite COST_ABOVE_THRESHOLD quando costBrlMtd > costAlertBrlMonthly', () => {
    const r = computeAiAlerts({
      breakers: [],
      tenantHasGlobalKey: true,
      features: [],
      featureUsage: [
        usage({
          featureName: 'Busca semântica',
          costBrlMtd: 200.5,
          costAlertBrlMonthly: 150,
        }),
      ],
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe('COST_ABOVE_THRESHOLD');
    expect(r[0]!.severity).toBe('yellow');
    expect(r[0]!.costBrl).toBeCloseTo(200.5);
    expect(r[0]!.thresholdBrl).toBe(150);
    expect(r[0]!.title).toContain('Busca semântica');
  });

  it('não emite COST_ABOVE_THRESHOLD quando threshold é null (não configurado)', () => {
    const r = computeAiAlerts({
      breakers: [],
      tenantHasGlobalKey: true,
      features: [],
      featureUsage: [
        usage({ costBrlMtd: 999, costAlertBrlMonthly: null }),
      ],
    });
    expect(r).toEqual([]);
  });

  it('não emite COST_ABOVE_THRESHOLD quando custo é igual ao threshold (comparação estrita)', () => {
    const r = computeAiAlerts({
      breakers: [],
      tenantHasGlobalKey: true,
      features: [],
      featureUsage: [
        usage({ costBrlMtd: 100, costAlertBrlMonthly: 100 }),
      ],
    });
    expect(r).toEqual([]);
  });

  it('combina 4 tipos de alerta na ordem: CIRCUIT → MISSING → FALLBACK → COST', () => {
    const r = computeAiAlerts({
      breakers: [{ provider: 'ANTHROPIC', open: true }],
      tenantHasGlobalKey: false,
      features: [feat({ id: 'x', name: 'X' })],
      featureUsage: [
        usage({
          featureId: 'u',
          featureName: 'Y',
          fallbackCountLast24h: 5,
          costBrlMtd: 300,
          costAlertBrlMonthly: 100,
        }),
      ],
    });
    expect(r.map((a) => a.kind)).toEqual([
      'CIRCUIT_OPEN',
      'MISSING_KEY',
      'FALLBACK_FREQUENT',
      'COST_ABOVE_THRESHOLD',
    ]);
  });

  it('compat: featureUsage undefined ainda produz alertas antigos', () => {
    const r = computeAiAlerts({
      breakers: [{ provider: 'ANTHROPIC', open: true }],
      tenantHasGlobalKey: true,
      features: [],
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe('CIRCUIT_OPEN');
  });
});
