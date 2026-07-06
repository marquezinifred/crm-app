// @vitest-environment node
// P-37 — cobre `dispatch.ts` (dispatchChat + dispatchEmbed) exercitando
// os dois branches da flag MULTI_AI_ENABLED sem bater na Anthropic real.
// Mocks: env (flag), callAiWithFallback (path novo), callAiFeature +
// getAnthropicForTenant (path legado), addBreadcrumb (Sentry no-op).
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Flag mutável — o Proxy garante que a leitura de env.MULTI_AI_ENABLED
// dentro de dispatch() sempre reflita o valor corrente do stub.
const envStub: {
  MULTI_AI_ENABLED: boolean;
  USD_BRL_RATE: number;
  AI_PLATFORM_MARGIN: number;
} = {
  MULTI_AI_ENABLED: false,
  USD_BRL_RATE: 5.1,
  AI_PLATFORM_MARGIN: 0.2,
};

vi.mock('@/lib/env', () => ({
  env: new Proxy({} as Record<string, unknown>, {
    get: (_t, prop) => {
      if (prop in envStub) return (envStub as Record<string, unknown>)[prop as string];
      return undefined;
    },
  }),
}));

const mockCallAiWithFallback = vi.fn();
vi.mock('@/lib/ai/call', () => ({
  callAiWithFallback: (
    ...args: Parameters<typeof mockCallAiWithFallback>
  ) => mockCallAiWithFallback(...args),
}));

const mockCallAiFeature = vi.fn();
vi.mock('@/lib/ai/feature-gate', () => ({
  callAiFeature: (...args: Parameters<typeof mockCallAiFeature>) =>
    mockCallAiFeature(...args),
}));

const mockClientCreate = vi.fn();
vi.mock('@/lib/ai/claude', () => ({
  getAnthropicForTenant: vi.fn(async () => ({
    messages: { create: mockClientCreate },
  })),
  MODELS: { HAIKU: 'claude-haiku-4-5', SONNET: 'claude-sonnet-4-6' },
}));

const mockAddBreadcrumb = vi.fn();
vi.mock('@/lib/monitoring/sentry', () => ({
  addBreadcrumb: (...args: unknown[]) => mockAddBreadcrumb(...args),
}));

import { dispatchChat, dispatchEmbed } from '@/lib/ai/dispatch';

describe('dispatchChat — path novo (MULTI_AI_ENABLED=true)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envStub.MULTI_AI_ENABLED = true;
  });

  it('delega pra callAiWithFallback e propaga usedFallback=false', async () => {
    mockCallAiWithFallback.mockImplementation(async (_code, _tenant, fn) => {
      const client = {
        provider: 'ANTHROPIC' as const,
        supportsEmbedding: false,
        chat: vi.fn(async () => ({
          text: 'resposta primary',
          usage: { inputTokens: 10, outputTokens: 20 },
          raw: {},
        })),
      };
      const result = await fn(client, 'claude-haiku-4-5');
      return {
        result,
        usedProvider: 'ANTHROPIC' as const,
        usedFallback: false,
        configuredProvider: 'ANTHROPIC' as const,
      };
    });

    const out = await dispatchChat({
      featureCode: 'communication-summary',
      tenantId: 'tenant-1',
      chat: {
        messages: [{ role: 'user', content: 'oi' }],
        maxTokens: 100,
        model: 'claude-haiku-4-5',
      },
    });

    expect(out).toEqual({
      text: 'resposta primary',
      inputTokens: 10,
      outputTokens: 20,
      usedProvider: 'ANTHROPIC',
      configuredProvider: 'ANTHROPIC',
      usedFallback: false,
      model: 'claude-haiku-4-5',
    });
    expect(mockCallAiWithFallback).toHaveBeenCalledTimes(1);
    expect(mockCallAiFeature).not.toHaveBeenCalled();
  });

  it('propaga usedFallback=true e configuredProvider correto quando primary falha e fallback sucede', async () => {
    mockCallAiWithFallback.mockResolvedValueOnce({
      result: {
        text: 'resposta fallback',
        usage: { inputTokens: 15, outputTokens: 30 },
        raw: {},
      },
      usedProvider: 'OPENAI' as const,
      usedFallback: true,
      configuredProvider: 'ANTHROPIC' as const,
    });

    const out = await dispatchChat({
      featureCode: 'document-compare',
      tenantId: 'tenant-2',
      chat: {
        messages: [{ role: 'user', content: 'compare' }],
        maxTokens: 200,
      },
    });

    expect(out.usedFallback).toBe(true);
    expect(out.usedProvider).toBe('OPENAI');
    expect(out.configuredProvider).toBe('ANTHROPIC');
    expect(out.text).toBe('resposta fallback');
    expect(out.model).toBe('');
  });

  it('passa (client, model) corretamente pro callback interno', async () => {
    let capturedClient: unknown = null;
    let capturedModel = '';
    mockCallAiWithFallback.mockImplementation(async (_code, _tenant, fn) => {
      const client = {
        provider: 'ANTHROPIC' as const,
        supportsEmbedding: false,
        chat: vi.fn(async (params: { model: string }) => {
          capturedClient = client;
          capturedModel = params.model;
          return {
            text: 't',
            usage: { inputTokens: 1, outputTokens: 1 },
            raw: {},
          };
        }),
      };
      await fn(client, 'model-x');
      return {
        result: {
          text: 't',
          usage: { inputTokens: 1, outputTokens: 1 },
          raw: {},
        },
        usedProvider: 'ANTHROPIC' as const,
        usedFallback: false,
        configuredProvider: 'ANTHROPIC' as const,
      };
    });

    await dispatchChat({
      featureCode: 'feature-x',
      tenantId: 'tenant-3',
      chat: {
        messages: [{ role: 'user', content: 'oi' }],
        maxTokens: 50,
      },
    });

    expect(capturedClient).not.toBeNull();
    expect(capturedModel).toBe('model-x');
  });

  it('registra breadcrumb Sentry com featureCode e multiEnabled=true', async () => {
    mockCallAiWithFallback.mockResolvedValueOnce({
      result: {
        text: '',
        usage: { inputTokens: 0, outputTokens: 0 },
        raw: {},
      },
      usedProvider: 'ANTHROPIC' as const,
      usedFallback: false,
      configuredProvider: 'ANTHROPIC' as const,
    });

    await dispatchChat({
      featureCode: 'foo',
      tenantId: 'tenant-brc',
      chat: {
        messages: [{ role: 'user', content: '.' }],
        maxTokens: 1,
        model: 'm',
      },
    });

    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'ai.dispatch',
        message: 'foo',
        level: 'info',
        data: expect.objectContaining({
          tenantId: 'tenant-brc',
          multiEnabled: true,
          model: 'm',
        }),
      }),
    );
  });

  it('propaga erro do callAiWithFallback (sem tentar path legado)', async () => {
    mockCallAiWithFallback.mockRejectedValueOnce(new Error('provider down'));

    await expect(
      dispatchChat({
        featureCode: 'x',
        tenantId: 't',
        chat: {
          messages: [{ role: 'user', content: '.' }],
          maxTokens: 1,
        },
      }),
    ).rejects.toThrow('provider down');
    expect(mockCallAiFeature).not.toHaveBeenCalled();
  });
});

describe('dispatchChat — path legado (MULTI_AI_ENABLED=false)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envStub.MULTI_AI_ENABLED = false;
  });

  it('delega pra callAiFeature + getAnthropicForTenant e retorna shape Anthropic-only', async () => {
    mockCallAiFeature.mockImplementation(async (_code, _ctx, fn) => {
      return fn({ model: 'claude-haiku-4-5', provider: 'ANTHROPIC' });
    });
    mockClientCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'resposta legado' }],
      usage: { input_tokens: 5, output_tokens: 8 },
    });

    const out = await dispatchChat({
      featureCode: 'communication-summary',
      tenantId: 'tenant-legado',
      chat: {
        messages: [{ role: 'user', content: 'oi' }],
        maxTokens: 100,
      },
    });

    expect(out).toEqual({
      text: 'resposta legado',
      inputTokens: 5,
      outputTokens: 8,
      usedProvider: 'ANTHROPIC',
      configuredProvider: 'ANTHROPIC',
      usedFallback: false,
      model: 'claude-haiku-4-5',
    });
    expect(mockCallAiWithFallback).not.toHaveBeenCalled();
    expect(mockCallAiFeature).toHaveBeenCalledTimes(1);
  });

  it('filtra mensagens role="system" antes de enviar pro Anthropic SDK', async () => {
    let capturedMessages: unknown = null;
    mockCallAiFeature.mockImplementation(async (_code, _ctx, fn) =>
      fn({ model: 'claude-haiku-4-5', provider: 'ANTHROPIC' }),
    );
    mockClientCreate.mockImplementation(async (args: { messages: unknown }) => {
      capturedMessages = args.messages;
      return {
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    });

    await dispatchChat({
      featureCode: 'x',
      tenantId: 't',
      chat: {
        messages: [
          { role: 'system', content: 'sys — deve sair' },
          { role: 'user', content: 'user' },
          { role: 'assistant', content: 'assist' },
        ],
        systemPrompt: 'meu system',
        maxTokens: 10,
      },
    });

    expect(capturedMessages).toEqual([
      { role: 'user', content: 'user' },
      { role: 'assistant', content: 'assist' },
    ]);
  });

  it('concatena múltiplos blocos "text" e ignora não-text no completion', async () => {
    mockCallAiFeature.mockImplementation(async (_code, _ctx, fn) =>
      fn({ model: 'm', provider: 'ANTHROPIC' }),
    );
    mockClientCreate.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'A' },
        { type: 'tool_use', id: 't1' },
        { type: 'text', text: 'B' },
      ],
      usage: { input_tokens: 2, output_tokens: 3 },
    });

    const out = await dispatchChat({
      featureCode: 'x',
      tenantId: 't',
      chat: {
        messages: [{ role: 'user', content: '.' }],
        maxTokens: 1,
      },
    });

    expect(out.text).toBe('AB');
    expect(out.inputTokens).toBe(2);
    expect(out.outputTokens).toBe(3);
  });

  it('breadcrumb registra multiEnabled=false no path legado', async () => {
    mockCallAiFeature.mockImplementation(async (_code, _ctx, fn) =>
      fn({ model: 'claude-haiku-4-5', provider: 'ANTHROPIC' }),
    );
    mockClientCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await dispatchChat({
      featureCode: 'brc-legado',
      tenantId: 'tenant-brc',
      chat: {
        messages: [{ role: 'user', content: '.' }],
        maxTokens: 1,
      },
    });

    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'brc-legado',
        data: expect.objectContaining({ multiEnabled: false }),
      }),
    );
  });

  it('input.chat.model override tem precedência sobre model resolvido pelo gate', async () => {
    mockCallAiFeature.mockImplementation(async (_code, _ctx, fn) =>
      fn({ model: 'default-do-gate', provider: 'ANTHROPIC' }),
    );
    let capturedModel = '';
    mockClientCreate.mockImplementation(async (args: { model: string }) => {
      capturedModel = args.model;
      return {
        content: [{ type: 'text', text: '' }],
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    });

    const out = await dispatchChat({
      featureCode: 'x',
      tenantId: 't',
      chat: {
        messages: [{ role: 'user', content: '.' }],
        maxTokens: 1,
        model: 'forcado-pelo-caller',
      },
    });

    expect(capturedModel).toBe('forcado-pelo-caller');
    expect(out.model).toBe('forcado-pelo-caller');
  });

  it('quando caller não passa model, usa o resolvido pelo gate', async () => {
    mockCallAiFeature.mockImplementation(async (_code, _ctx, fn) =>
      fn({ model: 'claude-haiku-4-5-20251001', provider: 'ANTHROPIC' }),
    );
    mockClientCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '' }],
      usage: { input_tokens: 0, output_tokens: 0 },
    });

    const out = await dispatchChat({
      featureCode: 'x',
      tenantId: 't',
      chat: {
        messages: [{ role: 'user', content: '.' }],
        maxTokens: 1,
      },
    });

    expect(out.model).toBe('claude-haiku-4-5-20251001');
  });
});

describe('dispatchEmbed — path novo (MULTI_AI_ENABLED=true)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envStub.MULTI_AI_ENABLED = true;
  });

  it('delega pra callAiWithFallback e propaga vetores', async () => {
    mockCallAiWithFallback.mockImplementation(async (_code, _tenant, fn) => {
      const client = {
        provider: 'OPENAI' as const,
        supportsEmbedding: true,
        chat: vi.fn(),
        embed: vi.fn(async () => ({
          vectors: [[0.1, 0.2, 0.3]],
          usage: { inputTokens: 7 },
        })),
      };
      const result = await fn(client, 'text-embedding-3-small');
      return {
        result,
        usedProvider: 'OPENAI' as const,
        usedFallback: false,
        configuredProvider: 'OPENAI' as const,
      };
    });

    const out = await dispatchEmbed({
      featureCode: 'semantic-search',
      tenantId: 'tenant-1',
      embed: { model: 'text-embedding-3-small', input: ['oi'] },
    });

    expect(out).toEqual({
      vectors: [[0.1, 0.2, 0.3]],
      inputTokens: 7,
      usedProvider: 'OPENAI',
      configuredProvider: 'OPENAI',
      usedFallback: false,
      model: 'text-embedding-3-small',
    });
  });

  it('lança erro quando adapter não implementa embed', async () => {
    mockCallAiWithFallback.mockImplementation(async (_code, _tenant, fn) => {
      const client = {
        provider: 'ANTHROPIC' as const,
        supportsEmbedding: false,
        chat: vi.fn(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await fn(client as any, 'model');
      return null as never;
    });

    await expect(
      dispatchEmbed({
        featureCode: 'semantic-search',
        tenantId: 't',
        embed: { model: 'm', input: ['x'] },
      }),
    ).rejects.toThrow(/não suporta embed/i);
  });
});

describe('dispatchEmbed — path legado (MULTI_AI_ENABLED=false)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envStub.MULTI_AI_ENABLED = false;
  });

  it('retorna shape vazio pra sinalizar fallback tsvector no caller', async () => {
    const out = await dispatchEmbed({
      featureCode: 'semantic-search',
      tenantId: 't',
      embed: { model: 'text-embedding-3-small', input: ['oi'] },
    });

    expect(out).toEqual({
      vectors: [],
      inputTokens: 0,
      usedProvider: 'OPENAI',
      configuredProvider: 'OPENAI',
      usedFallback: false,
      model: 'text-embedding-3-small',
    });
    expect(mockCallAiWithFallback).not.toHaveBeenCalled();
  });
});
