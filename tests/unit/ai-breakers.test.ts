import { describe, it, expect, beforeEach } from 'vitest';
import {
  getBreaker,
  clearBreakers,
  snapshotBreakers,
  __resetBreakersForTests,
} from '@/lib/ai/breakers';

describe('Circuit breaker por (provider, tenant) — Sprint 15F', () => {
  beforeEach(() => __resetBreakersForTests());

  it('breakers de tenants diferentes são independentes', () => {
    const a = getBreaker('ANTHROPIC', 'tenant-A');
    const b = getBreaker('ANTHROPIC', 'tenant-B');
    // 3 falhas fecham o de A
    a.recordFailure();
    a.recordFailure();
    a.recordFailure();
    expect(a.isOpen()).toBe(true);
    // B continua fechado (aka disponível)
    expect(b.isOpen()).toBe(false);
  });

  it('breakers de providers diferentes no mesmo tenant são independentes', () => {
    const anthropic = getBreaker('ANTHROPIC', 'tenant-A');
    const openai = getBreaker('OPENAI', 'tenant-A');
    anthropic.recordFailure();
    anthropic.recordFailure();
    anthropic.recordFailure();
    expect(anthropic.isOpen()).toBe(true);
    expect(openai.isOpen()).toBe(false);
  });

  it('reuso retorna a mesma instância', () => {
    const a1 = getBreaker('ANTHROPIC', 'tenant-A');
    const a2 = getBreaker('ANTHROPIC', 'tenant-A');
    expect(a1).toBe(a2);
  });

  it('clearBreakers filtra por tenant', () => {
    getBreaker('ANTHROPIC', 'tenant-A');
    getBreaker('OPENAI', 'tenant-A');
    getBreaker('ANTHROPIC', 'tenant-B');
    const cleared = clearBreakers({ tenantId: 'tenant-A' });
    expect(cleared).toBe(2);
    const snap = snapshotBreakers();
    expect(snap.filter((b) => b.tenantId === 'tenant-A')).toHaveLength(0);
    expect(snap.filter((b) => b.tenantId === 'tenant-B')).toHaveLength(1);
  });

  it('clearBreakers filtra por provider', () => {
    getBreaker('ANTHROPIC', 'tenant-A');
    getBreaker('OPENAI', 'tenant-A');
    const cleared = clearBreakers({ provider: 'ANTHROPIC' });
    expect(cleared).toBe(1);
  });

  it('snapshot devolve estado open corretamente', () => {
    const b = getBreaker('OPENAI', 'tenant-X');
    b.recordFailure();
    b.recordFailure();
    b.recordFailure();
    const snap = snapshotBreakers();
    const entry = snap.find(
      (s) => s.provider === 'OPENAI' && s.tenantId === 'tenant-X',
    );
    expect(entry?.open).toBe(true);
  });
});
