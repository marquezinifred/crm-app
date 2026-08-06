import { describe, it, expect, vi, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  isTransientConnectionError,
  withConnectionRetry,
  DatabaseUnavailableError,
  DB_UNAVAILABLE_PUBLIC_MESSAGE,
} from '@/server/db/connection-retry';
import { ForbiddenError } from '@/lib/auth/rbac';

/**
 * P-110 — Retry/backoff transparente para o cold-start do Neon serverless
 * + sanitização do erro quando o retry se esgota (nunca vaza host).
 *
 * Prova crítica (Modo A / choke point): SÓ P1001/P1002 (conexão não
 * estabelecida → nada executou) são re-tentados; qualquer outro erro
 * (constraint, ForbiddenError do guard, tenant-isolation) propaga imediato.
 */

const HOST = 'ep-rapid-fog-ajm1hdvb-pooler.sa-east-1.aws.neon.tech:5432';

function p1001(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    `Can't reach database server at \`${HOST}\``,
    { code: 'P1001', clientVersion: '5.22.0' },
  );
}
function p1002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    `Timed out reaching database server at \`${HOST}\``,
    { code: 'P1002', clientVersion: '5.22.0' },
  );
}
function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`email`)',
    { code: 'P2002', clientVersion: '5.22.0' },
  );
}

afterEach(() => {
  vi.useRealTimers();
});

// ======================================================================
// 1. isTransientConnectionError — classificação (a regra de segurança)
// ======================================================================
describe('isTransientConnectionError', () => {
  it('P1001 (known request error) → true', () => {
    expect(isTransientConnectionError(p1001())).toBe(true);
  });

  it('P1002 (known request error) → true', () => {
    expect(isTransientConnectionError(p1002())).toBe(true);
  });

  it('P1001 via PrismaClientInitializationError.errorCode → true', () => {
    const e = new Prisma.PrismaClientInitializationError(
      `Can't reach database server at \`${HOST}\``,
      '5.22.0',
      'P1001',
    );
    expect(isTransientConnectionError(e)).toBe(true);
  });

  it('P2002 (constraint) → false (NUNCA re-tentar query que pode ter executado)', () => {
    expect(isTransientConnectionError(p2002())).toBe(false);
  });

  it('erro genérico → false', () => {
    expect(isTransientConnectionError(new Error('boom'))).toBe(false);
  });

  it('ForbiddenError (guard de transferência 15G.5) → false', () => {
    expect(isTransientConnectionError(new ForbiddenError('nope'))).toBe(false);
  });

  it('Error "[tenant-isolation] ..." (backstop P-42/P-46) → false', () => {
    expect(
      isTransientConnectionError(
        new Error('[tenant-isolation] Opportunity.update tenantId no payload difere do contexto'),
      ),
    ).toBe(false);
  });

  it('Error "[transfer-guard] ..." → false', () => {
    expect(
      isTransientConnectionError(new Error('[transfer-guard] Task bloqueado em opp x')),
    ).toBe(false);
  });

  it('objeto com name TRPCError → false (não re-tenta erro já mapeado)', () => {
    expect(isTransientConnectionError({ name: 'TRPCError', message: 'x', code: 'P1001' })).toBe(
      false,
    );
  });

  it('null / undefined / string / number → false', () => {
    expect(isTransientConnectionError(null)).toBe(false);
    expect(isTransientConnectionError(undefined)).toBe(false);
    expect(isTransientConnectionError('P1001')).toBe(false);
    expect(isTransientConnectionError(42)).toBe(false);
  });

  it('objeto plano com code P1001 → true (fallback estrutural por code)', () => {
    expect(isTransientConnectionError({ code: 'P1001', message: 'x' })).toBe(true);
  });

  it('fallback por mensagem: instância Prisma sem code mas "Can\'t reach database server" → true', () => {
    const e = new Prisma.PrismaClientKnownRequestError(
      `Can't reach database server at \`${HOST}\``,
      { code: '', clientVersion: '5.22.0' },
    );
    expect(isTransientConnectionError(e)).toBe(true);
  });

  it('fallback por mensagem NÃO amplia: instância Prisma P2002 sem "reach" → false', () => {
    expect(isTransientConnectionError(p2002())).toBe(false);
  });

  it('Error genérico com "Can\'t reach database server" (não-Prisma) → false (não amplia além de Prisma)', () => {
    expect(
      isTransientConnectionError(new Error("Can't reach database server at somewhere")),
    ).toBe(false);
  });
});

// ======================================================================
// 2. withConnectionRetry — orçamento, sanitização e ausência de retry
//    em erro não-transiente
// ======================================================================
describe('withConnectionRetry', () => {
  it('sucesso na 1ª tentativa → 1 chamada, zero sleep', async () => {
    const sleeps: number[] = [];
    const fn = vi.fn(async () => 'ok');
    const r = await withConnectionRetry(fn, { sleep: async (ms) => void sleeps.push(ms) });
    expect(r).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('falha P1001 nas 2 primeiras, sucede na 3ª → resolve, 3 tentativas, backoff [300,1000]', async () => {
    const sleeps: number[] = [];
    let n = 0;
    const fn = vi.fn(async () => {
      n += 1;
      if (n < 3) throw p1001();
      return 'ok';
    });
    const r = await withConnectionRetry(fn, { sleep: async (ms) => void sleeps.push(ms) });
    expect(r).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([300, 1000]);
  });

  it('falha P1001 sempre → DatabaseUnavailableError sanitizado (sem host) após esgotar', async () => {
    const sleeps: number[] = [];
    const fn = vi.fn(async () => {
      throw p1001();
    });
    await expect(
      withConnectionRetry(fn, { sleep: async (ms) => void sleeps.push(ms) }),
    ).rejects.toBeInstanceOf(DatabaseUnavailableError);

    // Re-executa pra inspecionar o erro lançado.
    let caught: unknown;
    try {
      await withConnectionRetry(fn, { sleep: async () => {} });
    } catch (e) {
      caught = e;
    }
    const err = caught as DatabaseUnavailableError;
    expect(err.message).toBe(DB_UNAVAILABLE_PUBLIC_MESSAGE);
    expect(err.message).not.toContain(HOST);
    expect(err.message).not.toMatch(/ep-|neon|pooler|reach database/i);
    // 3 tentativas (default) → 2 sleeps por execução.
    expect(sleeps).toEqual([300, 1000]);
    // Erro original de conexão preservado em `cause` (só server-side).
    expect((err as { cause?: unknown }).cause).toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it('falha P2002 (constraint) → propaga IMEDIATO, zero retry, zero sleep', async () => {
    const sleeps: number[] = [];
    const original = p2002();
    const fn = vi.fn(async () => {
      throw original;
    });
    await expect(
      withConnectionRetry(fn, { sleep: async (ms) => void sleeps.push(ms) }),
    ).rejects.toBe(original);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('ForbiddenError do guard → propaga IMEDIATO, zero retry (NUNCA re-tenta bloqueio)', async () => {
    const sleeps: number[] = [];
    const forbidden = new ForbiddenError('Seu perfil não tem acesso a esta operação.');
    const fn = vi.fn(async () => {
      throw forbidden;
    });
    await expect(
      withConnectionRetry(fn, { sleep: async (ms) => void sleeps.push(ms) }),
    ).rejects.toBe(forbidden);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('Error "[tenant-isolation] ..." (backstop) → propaga IMEDIATO, zero retry', async () => {
    const iso = new Error('[tenant-isolation] Opportunity.create sem tenantId no payload');
    const fn = vi.fn(async () => {
      throw iso;
    });
    await expect(withConnectionRetry(fn, { sleep: async () => {} })).rejects.toBe(iso);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('maxAttempts custom → respeita nº de tentativas e sequência de backoff', async () => {
    const sleeps: number[] = [];
    const fn = vi.fn(async () => {
      throw p1002();
    });
    await expect(
      withConnectionRetry(fn, {
        maxAttempts: 4,
        backoffMs: [300, 1000, 2000],
        sleep: async (ms) => void sleeps.push(ms),
      }),
    ).rejects.toBeInstanceOf(DatabaseUnavailableError);
    expect(fn).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([300, 1000, 2000]);
  });

  it('sleep default (setTimeout) é exercido via fake timers', async () => {
    vi.useFakeTimers();
    let n = 0;
    const fn = vi.fn(async () => {
      n += 1;
      if (n < 2) throw p1001();
      return 'ok';
    });
    const promise = withConnectionRetry(fn); // usa DEFAULT_BACKOFF + setTimeout real
    await vi.advanceTimersByTimeAsync(300);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ======================================================================
// 3. Preservação do AsyncLocalStorage através do backoff (memory
//    als-lazy-thunk-fail-closed) — o retro deve re-executar `fn` NO MESMO
//    contexto de tenant/userId, senão o fail-closed P-79 dispararia.
// ======================================================================
describe('withConnectionRetry — preserva AsyncLocalStorage no retry', () => {
  it('fn re-executada após backoff enxerga o mesmo store (contexto não escapa)', async () => {
    const als = new AsyncLocalStorage<{ tenantId: string }>();
    const seen: Array<string | undefined> = [];
    let n = 0;
    const fn = async () => {
      seen.push(als.getStore()?.tenantId);
      n += 1;
      if (n < 2) throw p1001();
      return 'ok';
    };

    const result = await als.run({ tenantId: 'tenant-xyz' }, () =>
      withConnectionRetry(fn, { sleep: async () => {} }),
    );

    expect(result).toBe('ok');
    // As DUAS execuções (falha + sucesso) viram o mesmo tenant do escopo.
    expect(seen).toEqual(['tenant-xyz', 'tenant-xyz']);
  });
});
