import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ioredis', () => {
  class FakeRedis {
    private store = new Map<string, number>();
    private connected = false;
    on() {}
    async connect() {
      this.connected = true;
    }
    async incr(key: string) {
      const v = (this.store.get(key) ?? 0) + 1;
      this.store.set(key, v);
      return v;
    }
    async expire() {
      return 1;
    }
  }
  return { Redis: FakeRedis, default: FakeRedis };
});

import { checkRate, loginKey, publicFormKey, tenantApiKey } from '@/server/services/rate-limiter.service';

describe('rate limiter sliding window', () => {
  beforeEach(() => undefined);

  it('permite até o limite e bloqueia o excedente', async () => {
    const key = `t1-${Math.floor(Math.random() * 1e9)}`;
    for (let i = 0; i < 3; i++) {
      const r = await checkRate(key, 3, 60);
      expect(r.allowed).toBe(true);
    }
    const over = await checkRate(key, 3, 60);
    expect(over.allowed).toBe(false);
    expect(over.remaining).toBe(0);
  });

  it('janelas separadas têm contadores independentes', async () => {
    const r1 = await checkRate(`win-${Date.now()}-${Math.random()}`, 1, 60);
    const r2 = await checkRate(`win-${Date.now()}-${Math.random() + 0.1}`, 1, 60);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
  });

  it('builders de chave são distintos', () => {
    expect(loginKey('1.2.3.4')).toBe('login:1.2.3.4');
    expect(publicFormKey('1.2.3.4', 'privacy')).toBe('pubform:privacy:1.2.3.4');
    expect(tenantApiKey('abc')).toBe('tenantapi:abc');
  });

  it('resetAt fica no futuro', async () => {
    const r = await checkRate('reset-test', 5, 60);
    expect(r.resetAt.getTime()).toBeGreaterThan(Date.now() - 1000);
  });
});
