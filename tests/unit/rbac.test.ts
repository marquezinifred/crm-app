import { describe, it, expect } from 'vitest';
import { hasPermission, requirePermission, ForbiddenError } from '@/lib/auth/rbac';

describe('RBAC', () => {
  it('SUPER_ADMIN tem acesso a tudo', () => {
    expect(hasPermission('SUPER_ADMIN', 'user', 'delete')).toBe(true);
    expect(hasPermission('SUPER_ADMIN', 'tenant', 'update')).toBe(true);
    expect(hasPermission('SUPER_ADMIN', 'ai', 'configure')).toBe(true);
  });

  it('ANALISTA não pode deletar empresa', () => {
    expect(hasPermission('ANALISTA', 'company', 'delete')).toBe(false);
    expect(hasPermission('ANALISTA', 'company', 'read')).toBe(true);
  });

  it('PARCEIRO só lê — não cria nada', () => {
    expect(hasPermission('PARCEIRO', 'company', 'read')).toBe(true);
    expect(hasPermission('PARCEIRO', 'company', 'create')).toBe(false);
    expect(hasPermission('PARCEIRO', 'opportunity', 'create')).toBe(false);
  });

  it('GESTOR pode aprovar engajamento de parceiro', () => {
    expect(hasPermission('GESTOR', 'partner', 'approve_engagement')).toBe(true);
  });

  it('ANALISTA não pode aprovar engajamento de parceiro', () => {
    expect(hasPermission('ANALISTA', 'partner', 'approve_engagement')).toBe(false);
  });

  it('DIRETOR_COMERCIAL pode aprovar proposta', () => {
    expect(hasPermission('DIRETOR_COMERCIAL', 'proposal', 'approve')).toBe(true);
  });

  it('DIRETOR_FINANCEIRO pode aprovar proposta mas não criar oportunidade', () => {
    expect(hasPermission('DIRETOR_FINANCEIRO', 'proposal', 'approve')).toBe(true);
    expect(hasPermission('DIRETOR_FINANCEIRO', 'opportunity', 'create')).toBe(false);
  });

  it('requirePermission dispara ForbiddenError', () => {
    expect(() => requirePermission('PARCEIRO', 'user', 'delete')).toThrow(ForbiddenError);
  });

  it('papel nulo nunca tem acesso', () => {
    expect(hasPermission(null, 'company', 'read')).toBe(false);
    expect(hasPermission(undefined, 'company', 'read')).toBe(false);
  });
});
