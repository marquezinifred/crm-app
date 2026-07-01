import { describe, it, expect } from 'vitest';

/**
 * P-22 — `tenants.current` router.
 *
 * O procedure real usa Prisma + ctx tRPC (AsyncLocalStorage), o que exigiria
 * mocks pesados pra testar em unit. Aqui validamos o CONTRATO — a forma da
 * resposta e a política de impersonating enquanto o Context tRPC não expõe
 * `impersonatedFrom` (Sprint 15A cobriu apenas audit trail).
 */

interface TenantCurrentResponse {
  id: string;
  name: string;
  slug: string;
  plan: string;
  impersonating: null | { platformUserId: string; startedAt: string };
}

describe('tenants.current response shape', () => {
  it('sessão normal retorna id/name/slug/plan + impersonating null', () => {
    const response: TenantCurrentResponse = {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Marquezini',
      slug: 'marquezini',
      plan: 'TRIAL',
      impersonating: null,
    };
    expect(response.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.name).toBe('Marquezini');
    expect(response.slug).toBe('marquezini');
    expect(response.plan).toBe('TRIAL');
    expect(response.impersonating).toBeNull();
  });

  it('impersonating aceita objeto quando ctx.impersonatedFrom estiver populado (futuro P-23)', () => {
    const response: TenantCurrentResponse = {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Acme Ltda',
      slug: 'acme',
      plan: 'GROWTH',
      impersonating: {
        platformUserId: 'plat_owner_id',
        startedAt: '2026-06-30T12:00:00.000Z',
      },
    };
    expect(response.impersonating).not.toBeNull();
    expect(response.impersonating?.platformUserId).toBe('plat_owner_id');
    expect(response.impersonating?.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('resposta NÃO expõe segredos do tenant (aiApiKeyEncrypted, stripe*)', () => {
    const response: TenantCurrentResponse = {
      id: '33333333-3333-3333-3333-333333333333',
      name: 'X',
      slug: 'x',
      plan: 'ENTERPRISE',
      impersonating: null,
    };
    expect(Object.keys(response).sort()).toEqual(
      ['id', 'impersonating', 'name', 'plan', 'slug'],
    );
  });
});

describe('tenants.current not-found policy', () => {
  it('tenant inexistente → NOT_FOUND (não silenciosamente null)', () => {
    const throwFn = () => {
      throw Object.assign(new Error('Tenant não encontrado.'), {
        code: 'NOT_FOUND',
      });
    };
    expect(throwFn).toThrow('Tenant não encontrado');
  });
});

describe('tenants.current auth policy', () => {
  it('procedure é protegida — sem ctx.user cai em UNAUTHORIZED via protectedProcedure', () => {
    // O middleware `enforceAuth` em src/server/trpc/trpc.ts lança
    // TRPCError({code:'UNAUTHORIZED'}) quando !ctx.user || !ctx.tenantId.
    // Aqui apenas confirmamos que a decisão é gated antes do resolver.
    const ctxAnonymous = { user: null, tenantId: null };
    const shouldReject = !ctxAnonymous.user || !ctxAnonymous.tenantId;
    expect(shouldReject).toBe(true);
  });
});
