/* eslint-disable */
// @vitest-environment node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- QA scaffolding Sprint 15E; describe.skip até validação manual
//
// AC-08 — Cada procedure responde 403 sem permission + 200 com — smoke
//         test em 10 procedures representativas (SMOKE_PROCEDURES).
//
// Estratégia: para cada procedure em SMOKE_PROCEDURES, monta caller com
// mock de hasPermission → true/false e verifica que o middleware
// withPermission bloqueia ou libera corretamente.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SMOKE_PROCEDURES, makeCtx } from '../helpers/rbac-fixtures';

const hasPermissionSpy = vi.fn();

vi.mock('@/lib/auth/rbac', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/rbac')>();
  return {
    ...actual,
    hasPermission: (...args: unknown[]) => hasPermissionSpy(...args),
  };
});

// Prisma stubs — cada procedure precisa de sua camada de dados mockada.
// Aqui só validamos que o middleware bloqueia ANTES da query rodar.
vi.mock('@/server/db/client', () => ({
  prisma: new Proxy({}, {
    get: () =>
      new Proxy({}, {
        get: () => vi.fn().mockResolvedValue(null),
      }),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe.skip('AC-08 — smoke 403/200 em 10 procedures representativas', () => {
  for (const [procPath, requiredPerm] of SMOKE_PROCEDURES) {
    describe(procPath, () => {
      it(`retorna FORBIDDEN quando hasPermission("${requiredPerm}") = false`, async () => {
        hasPermissionSpy.mockResolvedValue(false);
        const [routerName, procName] = procPath.split('.') as [string, string];

        const routerModule = await import(
          `@/server/trpc/routers/${routerName}`
        );
        // Cada router exporta o próprio ex: `companiesRouter`, `inboundRouter`
        const router =
          routerModule[`${routerName}Router`] ??
          routerModule[routerName] ??
          Object.values(routerModule).find(
            (v) => typeof v === 'object' && v !== null && 'createCaller' in v,
          );
        expect(router).toBeDefined();

        const caller = router.createCaller(makeCtx({ role: 'ANALISTA' }));
        const proc = caller[procName];
        expect(typeof proc).toBe('function');

        await expect(
          proc({}), // input mínimo — pode falhar Zod, mas 403 acontece antes
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });

        expect(hasPermissionSpy).toHaveBeenCalledWith(
          expect.any(String),
          requiredPerm,
        );
      });

      it(`prossegue para query quando hasPermission("${requiredPerm}") = true`, async () => {
        hasPermissionSpy.mockResolvedValue(true);
        const [routerName, procName] = procPath.split('.') as [string, string];

        const routerModule = await import(
          `@/server/trpc/routers/${routerName}`
        );
        const router =
          routerModule[`${routerName}Router`] ??
          routerModule[routerName] ??
          Object.values(routerModule).find(
            (v) => typeof v === 'object' && v !== null && 'createCaller' in v,
          );
        const caller = router.createCaller(makeCtx({ role: 'ADMIN' }));

        // Não checamos o resultado (mock retorna null) — só que NÃO caiu em FORBIDDEN.
        try {
          await caller[procName]({});
        } catch (err: unknown) {
          const code = (err as { code?: string }).code;
          expect(code, `Procedure ${procPath} caiu com ${code}`).not.toBe('FORBIDDEN');
        }
      });
    });
  }
});
