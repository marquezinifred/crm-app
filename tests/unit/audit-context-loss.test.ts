// @vitest-environment node
// Env precisa estar setado antes de qualquer import que puxe env.ts
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regressão P-04 — audit() perde tenantId por escape do AsyncLocalStorage
 * dentro de fetchRequestHandler do tRPC. Fix: sempre passar
 * `tenantIdOverride: ctx.tenantId` no caller.
 *
 * Cenários testados:
 *   1) audit dentro de runWithTenant → grava com tenantId do contexto
 *   2) contexto perdido + tenantIdOverride → grava com override (o fix)
 *   3) sem contexto e sem override → descarta com warn (comportamento
 *      histórico documentado, prova por que o override é obrigatório)
 */

const createSpy = vi.fn();

vi.mock('@/server/db/client', () => ({
  prisma: {
    auditLog: {
      create: (...args: unknown[]) => createSpy(...args),
    },
  },
}));

// Usa o tenant-context real (AsyncLocalStorage) — não mockar aqui porque
// os cenários dependem do comportamento real do ALS.

describe('audit() — regressão P-04 (context loss via tRPC)', () => {
  beforeEach(() => {
    createSpy.mockReset();
    createSpy.mockResolvedValue({ id: 'audit-1' });
  });

  it('1) dentro de runWithTenant sem override → usa tenantId do ALS', async () => {
    const { audit } = await import('@/server/services/audit.service');
    const { runWithTenant } = await import('@/server/db/tenant-context');

    await runWithTenant(
      { tenantId: 'tenant-A', userId: 'user-1', role: 'ADMIN' },
      async () => {
        await audit({
          action: 'test.action',
          tableName: 'test_table',
          recordId: 'rec-1',
        });
      },
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0]![0].data.tenantId).toBe('tenant-A');
    expect(createSpy.mock.calls[0]![0].data.userId).toBe('user-1');
  });

  it('2) contexto perdido (chamada fora de runWithTenant) + override → grava com override', async () => {
    const { audit } = await import('@/server/services/audit.service');

    // Não envolve em runWithTenant — simula o bug real do tRPC onde
    // o AsyncLocalStorage escapa em callbacks assíncronos.
    await audit({
      action: 'test.action',
      tableName: 'test_table',
      recordId: 'rec-2',
      tenantIdOverride: 'tenant-B',
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0]![0].data.tenantId).toBe('tenant-B');
    // userId cai pra null porque não há contexto
    expect(createSpy.mock.calls[0]![0].data.userId).toBeNull();
  });

  it('3) sem contexto e sem override → descarta com warn (bug histórico)', async () => {
    const { audit } = await import('@/server/services/audit.service');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await audit({
      action: 'orphan.action',
      tableName: 'test_table',
      recordId: 'rec-3',
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[audit] chamado sem tenant'),
      'orphan.action',
    );
    warnSpy.mockRestore();
  });

  it('override tem precedência sobre contexto (ordem definida em audit.service)', async () => {
    const { audit } = await import('@/server/services/audit.service');
    const { runWithTenant } = await import('@/server/db/tenant-context');

    await runWithTenant(
      { tenantId: 'tenant-from-context', userId: 'u1', role: 'ADMIN' },
      async () => {
        await audit({
          action: 'test.override',
          tableName: 'test_table',
          recordId: 'rec-4',
          tenantIdOverride: 'tenant-from-override',
        });
      },
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0]![0].data.tenantId).toBe('tenant-from-override');
  });
});
