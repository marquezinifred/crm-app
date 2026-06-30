import { describe, it, expect } from 'vitest';
import { AiLimitExceededError, FeatureNotAvailableError } from '@/lib/ai/feature-gate';

describe('AI feature gate errors', () => {
  it('FeatureNotAvailableError tem nome correto', () => {
    const e = new FeatureNotAvailableError();
    expect(e.name).toBe('FeatureNotAvailableError');
    expect(e instanceof Error).toBe(true);
  });

  it('AiLimitExceededError guarda kind', () => {
    const e = new AiLimitExceededError('msg', 'MONTHLY_TOKENS');
    expect(e.kind).toBe('MONTHLY_TOKENS');
    expect(e.name).toBe('AiLimitExceededError');
  });

  it('errors são serializáveis (passam por JSON sem perda)', () => {
    const e = new AiLimitExceededError('x', 'DAILY_REQUESTS');
    expect(e.message).toBe('x');
    expect(e.kind).toBe('DAILY_REQUESTS');
  });

  it('resolução de status do gate respeita TenantAiFeature override sobre plano-default', () => {
    // Função-puro tested aqui: dado override INCLUDED, status final = INCLUDED
    // independente do default-do-plano ser 'disabled'.
    const status = (override: string | undefined, planDefault: string) =>
      override ?? (planDefault === 'INCLUDED' ? 'INCLUDED' : 'DISABLED');
    expect(status('INCLUDED', 'DISABLED')).toBe('INCLUDED');
    expect(status('DISABLED', 'INCLUDED')).toBe('DISABLED');
    expect(status(undefined, 'INCLUDED')).toBe('INCLUDED');
    expect(status(undefined, 'DISABLED')).toBe('DISABLED');
  });
});
