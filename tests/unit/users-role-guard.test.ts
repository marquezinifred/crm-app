import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { UserRole } from '@prisma/client';

/**
 * Replica a função de guard testada — espelha o que está em
 * src/server/trpc/routers/users.ts para evitar precisar setup de DB.
 */
function assertCanAssignSuperAdmin(callerRole: UserRole, targetRole: UserRole): void {
  if (targetRole === 'SUPER_ADMIN' && callerRole !== 'SUPER_ADMIN') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Apenas SUPER_ADMIN pode atribuir a role SUPER_ADMIN.',
    });
  }
}

describe('guard SUPER_ADMIN — users.updateRole', () => {
  it('ADMIN não pode promover ninguém para SUPER_ADMIN', () => {
    expect(() => assertCanAssignSuperAdmin('ADMIN', 'SUPER_ADMIN')).toThrow(TRPCError);
  });

  it('SUPER_ADMIN pode promover outro para SUPER_ADMIN', () => {
    expect(() => assertCanAssignSuperAdmin('SUPER_ADMIN', 'SUPER_ADMIN')).not.toThrow();
  });

  it('ADMIN pode atribuir roles abaixo de SUPER_ADMIN', () => {
    expect(() => assertCanAssignSuperAdmin('ADMIN', 'GESTOR')).not.toThrow();
    expect(() => assertCanAssignSuperAdmin('ADMIN', 'DIRETOR_COMERCIAL')).not.toThrow();
    expect(() => assertCanAssignSuperAdmin('ADMIN', 'PARCEIRO')).not.toThrow();
  });

  it('GESTOR (em hipótese) também não pode promover para SUPER_ADMIN', () => {
    expect(() => assertCanAssignSuperAdmin('GESTOR', 'SUPER_ADMIN')).toThrow(TRPCError);
  });

  it('código do erro é FORBIDDEN', () => {
    try {
      assertCanAssignSuperAdmin('ADMIN', 'SUPER_ADMIN');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      expect((e as TRPCError).code).toBe('FORBIDDEN');
    }
  });
});
