import { describe, it, expect } from 'vitest';
import { classifyStatus, AiProviderError } from '@/lib/ai/adapters/types';
import { providerSupportsEmbedding } from '@/lib/ai/adapters/registry';

describe('classifyStatus — Sprint 15F', () => {
  it('5xx é SERVER retryable', () => {
    expect(classifyStatus(500, '')).toEqual({ kind: 'SERVER', retryable: true });
    expect(classifyStatus(502, '')).toEqual({ kind: 'SERVER', retryable: true });
  });

  it('429 é RATE_LIMIT retryable', () => {
    expect(classifyStatus(429, '')).toEqual({ kind: 'RATE_LIMIT', retryable: true });
  });

  it('401/403 é AUTH não-retryable (circuit não registra)', () => {
    expect(classifyStatus(401, '')).toEqual({ kind: 'AUTH', retryable: false });
    expect(classifyStatus(403, '')).toEqual({ kind: 'AUTH', retryable: false });
  });

  it('402 é INSUFFICIENT_CREDIT retryable', () => {
    expect(classifyStatus(402, '')).toEqual({
      kind: 'INSUFFICIENT_CREDIT',
      retryable: true,
    });
  });

  it('400 com "credit" no body é INSUFFICIENT_CREDIT', () => {
    expect(classifyStatus(400, 'Your credit balance is too low')).toEqual({
      kind: 'INSUFFICIENT_CREDIT',
      retryable: true,
    });
  });

  it('400 com "model not found" é MODEL_NOT_FOUND não-retryable', () => {
    expect(classifyStatus(400, 'The requested model was not found')).toEqual({
      kind: 'MODEL_NOT_FOUND',
      retryable: false,
    });
  });

  it('400 com "context length" é CONTEXT_LENGTH não-retryable', () => {
    expect(classifyStatus(400, 'context length exceeded')).toEqual({
      kind: 'CONTEXT_LENGTH',
      retryable: false,
    });
  });

  it('null status (timeout) é TIMEOUT retryable', () => {
    expect(classifyStatus(null, '')).toEqual({ kind: 'TIMEOUT', retryable: true });
  });
});

describe('AiProviderError shape', () => {
  it('carrega provider, status, retryable, kind', () => {
    const err = new AiProviderError({
      provider: 'ANTHROPIC',
      status: 429,
      retryable: true,
      kind: 'RATE_LIMIT',
      message: 'boom',
    });
    expect(err.name).toBe('AiProviderError');
    expect(err.provider).toBe('ANTHROPIC');
    expect(err.status).toBe(429);
    expect(err.retryable).toBe(true);
    expect(err.kind).toBe('RATE_LIMIT');
    expect(err.message).toBe('boom');
  });
});

describe('providerSupportsEmbedding — Sprint 15F', () => {
  it('Anthropic não suporta', () => {
    expect(providerSupportsEmbedding('ANTHROPIC')).toBe(false);
  });
  it('OpenAI suporta', () => {
    expect(providerSupportsEmbedding('OPENAI')).toBe(true);
  });
  it('Google suporta', () => {
    expect(providerSupportsEmbedding('GOOGLE')).toBe(true);
  });
  it('Perplexity não suporta', () => {
    expect(providerSupportsEmbedding('PERPLEXITY')).toBe(false);
  });
});
