import { describe, it, expect } from 'vitest';
import { ROLE_DEFAULT_PERMISSIONS } from '@/lib/auth/rbac';
import { PERMISSION_KEYS } from '@/lib/auth/permissions-catalog';

/**
 * Sprint 15G Fase 1b — matriz de roles atualizada.
 *
 * Spec: `docs/Sprint_15G_estrutura_comercial.md` §6
 *
 * | Role               | read_team | read_all | sales_structure:read | sales_structure:manage |
 * |--------------------|:---------:|:--------:|:-------------------:|:---------------------:|
 * | ADMIN              | ✅        | ✅       | ✅                  | ✅                    |
 * | DIRETOR_COMERCIAL  | ✅        | ✅       | ✅                  | —                     |
 * | DIRETOR_OPERACOES  | ✅        | ✅       | ✅                  | —                     |
 * | DIRETOR_FINANCEIRO | —         | ✅       | ✅                  | —                     |
 * | GESTOR             | ✅        | —        | ✅                  | —                     |
 * | ANALISTA           | —         | —        | ✅                  | —                     |
 * | PARCEIRO           | —         | —        | —                   | —                     |
 */
describe('ROLE_DEFAULT_PERMISSIONS — Sprint 15G Fase 1b matriz', () => {
  it('ADMIN tem read_team + read_all + sales_structure:read + sales_structure:manage', () => {
    const admin = ROLE_DEFAULT_PERMISSIONS.ADMIN;
    expect(admin.has('opportunity:read_team')).toBe(true);
    expect(admin.has('opportunity:read_all')).toBe(true);
    expect(admin.has('sales_structure:read')).toBe(true);
    expect(admin.has('sales_structure:manage')).toBe(true);
  });

  it('DIRETOR_COMERCIAL tem read_team + read_all + sales_structure:read; NÃO tem sales_structure:manage', () => {
    const dc = ROLE_DEFAULT_PERMISSIONS.DIRETOR_COMERCIAL;
    expect(dc.has('opportunity:read_team')).toBe(true);
    expect(dc.has('opportunity:read_all')).toBe(true);
    expect(dc.has('sales_structure:read')).toBe(true);
    expect(dc.has('sales_structure:manage')).toBe(false);
  });

  it('DIRETOR_OPERACOES tem read_team + read_all + sales_structure:read; NÃO tem sales_structure:manage', () => {
    const doo = ROLE_DEFAULT_PERMISSIONS.DIRETOR_OPERACOES;
    expect(doo.has('opportunity:read_team')).toBe(true);
    expect(doo.has('opportunity:read_all')).toBe(true);
    expect(doo.has('sales_structure:read')).toBe(true);
    expect(doo.has('sales_structure:manage')).toBe(false);
  });

  it('DIRETOR_FINANCEIRO tem read_all + sales_structure:read; NÃO tem read_team nem sales_structure:manage', () => {
    const df = ROLE_DEFAULT_PERMISSIONS.DIRETOR_FINANCEIRO;
    expect(df.has('opportunity:read_all')).toBe(true);
    expect(df.has('sales_structure:read')).toBe(true);
    expect(df.has('opportunity:read_team')).toBe(false);
    expect(df.has('sales_structure:manage')).toBe(false);
  });

  it('GESTOR tem read_team + sales_structure:read; NÃO tem read_all nem sales_structure:manage', () => {
    const g = ROLE_DEFAULT_PERMISSIONS.GESTOR;
    expect(g.has('opportunity:read_team')).toBe(true);
    expect(g.has('sales_structure:read')).toBe(true);
    expect(g.has('opportunity:read_all')).toBe(false);
    expect(g.has('sales_structure:manage')).toBe(false);
  });

  it('ANALISTA tem sales_structure:read; NÃO tem nenhuma read_team/read_all', () => {
    const a = ROLE_DEFAULT_PERMISSIONS.ANALISTA;
    expect(a.has('sales_structure:read')).toBe(true);
    expect(a.has('opportunity:read_team')).toBe(false);
    expect(a.has('opportunity:read_all')).toBe(false);
    expect(a.has('sales_structure:manage')).toBe(false);
  });

  it('PARCEIRO NÃO tem nenhuma das 4 novas (isolamento estrito)', () => {
    const p = ROLE_DEFAULT_PERMISSIONS.PARCEIRO;
    expect(p.has('opportunity:read_team')).toBe(false);
    expect(p.has('opportunity:read_all')).toBe(false);
    expect(p.has('sales_structure:read')).toBe(false);
    expect(p.has('sales_structure:manage')).toBe(false);
  });

  it('NENHUM role tem opportunity:read_others (foi removida do catálogo)', () => {
    for (const [role, perms] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
      const hasReadOthers = Array.from(perms).some((p) => p === ('opportunity:read_others' as never));
      expect(hasReadOthers, `${role} não pode ter opportunity:read_others`).toBe(false);
    }
    expect(PERMISSION_KEYS.has('opportunity:read_others' as never)).toBe(false);
  });

  it('contagens totais por role conferem com spec §6 + 15G.5 transfer (ADMIN=64, DIRETOR_C=42, DIRETOR_O=28, DIRETOR_F=19, GESTOR=33, ANALISTA=24, PARCEIRO=5)', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.ADMIN.size).toBe(64);
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_COMERCIAL.size).toBe(42);
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_OPERACOES.size).toBe(28);
    expect(ROLE_DEFAULT_PERMISSIONS.DIRETOR_FINANCEIRO.size).toBe(19);
    expect(ROLE_DEFAULT_PERMISSIONS.GESTOR.size).toBe(33);
    expect(ROLE_DEFAULT_PERMISSIONS.ANALISTA.size).toBe(24);
    expect(ROLE_DEFAULT_PERMISSIONS.PARCEIRO.size).toBe(5);
  });

  it('toda permission default está no catálogo (validação de integridade)', () => {
    for (const [role, perms] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
      for (const p of perms) {
        expect(PERMISSION_KEYS.has(p), `${role} referencia permission fora do catálogo: ${p}`).toBe(true);
      }
    }
  });
});
