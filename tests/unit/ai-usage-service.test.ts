// @vitest-environment node
// P-37 — cobre `ai-usage.service.ts` sem tocar em Prisma real.
// Escopo: AI_PRICING / calculateCost / logAiUsage / getMonthlyUsage.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockGroupBy = vi.fn();
vi.mock('@/server/db/client', () => ({
  prisma: {
    aIUsageLog: {
      create: (...args: unknown[]) => mockCreate(...args),
      groupBy: (...args: unknown[]) => mockGroupBy(...args),
    },
  },
}));

const mockAxiomLogAiUsage = vi.fn();
vi.mock('@/lib/monitoring/axiom', () => ({
  logAiUsage: (...args: unknown[]) => mockAxiomLogAiUsage(...args),
}));

// Stub env pra fixar USD_BRL_RATE e evitar depender do valor real.
vi.mock('@/lib/env', () => ({
  env: new Proxy({} as Record<string, unknown>, {
    get: (_t, prop) => {
      if (prop === 'USD_BRL_RATE') return 5;
      if (prop === 'AI_PLATFORM_MARGIN') return 0.2;
      return undefined;
    },
  }),
}));

import {
  AI_PRICING,
  calculateCost,
  logAiUsage,
  getMonthlyUsage,
} from '@/server/services/ai-usage.service';

describe('AI_PRICING + calculateCost', () => {
  it('AI_PRICING contém haiku + sonnet + opus + gpt', () => {
    expect(AI_PRICING['claude-haiku-4-5-20251001']).toEqual({
      input: 1,
      output: 5,
    });
    expect(AI_PRICING['claude-sonnet-4-6']).toEqual({ input: 3, output: 15 });
    expect(AI_PRICING['claude-opus-4-7']).toEqual({ input: 5, output: 25 });
    expect(AI_PRICING['gpt-4o-mini']).toEqual({ input: 0.15, output: 0.6 });
  });

  it('calculateCost: modelo conhecido — custo linear em prompt+completion', () => {
    // haiku: input 1 USD/M, output 5 USD/M
    // 1_000_000 prompt tokens + 1_000_000 completion tokens → 1 + 5 = 6
    expect(calculateCost('claude-haiku-4-5', 1_000_000, 1_000_000)).toBeCloseTo(6, 6);
    // 100k prompt tokens haiku = 0.1 USD; 100k completion = 0.5 USD → 0.6
    expect(calculateCost('claude-haiku-4-5', 100_000, 100_000)).toBeCloseTo(0.6, 6);
  });

  it('calculateCost: modelo desconhecido → 0 (não crasha)', () => {
    expect(calculateCost('gpt-99-turbo', 1_000_000, 1_000_000)).toBe(0);
    expect(calculateCost('', 100, 100)).toBe(0);
  });

  it('calculateCost: zero tokens → 0', () => {
    expect(calculateCost('claude-haiku-4-5', 0, 0)).toBe(0);
  });
});

describe('logAiUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue(undefined);
  });

  it('grava row com totalTokens e costUsd computados', async () => {
    await logAiUsage({
      tenantId: 'tenant-1',
      userId: 'user-1',
      provider: 'ANTHROPIC',
      model: 'claude-haiku-4-5',
      promptTokens: 1000,
      completionTokens: 2000,
      requestType: 'communication_summary',
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.tenantId).toBe('tenant-1');
    expect(call.data.userId).toBe('user-1');
    expect(call.data.provider).toBe('ANTHROPIC');
    expect(call.data.model).toBe('claude-haiku-4-5');
    expect(call.data.promptTokens).toBe(1000);
    expect(call.data.completionTokens).toBe(2000);
    expect(call.data.totalTokens).toBe(3000);
    // 1000 * 1 + 2000 * 5 = 11000 → 11000/1e6 = 0.011
    expect(call.data.costUsd).toBeCloseTo(0.011, 6);
    expect(call.data.requestType).toBe('communication_summary');
  });

  it('aplica defaults: usedFallback=false, configuredProvider=null, success=true, errorCode=null, latencyMs=null', async () => {
    await logAiUsage({
      tenantId: 't',
      userId: null,
      provider: 'OPENAI',
      model: 'gpt-4o-mini',
      promptTokens: 100,
      completionTokens: 100,
      requestType: 'embed',
    });

    const data = (mockCreate.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.usedFallback).toBe(false);
    expect(data.configuredProvider).toBeNull();
    expect(data.success).toBe(true);
    expect(data.errorCode).toBeNull();
    expect(data.latencyMs).toBeNull();
    expect(data.userId).toBeNull();
  });

  it('respeita overrides de success/errorCode/latencyMs/usedFallback/configuredProvider', async () => {
    await logAiUsage({
      tenantId: 't',
      userId: 'u',
      provider: 'OPENAI',
      model: 'gpt-4o',
      promptTokens: 10,
      completionTokens: 20,
      requestType: 'retry',
      success: false,
      errorCode: 'AUTH',
      latencyMs: 1234,
      usedFallback: true,
      configuredProvider: 'ANTHROPIC',
    });

    const data = (mockCreate.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.success).toBe(false);
    expect(data.errorCode).toBe('AUTH');
    expect(data.latencyMs).toBe(1234);
    expect(data.usedFallback).toBe(true);
    expect(data.configuredProvider).toBe('ANTHROPIC');
  });

  it('publica evento Axiom com costBrl = costUsd * USD_BRL_RATE', async () => {
    await logAiUsage({
      tenantId: 'tenant-brl',
      userId: null,
      provider: 'ANTHROPIC',
      model: 'claude-haiku-4-5',
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      requestType: 'summary',
      usedFallback: true,
      configuredProvider: 'ANTHROPIC',
    });

    expect(mockAxiomLogAiUsage).toHaveBeenCalledTimes(1);
    const evt = mockAxiomLogAiUsage.mock.calls[0]![0] as {
      costUsd: number;
      costBrl: number;
      usedFallback: boolean;
      configuredProvider: string | null;
      requestType: string;
      tenantId: string;
      provider: string;
    };
    // 1M haiku prompt + 1M haiku completion = 1 + 5 = 6 USD
    expect(evt.costUsd).toBeCloseTo(6, 6);
    // USD_BRL_RATE mockado = 5 → 30 BRL
    expect(evt.costBrl).toBeCloseTo(30, 6);
    expect(evt.usedFallback).toBe(true);
    expect(evt.configuredProvider).toBe('ANTHROPIC');
    expect(evt.requestType).toBe('summary');
    expect(evt.tenantId).toBe('tenant-brl');
  });

  it('quando Prisma falha, loga console.error e ainda publica no Axiom', async () => {
    mockCreate.mockRejectedValueOnce(new Error('conn refused'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await logAiUsage({
      tenantId: 't',
      userId: null,
      provider: 'ANTHROPIC',
      model: 'claude-haiku-4-5',
      promptTokens: 1,
      completionTokens: 1,
      requestType: 'x',
    });

    expect(errSpy).toHaveBeenCalled();
    expect(errSpy.mock.calls[0]![0]).toContain('[ai-usage]');
    // Axiom ainda foi chamado (fallback de observabilidade não bloqueia)
    expect(mockAxiomLogAiUsage).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it('modelo desconhecido → costUsd=0 no row + Axiom, sem crashar', async () => {
    await logAiUsage({
      tenantId: 't',
      userId: null,
      provider: 'OPENAI',
      model: 'gpt-99-unknown',
      promptTokens: 500,
      completionTokens: 500,
      requestType: 'unknown',
    });

    const data = (mockCreate.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.costUsd).toBe(0);
    expect(data.totalTokens).toBe(1000);

    const evt = mockAxiomLogAiUsage.mock.calls[0]![0] as { costUsd: number; costBrl: number };
    expect(evt.costUsd).toBe(0);
    expect(evt.costBrl).toBe(0);
  });
});

describe('getMonthlyUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('vazio quando não há rows no mês', async () => {
    mockGroupBy.mockResolvedValueOnce([]);

    const out = await getMonthlyUsage('tenant-empty');

    expect(out).toEqual({
      totalTokens: 0,
      costUsd: 0,
      totalFallbackTokens: 0,
      totalFallbackCostUsd: 0,
      breakdown: [],
    });
  });

  it('filtra por tenantId, success=true e createdAt >= início do mês', async () => {
    mockGroupBy.mockResolvedValueOnce([]);
    await getMonthlyUsage('tenant-42');

    const args = mockGroupBy.mock.calls[0]![0] as {
      by: string[];
      where: {
        tenantId: string;
        success: boolean;
        createdAt: { gte: Date };
      };
    };
    expect(args.by).toEqual(['provider', 'model', 'usedFallback']);
    expect(args.where.tenantId).toBe('tenant-42');
    expect(args.where.success).toBe(true);
    expect(args.where.createdAt.gte).toBeInstanceOf(Date);
    const gte = args.where.createdAt.gte;
    // Deve ser dia 1 do mês corrente, 00:00:00.
    expect(gte.getDate()).toBe(1);
    expect(gte.getHours()).toBe(0);
    expect(gte.getMinutes()).toBe(0);
    expect(gte.getSeconds()).toBe(0);
    expect(gte.getMilliseconds()).toBe(0);
  });

  it('agrupa (provider, model, usedFallback) e pivota primary vs fallback', async () => {
    mockGroupBy.mockResolvedValueOnce([
      {
        provider: 'ANTHROPIC',
        model: 'claude-haiku-4-5',
        usedFallback: false,
        _sum: { totalTokens: 1000, costUsd: 0.5 },
        _count: { _all: 3 },
      },
      {
        provider: 'ANTHROPIC',
        model: 'claude-haiku-4-5',
        usedFallback: true,
        _sum: { totalTokens: 200, costUsd: 0.1 },
        _count: { _all: 1 },
      },
      {
        provider: 'OPENAI',
        model: 'gpt-4o-mini',
        usedFallback: false,
        _sum: { totalTokens: 500, costUsd: 0.2 },
        _count: { _all: 2 },
      },
    ]);

    const out = await getMonthlyUsage('tenant-1');

    expect(out.totalTokens).toBe(1700);
    expect(out.costUsd).toBeCloseTo(0.8, 6);
    expect(out.totalFallbackTokens).toBe(200);
    expect(out.totalFallbackCostUsd).toBeCloseTo(0.1, 6);

    // 2 keys (haiku + gpt-4o-mini)
    expect(out.breakdown).toHaveLength(2);
    // Ordenado por (cost + fallbackCost) desc → haiku (0.5+0.1=0.6) > gpt (0.2)
    expect(out.breakdown[0]!.model).toBe('claude-haiku-4-5');
    expect(out.breakdown[0]!.tokens).toBe(1000);
    expect(out.breakdown[0]!.cost).toBeCloseTo(0.5, 6);
    expect(out.breakdown[0]!.requests).toBe(3);
    expect(out.breakdown[0]!.fallbackTokens).toBe(200);
    expect(out.breakdown[0]!.fallbackCost).toBeCloseTo(0.1, 6);
    expect(out.breakdown[0]!.fallbackRequests).toBe(1);

    expect(out.breakdown[1]!.model).toBe('gpt-4o-mini');
    expect(out.breakdown[1]!.provider).toBe('OPENAI');
    expect(out.breakdown[1]!.fallbackRequests).toBe(0);
  });

  it('trata _sum null como zero (rows agregados vazios)', async () => {
    mockGroupBy.mockResolvedValueOnce([
      {
        provider: 'ANTHROPIC',
        model: 'claude-haiku-4-5',
        usedFallback: false,
        _sum: { totalTokens: null, costUsd: null },
        _count: { _all: 0 },
      },
    ]);

    const out = await getMonthlyUsage('tenant-null');

    expect(out.totalTokens).toBe(0);
    expect(out.costUsd).toBe(0);
    expect(out.breakdown[0]!.tokens).toBe(0);
    expect(out.breakdown[0]!.cost).toBe(0);
    expect(out.breakdown[0]!.requests).toBe(0);
  });

  it('ordena breakdown por (cost + fallbackCost) desc', async () => {
    mockGroupBy.mockResolvedValueOnce([
      {
        provider: 'OPENAI',
        model: 'small',
        usedFallback: false,
        _sum: { totalTokens: 10, costUsd: 0.05 },
        _count: { _all: 1 },
      },
      {
        provider: 'ANTHROPIC',
        model: 'medium',
        usedFallback: false,
        _sum: { totalTokens: 20, costUsd: 0.2 },
        _count: { _all: 1 },
      },
      {
        provider: 'ANTHROPIC',
        model: 'medium',
        usedFallback: true,
        _sum: { totalTokens: 5, costUsd: 0.3 },
        _count: { _all: 1 },
      },
      {
        provider: 'OPENAI',
        model: 'large',
        usedFallback: false,
        _sum: { totalTokens: 30, costUsd: 0.1 },
        _count: { _all: 1 },
      },
    ]);

    const out = await getMonthlyUsage('tenant-sort');

    // Total custos por modelo:
    //   medium = 0.2 + 0.3 (fallback) = 0.5   ← primeiro
    //   large  = 0.1                          ← segundo
    //   small  = 0.05                         ← terceiro
    expect(out.breakdown.map((b) => b.model)).toEqual(['medium', 'large', 'small']);
  });

  it('mesmo (provider, model) com só uma direção não polui fallback stats', async () => {
    mockGroupBy.mockResolvedValueOnce([
      {
        provider: 'ANTHROPIC',
        model: 'claude-haiku-4-5',
        usedFallback: false,
        _sum: { totalTokens: 100, costUsd: 0.05 },
        _count: { _all: 1 },
      },
    ]);

    const out = await getMonthlyUsage('tenant-primary-only');

    expect(out.totalFallbackTokens).toBe(0);
    expect(out.totalFallbackCostUsd).toBe(0);
    expect(out.breakdown[0]!.fallbackTokens).toBe(0);
    expect(out.breakdown[0]!.fallbackCost).toBe(0);
    expect(out.breakdown[0]!.fallbackRequests).toBe(0);
  });
});
