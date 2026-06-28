import type { UserRole } from '@prisma/client';

/**
 * Matriz de permissões por perfil.
 * Cada chave de Action é um identificador de capacidade no domínio.
 * Sprints futuros podem expandir esta matriz à medida que módulos surgirem.
 */

export const ACTIONS = {
  tenant: ['read', 'update'] as const,
  user: ['create', 'read', 'update', 'delete'] as const,
  catalog: ['create', 'read', 'update', 'delete'] as const, // território, segmento, produto
  company: ['create', 'read', 'update', 'delete'] as const,
  contact: ['create', 'read', 'update', 'delete'] as const,
  opportunity: ['create', 'read', 'update', 'delete', 'advance_stage', 'cancel'] as const,
  proposal: ['create', 'read', 'update', 'approve'] as const,
  contract: ['create', 'read', 'update'] as const,
  partner: ['invite', 'approve_engagement'] as const,
  ai: ['use_summary', 'configure'] as const,
  alert: ['configure'] as const,
  audit: ['read'] as const,
} as const;

type ActionMap = typeof ACTIONS;
type Resource = keyof ActionMap;
type ActionOf<R extends Resource> = ActionMap[R][number];

type Permission = `${Resource}:${string}`;

const ROLE_PERMISSIONS: Record<UserRole, Set<Permission>> = {
  SUPER_ADMIN: new Set([
    // Acesso total a tudo — bypass na função hasPermission
  ]) as Set<Permission>,

  ADMIN: new Set<Permission>([
    'tenant:read', 'tenant:update',
    'user:create', 'user:read', 'user:update', 'user:delete',
    'catalog:create', 'catalog:read', 'catalog:update', 'catalog:delete',
    'company:create', 'company:read', 'company:update', 'company:delete',
    'contact:create', 'contact:read', 'contact:update', 'contact:delete',
    'opportunity:create', 'opportunity:read', 'opportunity:update', 'opportunity:delete', 'opportunity:advance_stage', 'opportunity:cancel',
    'proposal:create', 'proposal:read', 'proposal:update', 'proposal:approve',
    'contract:create', 'contract:read', 'contract:update',
    'partner:invite', 'partner:approve_engagement',
    'ai:use_summary', 'ai:configure',
    'alert:configure',
    'audit:read',
  ]),

  DIRETOR_COMERCIAL: new Set<Permission>([
    'tenant:read',
    'user:read',
    'catalog:read',
    'company:read', 'company:update',
    'contact:read', 'contact:update',
    'opportunity:create', 'opportunity:read', 'opportunity:update', 'opportunity:advance_stage', 'opportunity:cancel',
    'proposal:create', 'proposal:read', 'proposal:update', 'proposal:approve',
    'contract:create', 'contract:read', 'contract:update',
    'partner:invite', 'partner:approve_engagement',
    'ai:use_summary',
    'audit:read',
  ]),

  // Diretor Financeiro: aprovação de propostas por margem/valor + relatórios
  // financeiros. Não cria/edita pipeline, mas tem visão de leitura ampla.
  DIRETOR_FINANCEIRO: new Set<Permission>([
    'tenant:read',
    'company:read',
    'contact:read',
    'opportunity:read',
    'proposal:read', 'proposal:approve',
    'contract:read',
    'audit:read',
  ]),

  GESTOR: new Set<Permission>([
    'company:create', 'company:read', 'company:update',
    'contact:create', 'contact:read', 'contact:update',
    'opportunity:create', 'opportunity:read', 'opportunity:update', 'opportunity:advance_stage', 'opportunity:cancel',
    'proposal:create', 'proposal:read', 'proposal:update',
    'contract:read',
    'partner:invite', 'partner:approve_engagement',
    'ai:use_summary',
  ]),

  ANALISTA: new Set<Permission>([
    'company:create', 'company:read', 'company:update',
    'contact:create', 'contact:read', 'contact:update',
    'opportunity:create', 'opportunity:read', 'opportunity:update',
    'proposal:create', 'proposal:read', 'proposal:update',
    'contract:read',
    'ai:use_summary',
  ]),

  PARCEIRO: new Set<Permission>([
    'company:read',
    'contact:read',
    'opportunity:read',
    'proposal:read',
  ]),
};

export function hasPermission<R extends Resource>(
  role: UserRole | null | undefined,
  resource: R,
  action: ActionOf<R>,
): boolean {
  if (!role) return false;
  if (role === 'SUPER_ADMIN') return true;
  const perm = `${resource}:${action}` as Permission;
  return ROLE_PERMISSIONS[role].has(perm);
}

export function requirePermission<R extends Resource>(
  role: UserRole | null | undefined,
  resource: R,
  action: ActionOf<R>,
): void {
  if (!hasPermission(role, resource, action)) {
    throw new ForbiddenError(
      `Acesso negado: ${role ?? 'sem perfil'} não tem permissão ${resource}:${action}`,
    );
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}
