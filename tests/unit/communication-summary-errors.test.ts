// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { TRPCError } from '@trpc/server';
import { AiLimitExceededError, FeatureNotAvailableError } from '@/lib/ai/feature-gate';

// P-60 — Sprint 15F trocou `callAiFeature` (path legado) por `dispatchChat`
// (roteador MULTI_AI_ENABLED). O mock precisa interceptar o `dispatchChat`,
// que é a única superfície que `summarizeCommunication` chama hoje.
// Mockar `callAiFeature` só cobria o path legado; com `MULTI_AI_ENABLED=true`
// o teste era silenciosamente bypassado e caía no Prisma real.
vi.mock('@/lib/ai/dispatch', () => ({
  dispatchChat: vi.fn(),
}));

vi.mock('@/lib/ai/claude', () => ({
  getAnthropic: () => ({ messages: { create: vi.fn() } }),
  getAnthropicForTenant: async () => ({ messages: { create: vi.fn() } }),
  MODELS: { HAIKU: 'claude-haiku-4-5', SONNET: 'claude-sonnet-4-6' },
}));

vi.mock('@/server/services/ai-usage.service', () => ({
  logAiUsage: vi.fn().mockResolvedValue(undefined),
  calculateCost: vi.fn().mockReturnValue(0),
  getMonthlyUsage: vi.fn(),
  AI_PRICING: {},
}));

import { dispatchChat } from '@/lib/ai/dispatch';
import { summarizeCommunication, __test } from '@/server/services/communication-summary.service';

describe('summarizeCommunication — propagação de erros', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __test.breaker.recordSuccess();
  });

  it('propaga FeatureNotAvailableError em vez de retornar aiGenerated:false', async () => {
    vi.mocked(dispatchChat).mockImplementation(async () => {
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
    vi.mocked(dispatchChat).mockImplementation(async () => {
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
    vi.mocked(dispatchChat).mockImplementation(async () => {
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

  it('400 credit balance vira PRECONDITION_FAILED com msg de créditos', async () => {
    vi.mocked(dispatchChat).mockImplementation(async () => {
      throw new Anthropic.APIError(
        400,
        { error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } },
        'Your credit balance is too low to access the Anthropic API.',
        undefined,
      );
    });

    await expect(
      summarizeCommunication({
        text: 'texto suficientemente grande para passar a validação',
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof TRPCError &&
        err.code === 'PRECONDITION_FAILED' &&
        /créditos/i.test(err.message) &&
        /console\.anthropic\.com/.test(err.message)
      );
    });
  });

  it('401 vira UNAUTHORIZED com msg apontando /admin/ai', async () => {
    vi.mocked(dispatchChat).mockImplementation(async () => {
      throw new Anthropic.APIError(
        401,
        { error: { type: 'authentication_error', message: 'invalid x-api-key' } },
        'invalid x-api-key',
        undefined,
      );
    });

    await expect(
      summarizeCommunication({
        text: 'texto suficientemente grande para passar a validação',
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof TRPCError &&
        err.code === 'UNAUTHORIZED' &&
        /admin\/ai/.test(err.message)
      );
    });
  });

  it('429 sem retry-after vira TOO_MANY_REQUESTS com msg genérica', async () => {
    vi.mocked(dispatchChat).mockImplementation(async () => {
      throw new Anthropic.APIError(
        429,
        { error: { type: 'rate_limit_error', message: 'rate limit' } },
        'rate limit',
        {},
      );
    });

    await expect(
      summarizeCommunication({
        text: 'texto suficientemente grande para passar a validação',
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof TRPCError &&
        err.code === 'TOO_MANY_REQUESTS' &&
        /alguns segundos/i.test(err.message)
      );
    });
  });

  it('429 com retry-after: 30 formata a mensagem com o tempo', async () => {
    vi.mocked(dispatchChat).mockImplementation(async () => {
      throw new Anthropic.APIError(
        429,
        { error: { type: 'rate_limit_error', message: 'rate limit' } },
        'rate limit',
        { 'retry-after': '30' },
      );
    });

    await expect(
      summarizeCommunication({
        text: 'texto suficientemente grande para passar a validação',
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof TRPCError &&
        err.code === 'TOO_MANY_REQUESTS' &&
        /30s/.test(err.message)
      );
    });
  });

  it('5xx mantém fallback silencioso (aiGenerated:false + circuit breaker)', async () => {
    vi.mocked(dispatchChat).mockImplementation(async () => {
      throw new Anthropic.APIError(
        500,
        { error: { type: 'api_error', message: 'internal' } },
        'internal',
        undefined,
      );
    });

    const result = await summarizeCommunication({
      text: 'texto suficientemente grande para passar a validação',
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    expect(result.aiGenerated).toBe(false);
    expect(result.themes).toEqual([]);
  });
});
