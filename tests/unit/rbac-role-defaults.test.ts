/* eslint-disable */
// @vitest-environment node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- QA scaffolding Sprint 15E; describe.skip até validação manual
//
// Sprint 15E mergeado — tests em describe.skip até validação manual.
//
// AC-03 — ROLE_DEFAULT_PERMISSIONS com contagens exatas:
//   ADMIN=60, DIRETOR_C=39, DIRETOR_O=25, DIRETOR_F=18,
//   GESTOR=31, ANALISTA=23, PARCEIRO=5.
// Todas as permissions referenciadas existem no catálogo.
//
// TODO(Sprint 15E): remover describe.skip após merge da Fase 1.
// Depende de: src/lib/auth/rbac.ts (refactor Sprint 15E).

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect } from 'vitest';
import { EXPECTED_ROLE_COUNTS } from '../helpers/rbac-fixtures';

describe.skip('AC-03 — ROLE_DEFAULT_PERMISSIONS contagens e integridade', () => {
  it.each(Object.entries(EXPECTED_ROLE_COUNTS))(
    'role %s tem exatamente %i permissions default',
    async (role, expectedCount) => {
      const { ROLE_DEFAULT_PERMISSIONS } = await import('@/lib/auth/rbac');
      const set = ROLE_DEFAULT_PERMISSIONS[role as keyof typeof ROLE_DEFAULT_PERMISSIONS];
      expect(set.size).toBe(expectedCount);
    },
  );

  it('todas as permissions default de cada role existem no catálogo', async () => {
    const { ROLE_DEFAULT_PERMISSIONS } = await import('@/lib/auth/rbac');
    const { PERMISSIONS_CATALOG } = await import('@/lib/auth/permissions-catalog');
    const catalogKeys = new Set(PERMISSIONS_CATALOG.map((p) => p.key));

    for (const [role, perms] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
      for (const perm of perms) {
        expect(
          catalogKeys.has(perm),
          `permission "${perm}" atribuída a "${role}" não existe no catálogo`,
        ).toBe(true);
      }
    }
  });

  it('ADMIN NÃO tem audit:read_platform (Platform Owner only, permission-matrix §Audit)', async () => {
    const { ROLE_DEFAULT_PERMISSIONS } = await import('@/lib/auth/rbac');
    expect(ROLE_DEFAULT_PERMISSIONS.ADMIN.has('audit:read_platform')).toBe(false);
  });

  it('ADMIN é o único com user:grant_permissions por default', async () => {
    const { ROLE_DEFAULT_PERMISSIONS } = await import('@/lib/auth/rbac');
    expect(ROLE_DEFAULT_PERMISSIONS.ADMIN.has('user:grant_permissions')).toBe(true);
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_COMERCIAL.has('user:grant_permissions')).toBe(false);
    expect(ROLE_DEFAULT_PERMISSIONS.GESTOR.has('user:grant_permissions')).toBe(false);
    expect(ROLE_DEFAULT_PERMISSIONS.ANALISTA.has('user:grant_permissions')).toBe(false);
  });

  it('ANALISTA NÃO tem opportunity:read_others por default (breaking change §6.4)', async () => {
    const { ROLE_DEFAULT_PERMISSIONS } = await import('@/lib/auth/rbac');
    expect(ROLE_DEFAULT_PERMISSIONS.ANALISTA.has('opportunity:read_others')).toBe(false);
    expect(ROLE_DEFAULT_PERMISSIONS.ANALISTA.has('opportunity:read')).toBe(true);
  });

  it('DIRETOR_FINANCEIRO NÃO cria opportunity mas aprova proposal', async () => {
    const { ROLE_DEFAULT_PERMISSIONS } = await import('@/lib/auth/rbac');
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_FINANCEIRO.has('opportunity:create')).toBe(false);
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_FINANCEIRO.has('proposal:approve')).toBe(true);
  });

  it('DIRETOR_OPERACOES gerencia contract mas NÃO aprova proposal', async () => {
    const { ROLE_DEFAULT_PERMISSIONS } = await import('@/lib/auth/rbac');
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_OPERACOES.has('contract:create')).toBe(true);
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_OPERACOES.has('contract:update')).toBe(true);
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_OPERACOES.has('proposal:approve')).toBe(false);
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_OPERACOES.has('partner:approve_engagement')).toBe(true);
  });

  it('PARCEIRO tem só as 5 permissions restritas (isolamento)', async () => {
    const { ROLE_DEFAULT_PERMISSIONS } = await import('@/lib/auth/rbac');
    const perms = Array.from(ROLE_DEFAULT_PERMISSIONS.PARCEIRO).sort();
    expect(perms).toEqual(
      ['company:read', 'contact:read', 'document:read', 'document:upload', 'opportunity:read']
        .sort(),
    );
  });

  it('reports:financial só em ADMIN/DIRETOR_C/DIRETOR_F', async () => {
    const { ROLE_DEFAULT_PERMISSIONS } = await import('@/lib/auth/rbac');
    expect(ROLE_DEFAULT_PERMISSIONS.ADMIN.has('reports:financial')).toBe(true);
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_COMERCIAL.has('reports:financial')).toBe(true);
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_FINANCEIRO.has('reports:financial')).toBe(true);
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_OPERACOES.has('reports:financial')).toBe(false);
    expect(ROLE_DEFAULT_PERMISSIONS.GESTOR.has('reports:financial')).toBe(false);
    expect(ROLE_DEFAULT_PERMISSIONS.ANALISTA.has('reports:financial')).toBe(false);
  });

  it('inbound:configure só em ADMIN (permission-matrix §Inbound)', async () => {
    const { ROLE_DEFAULT_PERMISSIONS } = await import('@/lib/auth/rbac');
    expect(ROLE_DEFAULT_PERMISSIONS.ADMIN.has('inbound:configure')).toBe(true);
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_COMERCIAL.has('inbound:configure')).toBe(false);
    expect(ROLE_DEFAULT_PERMISSIONS.GESTOR.has('inbound:configure')).toBe(false);
  });
});
