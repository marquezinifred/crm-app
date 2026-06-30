import { describe, it, expect } from 'vitest';
import type { UserRole } from '@prisma/client';

/**
 * Sprint 15A — gestão de Platform Owner saiu de users.updateRole
 * (que só lida com tenant roles) para o router `platform`. Aqui
 * apenas validamos que SUPER_ADMIN não está mais entre os roles
 * atribuíveis dentro do tenant.
 */
const ASSIGNABLE_TENANT_ROLES: UserRole[] = [
  'ADMIN',
  'DIRETOR_COMERCIAL',
  'DIRETOR_OPERACOES',
  'DIRETOR_FINANCEIRO',
  'GESTOR',
  'ANALISTA',
  'PARCEIRO',
];

describe('users.updateRole — Sprint 15A taxonomia', () => {
  it('lista inclui os 3 diretores (Comercial / Operações / Financeiro)', () => {
    expect(ASSIGNABLE_TENANT_ROLES).toContain('DIRETOR_COMERCIAL');
    expect(ASSIGNABLE_TENANT_ROLES).toContain('DIRETOR_OPERACOES');
    expect(ASSIGNABLE_TENANT_ROLES).toContain('DIRETOR_FINANCEIRO');
  });

  it('SUPER_ADMIN não está mais no enum tenant-side', () => {
    expect(ASSIGNABLE_TENANT_ROLES).not.toContain('SUPER_ADMIN' as unknown as UserRole);
  });

  it('ADMIN continua presente como teto tenant-side', () => {
    expect(ASSIGNABLE_TENANT_ROLES[0]).toBe('ADMIN');
  });

  it('tem exatamente 7 roles', () => {
    expect(ASSIGNABLE_TENANT_ROLES).toHaveLength(7);
  });
});
