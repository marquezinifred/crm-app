import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  sessionAwareFetch,
  isPublicPath,
  __resetSessionGuardForTests,
} from '@/lib/trpc/session-guard';

/**
 * P-13 — testes do session guard fetch.
 *
 * O guard intercepta 401 do middleware e recarrega a página com
 * 800ms de atraso. Aqui validamos: dispara no 401, silencia em
 * rotas públicas, é idempotente por página (só 1 reload por batch),
 * e retorna a response intocada.
 */

const originalFetch = globalThis.fetch;
const originalConsoleWarn = console.warn;

function mockResponse(status: number, body?: unknown): Response {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setLocation(pathname: string): void {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname, reload: vi.fn(), assign: vi.fn() },
    writable: true,
  });
}

describe('isPublicPath', () => {
  it('/ é público', () => {
    expect(isPublicPath('/')).toBe(true);
  });

  it('/sign-in e variantes são públicas', () => {
    expect(isPublicPath('/sign-in')).toBe(true);
    expect(isPublicPath('/sign-in/factor-two')).toBe(true);
  });

  it('/sign-up é público', () => {
    expect(isPublicPath('/sign-up')).toBe(true);
  });

  it('/onboarding é público', () => {
    expect(isPublicPath('/onboarding')).toBe(true);
    expect(isPublicPath('/onboarding/setup')).toBe(true);
  });

  it('/p/[slug]/contact é público', () => {
    expect(isPublicPath('/p/marquezini/contact')).toBe(true);
  });

  it('/privacy e /terms são públicos', () => {
    expect(isPublicPath('/privacy')).toBe(true);
    expect(isPublicPath('/terms')).toBe(true);
    expect(isPublicPath('/privacy-request')).toBe(true);
  });

  it('/dashboard NÃO é público', () => {
    expect(isPublicPath('/dashboard')).toBe(false);
  });

  it('/pipeline/xxx NÃO é público', () => {
    expect(isPublicPath('/pipeline/abc-123')).toBe(false);
  });

  it('/admin/ai NÃO é público', () => {
    expect(isPublicPath('/admin/ai')).toBe(false);
  });
});

describe('sessionAwareFetch', () => {
  beforeEach(() => {
    __resetSessionGuardForTests();
    vi.useFakeTimers();
    setLocation('/dashboard');
    console.warn = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    console.warn = originalConsoleWarn;
  });

  it('response 200 → retorna intocada, não recarrega', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(200, { ok: true }));

    const res = await sessionAwareFetch('/api/trpc/anything');

    expect(res.status).toBe(200);
    vi.advanceTimersByTime(2000);
    expect(window.location.reload).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('response 401 → agenda reload em ~800ms com mensagem do body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(401, {
        error: { code: 'UNAUTHORIZED', message: 'Sessão expirada ou ausente. Faça login novamente.' },
      }),
    );

    const res = await sessionAwareFetch('/api/trpc/opportunities.byId');

    expect(res.status).toBe(401);
    expect(console.warn).toHaveBeenCalledWith(
      '[session-guard]',
      expect.stringContaining('Sessão expirada'),
    );
    expect(window.location.reload).not.toHaveBeenCalled();

    vi.advanceTimersByTime(800);
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('duas responses 401 seguidas → recarrega só uma vez (idempotente)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }),
    );

    await sessionAwareFetch('/api/trpc/a');
    await sessionAwareFetch('/api/trpc/b');
    await sessionAwareFetch('/api/trpc/c');

    vi.advanceTimersByTime(1000);
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('401 em /sign-in → NÃO recarrega', async () => {
    setLocation('/sign-in');
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }),
    );

    await sessionAwareFetch('/api/trpc/anything');

    vi.advanceTimersByTime(2000);
    expect(window.location.reload).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('401 com body não-JSON → usa mensagem padrão', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('<html>500 nginx</html>', {
        status: 401,
        headers: { 'content-type': 'text/html' },
      }),
    );

    await sessionAwareFetch('/api/trpc/anything');

    expect(console.warn).toHaveBeenCalledWith(
      '[session-guard]',
      'Sua sessão expirou. Recarregando…',
    );
    vi.advanceTimersByTime(800);
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('401 com body JSON sem error.message → usa mensagem padrão', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(401, { foo: 'bar' }));

    await sessionAwareFetch('/api/trpc/anything');

    expect(console.warn).toHaveBeenCalledWith(
      '[session-guard]',
      'Sua sessão expirou. Recarregando…',
    );
  });

  it('response 403 → não intercepta (só 401 é sessão)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(403, { error: { code: 'FORBIDDEN', message: 'x' } }),
    );

    const res = await sessionAwareFetch('/api/trpc/anything');

    expect(res.status).toBe(403);
    vi.advanceTimersByTime(2000);
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  // ── P-82 — 401 "autenticado mas sem provisionamento" ──────────────

  it('401 com marcador USER_NOT_PROVISIONED (formato middleware) → redireciona, NÃO recarrega', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(401, {
        error: { code: 'UNAUTHORIZED', message: 'USER_NOT_PROVISIONED' },
      }),
    );

    const res = await sessionAwareFetch('/api/trpc/opportunities.list');

    expect(res.status).toBe(401);
    expect(window.location.assign).toHaveBeenCalledTimes(1);
    expect(window.location.assign).toHaveBeenCalledWith('/account-not-found');
    // NÃO recarrega — reload seria o loop infinito do P-82
    vi.advanceTimersByTime(2000);
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('401 com marcador no envelope tRPC batch → redireciona (parse robusto ao formato)', async () => {
    // Formato real do httpBatchLink: array de resultados com error.json.message
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(401, [
        {
          error: {
            json: {
              message: 'USER_NOT_PROVISIONED',
              code: -32001,
              data: { code: 'UNAUTHORIZED', httpStatus: 401, path: 'users.me' },
            },
          },
        },
      ]),
    );

    await sessionAwareFetch('/api/trpc/users.me?batch=1');

    expect(window.location.assign).toHaveBeenCalledWith('/account-not-found');
    vi.advanceTimersByTime(2000);
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('marcador + batch com N procedures → redireciona só uma vez (idempotente)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(401, {
        error: { code: 'UNAUTHORIZED', message: 'USER_NOT_PROVISIONED' },
      }),
    );

    await sessionAwareFetch('/api/trpc/a');
    await sessionAwareFetch('/api/trpc/b');
    await sessionAwareFetch('/api/trpc/c');

    expect(window.location.assign).toHaveBeenCalledTimes(1);
  });

  it('já em /account-not-found → 401 com marcador é no-op (não redireciona em loop)', async () => {
    setLocation('/account-not-found');
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(401, {
        error: { code: 'UNAUTHORIZED', message: 'USER_NOT_PROVISIONED' },
      }),
    );

    const res = await sessionAwareFetch('/api/trpc/anything');

    expect(res.status).toBe(401);
    expect(window.location.assign).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(window.location.reload).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('já em /account-not-found → 401 comum também é no-op', async () => {
    setLocation('/account-not-found');
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }),
    );

    await sessionAwareFetch('/api/trpc/anything');

    vi.advanceTimersByTime(2000);
    expect(window.location.reload).not.toHaveBeenCalled();
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it('401 comum (sem marcador) → recarrega, NÃO redireciona (P-13 preservado)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(401, {
        error: { code: 'UNAUTHORIZED', message: 'Sessão expirada ou ausente. Faça login novamente.' },
      }),
    );

    await sessionAwareFetch('/api/trpc/opportunities.byId');

    expect(window.location.assign).not.toHaveBeenCalled();
    vi.advanceTimersByTime(800);
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('reset da flag entre testes funciona', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }),
    );

    await sessionAwareFetch('/api/trpc/anything');
    vi.advanceTimersByTime(800);
    const firstReload = window.location.reload;
    expect(firstReload).toHaveBeenCalledTimes(1);

    __resetSessionGuardForTests();
    setLocation('/dashboard');

    await sessionAwareFetch('/api/trpc/anything');
    vi.advanceTimersByTime(800);
    // setLocation troca window.location, então o segundo reload é uma
    // spy nova. Confirma que o guard não segurou por conta da flag.
    expect(window.location.reload).toHaveBeenCalledTimes(1);
    expect(window.location.reload).not.toBe(firstReload);
  });
});
