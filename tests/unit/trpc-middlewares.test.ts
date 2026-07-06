// @vitest-environment node
// Env precisa estar setado antes de qualquer import que puxe env.ts
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError, z } from 'zod';

/**
 * P-61 — Cobertura direta dos handlers exportados de
 * `src/server/trpc/trpc.ts`:
 *
 *   • formatTrpcError      — errorFormatter puro (P-46)
 *   • assertAuthContext    — enforceAuth handler
 *   • assertPlatformContext — enforcePlatform handler (Sprint 15A)
 *   • runMapErrors         — mapErrors handler (P-46)
 *   • runMonitor           — monitor handler (P-35)
 *
 * Os handlers ficam expostos justamente para poder testá-los sem
 * subir servidor tRPC. A wiring `t.middleware(...)` é finalmente
 * um wrapper de 1 linha que só delega — cobertura semântica bate
 * com cobertura estática porque a lógica mora nos handlers.
 */

// Mocks dos sinks Axiom/Sentry — queremos observar chamadas.
const logTrpcSpy = vi.fn();
const captureExceptionSpy = vi.fn();

vi.mock('@/lib/monitoring/axiom', () => ({
  logTrpc: (evt: unknown) => logTrpcSpy(evt),
}));

vi.mock('@/lib/monitoring/sentry', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/monitoring/sentry')
  >('@/lib/monitoring/sentry');
  return {
    ...actual,
    captureException: (err: unknown, ctx?: unknown) =>
      captureExceptionSpy(err, ctx),
  };
});

describe('trpc.ts — formatTrpcError (errorFormatter puro, P-46)', () => {
  it('detecta tenant-isolation via cause preservado (fluxo normal)', async () => {
    const { formatTrpcError } = await import('@/server/trpc/trpc');
    const cause = new Error(
      '[tenant-isolation] Opportunity.update tenantId no payload difere do contexto',
    );
    const shape = formatTrpcError({
      shape: {
        message: 'Erro de isolamento de dados. Reporte à equipe.',
        code: -32603,
        data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
      },
      error: { message: 'anything', cause },
    });
    expect(shape.data.tenantIsolation).toEqual({
      model: 'Opportunity',
      op: 'update',
      reason: 'tenant_id_mismatch',
    });
    expect(shape.message).toBe(
      'Erro de isolamento de dados. Reporte à equipe.',
    );
    expect(shape.data.zodError).toBeNull();
  });

  it('detecta tenant-isolation via error.message quando cause ausente (bypass mapErrors)', async () => {
    const { formatTrpcError } = await import('@/server/trpc/trpc');
    const shape = formatTrpcError({
      shape: {
        message: '[tenant-isolation] Company.create sem tenantId no payload',
        code: -32603,
        data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
      },
      error: {
        message: '[tenant-isolation] Company.create sem tenantId no payload',
      },
    });
    expect(shape.data.tenantIsolation).toEqual({
      model: 'Company',
      op: 'create',
      reason: 'missing_tenant_id',
    });
    // Sanitiza a mensagem pública quando a Error crua vazou.
    expect(shape.message).toBe(
      'Erro de isolamento de dados. Reporte à equipe.',
    );
  });

  it('achata ZodError em data.zodError quando cause é Zod', async () => {
    const { formatTrpcError } = await import('@/server/trpc/trpc');
    let zodError: ZodError | null = null;
    try {
      z.object({ email: z.string().email() }).parse({ email: 'invalido' });
    } catch (err) {
      zodError = err as ZodError;
    }
    expect(zodError).toBeInstanceOf(ZodError);
    const shape = formatTrpcError({
      shape: {
        message: 'BAD_REQUEST',
        code: -32600,
        data: { code: 'BAD_REQUEST', httpStatus: 400 },
      },
      error: { message: 'BAD_REQUEST', cause: zodError! },
    });
    expect(shape.data.tenantIsolation).toBeNull();
    expect(shape.data.zodError).toEqual(zodError!.flatten());
    // Zod não vira tenant-isolation, mensagem intacta.
    expect(shape.message).toBe('BAD_REQUEST');
  });

  it('erro comum (não Zod, não tenant-isolation) preserva shape original', async () => {
    const { formatTrpcError } = await import('@/server/trpc/trpc');
    const shape = formatTrpcError({
      shape: {
        message: 'FORBIDDEN',
        code: -32003,
        data: { code: 'FORBIDDEN', httpStatus: 403 },
      },
      error: { message: 'FORBIDDEN' },
    });
    expect(shape.data.tenantIsolation).toBeNull();
    expect(shape.data.zodError).toBeNull();
    expect(shape.message).toBe('FORBIDDEN');
  });
});

describe('trpc.ts — assertAuthContext (enforceAuth handler)', () => {
  it('passa silenciosamente quando user + tenantId presentes', async () => {
    const { assertAuthContext } = await import('@/server/trpc/trpc');
    expect(() =>
      assertAuthContext({
        user: {
          id: 'u1',
          email: 'a@b',
          fullName: 'X',
          role: 'ADMIN',
          tenantId: 't1',
          partnerCompanyId: null,
        },
        tenantId: 't1',
      }),
    ).not.toThrow();
  });

  it('lança UNAUTHORIZED sem user', async () => {
    const { assertAuthContext } = await import('@/server/trpc/trpc');
    try {
      assertAuthContext({ user: null, tenantId: 't1' });
      expect.fail('esperava throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('UNAUTHORIZED');
    }
  });

  it('lança UNAUTHORIZED sem tenantId', async () => {
    const { assertAuthContext } = await import('@/server/trpc/trpc');
    try {
      assertAuthContext({
        user: {
          id: 'u1',
          email: 'a@b',
          fullName: 'X',
          role: 'ADMIN',
          tenantId: null,
          partnerCompanyId: null,
        },
        tenantId: null,
      });
      expect.fail('esperava throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('UNAUTHORIZED');
    }
  });
});

describe('trpc.ts — assertPlatformContext (enforcePlatform handler, Sprint 15A)', () => {
  it('passa silenciosamente quando platformUser + role PLATFORM_OWNER', async () => {
    const { assertPlatformContext } = await import('@/server/trpc/trpc');
    expect(() =>
      assertPlatformContext({
        platformUser: {
          id: 'p1',
          email: 'p@venzo',
          fullName: 'Fred',
          platformRole: 'PLATFORM_OWNER',
        },
        platformRole: 'PLATFORM_OWNER',
      }),
    ).not.toThrow();
  });

  it('lança FORBIDDEN sem platformUser', async () => {
    const { assertPlatformContext } = await import('@/server/trpc/trpc');
    try {
      assertPlatformContext({
        platformUser: null,
        platformRole: null,
      });
      expect.fail('esperava throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('FORBIDDEN');
      expect((err as TRPCError).message).toMatch(/Platform Owners/);
    }
  });

  it('lança FORBIDDEN quando platformRole !== PLATFORM_OWNER (defesa em profundidade)', async () => {
    const { assertPlatformContext } = await import('@/server/trpc/trpc');
    try {
      assertPlatformContext({
        // simula caso patológico: user carregado mas role errada
        platformUser: {
          id: 'p1',
          email: 'p@venzo',
          fullName: 'X',
          platformRole: 'PLATFORM_SUPPORT' as unknown as 'PLATFORM_OWNER',
        },
        platformRole: 'PLATFORM_SUPPORT' as unknown as 'PLATFORM_OWNER',
      });
      expect.fail('esperava throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('FORBIDDEN');
    }
  });
});

describe('trpc.ts — runMapErrors (mapErrors handler, P-46)', () => {
  it('passa retorno através quando next não lança', async () => {
    const { runMapErrors } = await import('@/server/trpc/trpc');
    const out = await runMapErrors(async () => ({ ok: true, data: 42 }));
    expect(out).toEqual({ ok: true, data: 42 });
  });

  it('converte ForbiddenError → TRPCError FORBIDDEN preservando message', async () => {
    const { runMapErrors } = await import('@/server/trpc/trpc');
    const { ForbiddenError } = await import('@/lib/auth/rbac');
    try {
      await runMapErrors(async () => {
        throw new ForbiddenError('sem permissão pra opportunity:update');
      });
      expect.fail('esperava throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('FORBIDDEN');
      expect((err as TRPCError).message).toBe(
        'sem permissão pra opportunity:update',
      );
    }
  });

  it('converte Error("[tenant-isolation] ...") → TRPCError INTERNAL_SERVER_ERROR com cause', async () => {
    const { runMapErrors } = await import('@/server/trpc/trpc');
    const original = new Error(
      '[tenant-isolation] Contact.update sem tenantId no payload',
    );
    try {
      await runMapErrors(async () => {
        throw original;
      });
      expect.fail('esperava throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('INTERNAL_SERVER_ERROR');
      expect((err as TRPCError).message).toMatch(/isolamento de dados/i);
      // cause preservado pro Sentry
      expect((err as TRPCError).cause).toBe(original);
    }
  });

  it('re-throw intacto pra outros errors (compat)', async () => {
    const { runMapErrors } = await import('@/server/trpc/trpc');
    const generic = new Error('algo qualquer');
    try {
      await runMapErrors(async () => {
        throw generic;
      });
      expect.fail('esperava throw');
    } catch (err) {
      // Não wrap, mesmo objeto
      expect(err).toBe(generic);
    }
  });

  it('re-throw intacto pra TRPCError original (não wrappar em cascata)', async () => {
    const { runMapErrors } = await import('@/server/trpc/trpc');
    const trpcErr = new TRPCError({
      code: 'NOT_FOUND',
      message: 'not found',
    });
    try {
      await runMapErrors(async () => {
        throw trpcErr;
      });
      expect.fail('esperava throw');
    } catch (err) {
      expect(err).toBe(trpcErr);
      expect((err as TRPCError).code).toBe('NOT_FOUND');
    }
  });
});

describe('trpc.ts — runMonitor (P-35 handler)', () => {
  beforeEach(() => {
    logTrpcSpy.mockReset();
    captureExceptionSpy.mockReset();
    // AXIOM_LOG_QUERIES: false pelos defaults; ver env-boolean-parsing test
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const buildCtx = () =>
    ({
      tenantId: 't1',
      user: {
        id: 'u1',
        email: 'a@b',
        fullName: 'X',
        role: 'ADMIN' as const,
        tenantId: 't1',
        partnerCompanyId: null,
      },
    }) satisfies { tenantId: string; user: { id: string } & Record<string, unknown> };

  it('success mutation: retorna resultado + loga Axiom ok=true, não chama Sentry', async () => {
    const { runMonitor } = await import('@/server/trpc/trpc');
    const out = await runMonitor(
      { ctx: buildCtx(), path: 'opportunities.create', type: 'mutation' },
      async () => ({ id: 'op-1' }),
    );
    expect(out).toEqual({ id: 'op-1' });
    expect(logTrpcSpy).toHaveBeenCalledTimes(1);
    const evt = logTrpcSpy.mock.calls[0]![0];
    expect(evt.procedure).toBe('opportunities.create');
    expect(evt.kind).toBe('mutation');
    expect(evt.ok).toBe(true);
    expect(evt.tenantId).toBe('t1');
    expect(evt.userId).toBe('u1');
    expect(typeof evt.durationMs).toBe('number');
    expect(captureExceptionSpy).not.toHaveBeenCalled();
  });

  it('success query com AXIOM_LOG_QUERIES=false → NÃO loga (evita ruído)', async () => {
    // Env default do repo — recarrega env.ts pra garantir. Como o mock não
    // interfere no env.ts, forçamos NODE_ENV=test com var já default false.
    const { runMonitor } = await import('@/server/trpc/trpc');
    const out = await runMonitor(
      { ctx: buildCtx(), path: 'reports.funnel', type: 'query' },
      async () => ({ rows: [] }),
    );
    expect(out).toEqual({ rows: [] });
    expect(logTrpcSpy).not.toHaveBeenCalled();
  });

  it('error: TRPCError FORBIDDEN → loga Axiom ok=false, NÃO chama Sentry (código não-5xx)', async () => {
    const { runMonitor } = await import('@/server/trpc/trpc');
    const err = new TRPCError({ code: 'FORBIDDEN', message: 'nope' });
    await expect(
      runMonitor(
        { ctx: buildCtx(), path: 'companies.remove', type: 'mutation' },
        async () => {
          throw err;
        },
      ),
    ).rejects.toBe(err);
    expect(logTrpcSpy).toHaveBeenCalledTimes(1);
    const evt = logTrpcSpy.mock.calls[0]![0];
    expect(evt.ok).toBe(false);
    expect(evt.errorCode).toBe('FORBIDDEN');
    expect(evt.errorMessage).toBe('nope');
    // shouldReportTrpcError('FORBIDDEN') === false
    expect(captureExceptionSpy).not.toHaveBeenCalled();
  });

  it('error: Error genérico → código INTERNAL_SERVER_ERROR, dispara Sentry captureException', async () => {
    const { runMonitor } = await import('@/server/trpc/trpc');
    const err = new Error('boom');
    await expect(
      runMonitor(
        { ctx: buildCtx(), path: 'opportunities.list', type: 'query' },
        async () => {
          throw err;
        },
      ),
    ).rejects.toBe(err);
    expect(logTrpcSpy).toHaveBeenCalledTimes(1);
    const evt = logTrpcSpy.mock.calls[0]![0];
    expect(evt.ok).toBe(false);
    expect(evt.errorCode).toBe('INTERNAL_SERVER_ERROR');
    expect(evt.errorMessage).toBe('boom');
    expect(captureExceptionSpy).toHaveBeenCalledTimes(1);
    expect(captureExceptionSpy.mock.calls[0]![0]).toBe(err);
    const tags = captureExceptionSpy.mock.calls[0]![1]?.tags;
    expect(tags.procedure).toBe('opportunities.list');
    expect(tags.kind).toBe('query');
    expect(tags.errorCode).toBe('INTERNAL_SERVER_ERROR');
    expect(tags.tenantId).toBe('t1');
    expect(tags.userId).toBe('u1');
  });

  it('error: non-Error (string throw) → errorMessage vira String(err)', async () => {
    const { runMonitor } = await import('@/server/trpc/trpc');
    await expect(
      runMonitor(
        { ctx: buildCtx(), path: 'x.y', type: 'mutation' },
        async () => {
          throw 'bare-string' as unknown as Error;
        },
      ),
    ).rejects.toBe('bare-string');
    expect(logTrpcSpy).toHaveBeenCalledTimes(1);
    expect(logTrpcSpy.mock.calls[0]![0].errorMessage).toBe('bare-string');
    // Non-TRPCError vira INTERNAL_SERVER_ERROR
    expect(logTrpcSpy.mock.calls[0]![0].errorCode).toBe(
      'INTERNAL_SERVER_ERROR',
    );
  });

  it('ctx com tenantId/user nulos → payload traz null (não crash)', async () => {
    const { runMonitor } = await import('@/server/trpc/trpc');
    await runMonitor(
      {
        ctx: { tenantId: null, user: null },
        path: 'public.hello',
        type: 'mutation',
      },
      async () => 'ok',
    );
    const evt = logTrpcSpy.mock.calls[0]![0];
    expect(evt.tenantId).toBeNull();
    expect(evt.userId).toBeNull();
  });
});
