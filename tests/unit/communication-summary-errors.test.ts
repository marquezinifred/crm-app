import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiLimitExceededError, FeatureNotAvailableError } from '@/lib/ai/feature-gate';

vi.mock('@/lib/ai/feature-gate', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/feature-gate')>(
    '@/lib/ai/feature-gate',
  );
  return {
    ...actual,
    callAiFeature: vi.fn(),
  };
});

vi.mock('@/lib/ai/claude', () => ({
  getAnthropic: () => ({ messages: { create: vi.fn() } }),
  MODELS: { HAIKU: 'claude-haiku-4-5', SONNET: 'claude-sonnet-4-6' },
}));

vi.mock('@/server/services/ai-usage.service', () => ({
  logAiUsage: vi.fn().mockResolvedValue(undefined),
  calculateCost: vi.fn().mockReturnValue(0),
  getMonthlyUsage: vi.fn(),
  AI_PRICING: {},
}));

import { callAiFeature } from '@/lib/ai/feature-gate';
import { summarizeCommunication, __test } from '@/server/services/communication-summary.service';

describe('summarizeCommunication — propagação de erros', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __test.breaker.recordSuccess();
  });

  it('propaga FeatureNotAvailableError em vez de retornar aiGenerated:false', async () => {
    vi.mocked(callAiFeature).mockImplementation(async () => {
      throw new FeatureNotAvailableError(
        'Resumo de comunicação está disponível como add-on. Habilite em /admin/billing.',
      );
    });

    await expect(
      summarizeCommunication({
        text: 'texto suficientemente grande para passar a validação',
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(FeatureNotAvailableError);
  });

  it('propaga AiLimitExceededError com kind correto', async () => {
    vi.mocked(callAiFeature).mockImplementation(async () => {
      throw new AiLimitExceededError(
        'Limite mensal de tokens atingido.',
        'MONTHLY_TOKENS',
      );
    });

    await expect(
      summarizeCommunication({
        text: 'texto suficientemente grande para passar a validação',
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    ).rejects.toMatchObject({
      name: 'AiLimitExceededError',
      kind: 'MONTHLY_TOKENS',
    });
  });

  it('falha de provider real (500/timeout) cai em aiGenerated:false sem lançar', async () => {
    vi.mocked(callAiFeature).mockImplementation(async () => {
      throw new Error('Anthropic 500 Internal Server Error');
    });

    const result = await summarizeCommunication({
      text: 'texto suficientemente grande para passar a validação',
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    expect(result.aiGenerated).toBe(false);
    expect(result.themes).toEqual([]);
    expect(result.nextSteps).toEqual([]);
  });
});
