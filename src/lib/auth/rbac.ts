import type { UserRole } from '@prisma/client';
import { PERMISSION_KEYS, type Permission } from './permissions-catalog';

/**
 * RBAC — Sprint 15E (granular permissions).
 *
 * Duas APIs coexistem durante a migração dos 47 procedures:
 *
 *   API nova (usar em código novo):
 *     - `hasPermission(userId, permission)` — async, considera role
 *       default + overrides individuais + cache.
 *     - `hasPermissionByRole(role, permission)` — síncrona, só olha
 *       role default. Uso na UI pra esconder botões.
 *     - `computeAndCacheUserPermissions(userId)` — recomputa e persiste.
 *     - `invalidateUserPermissionsCache(userId)` — seta cache como NULL.
 *     - Middleware: `withPermission('resource:action')`.
 *
 *   API legada (compat — usada por `withCapability` até Sprint 15G):
 *     - `ACTIONS` — mapa de resource → actions permitidas
 *     - `ROLE_CAPABILITIES` — matriz por role
 *     - `hasCapability(role, resource, action)` — síncrona
 *
 * Ambas retornam o MESMO resultado pra permissions que existem no
 * catálogo novo — o `ROLE_CAPABILITIES` é derivado de
 * `ROLE_DEFAULT_PERMISSIONS` no boot, filtrando as poucas keys que só
 * existem no legado (`opportunity:assign`, `opportunity:set_inbound_owner`,
 * `ai:configure`).
 */

// =====================================================================
// NOVA API — Sprint 15E
// =====================================================================

export { PERMISSIONS_CATALOG, PERMISSION_KEYS, type Permission } from './permissions-catalog';

/**
 * Defaults por role. Contagens validadas contra `docs/permission-matrix.md`
 * (2026-07-01):
 *   ADMIN=60, DIRETOR_COMERCIAL=39, DIRETOR_OPERACOES=25,
 *   DIRETOR_FINANCEIRO=18, GESTOR=31, ANALISTA=23, PARCEIRO=5.
 *
 * NOTA sobre PARCEIRO: as 5 permissions são potenciais — o service
 * aplica filtro row-level (Sprint 7) restringindo ao escopo dos
 * engajamentos aprovados. Nenhum PARCEIRO enxerga companies/contacts/
 * opps/documents fora dos que participa.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  ADMIN: new Set<Permission>([
    // Tenant (2)
    'tenant:read', 'tenant:update',
    // Users (5)
    'user:create', 'user:read', 'user:update', 'user:delete', 'user:grant_permissions',
    // Catalog (4)
    'catalog:create', 'catalog:read', 'catalog:update', 'catalog:delete',
    // Companies (4)
    'company:create', 'company:read', 'company:update', 'company:delete',
    // Contacts (4)
    'contact:create', 'contact:read', 'contact:update', 'contact:delete',
    // Opportunities (7)
    'opportunity:create', 'opportunity:read', 'opportunity:update', 'opportunity:delete',
    'opportunity:advance_stage', 'opportunity:cancel', 'opportunity:read_others',
    // Proposals (4)
    'proposal:create', 'proposal:read', 'proposal:update', 'proposal:approve',
    // Contracts (3)
    'contract:create', 'contract:read', 'contract:update',
    // Documents (3)
    'document:upload', 'document:read', 'document:delete',
    // Tasks (3)
    'task:create', 'task:update', 'task:delete',
    // Partners (2)
    'partner:invite', 'partner:approve_engagement',
    // Inbound (4)
    'inbound:view_queue', 'inbound:assign_prospects', 'inbound:configure', 'inbound:view_reports',
    // Reports (3)
    'reports:read', 'reports:financial', 'reports:export',
    // AI (7)
    'ai:use_summary', 'ai:use_extraction', 'ai:use_scoring',
    'ai:configure_global', 'ai:configure_feature', 'ai:test_key', 'ai:manage_breaker',
    // Alerts (2)
    'alert:configure', 'alert:receive_admin',
    // Audit (1) — audit:read_platform é Platform Owner only
    'audit:read',
    // Import (2)
    'import:run', 'import:read',
  ]), // 60

  DIRETOR_COMERCIAL: new Set<Permission>([
    'tenant:read',
    'user:read',
    'catalog:read',
    'company:read', 'company:update',
    'contact:read', 'contact:update',
    'opportunity:create', 'opportunity:read', 'opportunity:update',
    'opportunity:advance_stage', 'opportunity:cancel', 'opportunity:read_others',
    'proposal:create', 'proposal:read', 'proposal:update', 'proposal:approve',
    'contract:create', 'contract:read', 'contract:update',
    'document:upload', 'document:read',
    'task:create', 'task:update', 'task:delete',
    'partner:invite', 'partner:approve_engagement',
    'inbound:view_queue', 'inbound:assign_prospects', 'inbound:view_reports',
    'reports:read', 'reports:financial', 'reports:export',
    'ai:use_summary', 'ai:use_extraction', 'ai:use_scoring',
    'alert:receive_admin',
    'audit:read',
    'import:read',
  ]), // 39

  DIRETOR_OPERACOES: new Set<Permission>([
    'tenant:read',
    'user:read',
    'catalog:read',
    'company:read', 'company:update',
    'contact:read', 'contact:update',
    'opportunity:read', 'opportunity:read_others',
    'proposal:read',
    'contract:create', 'contract:read', 'contract:update',
    'document:upload', 'document:read',
    'task:create', 'task:update', 'task:delete',
    'partner:invite', 'partner:approve_engagement',
    'reports:read',
    'ai:use_summary',
    'alert:receive_admin',
    'audit:read',
    'import:read',
  ]), // 25

  DIRETOR_FINANCEIRO: new Set<Permission>([
    'tenant:read',
    'user:read',
    'catalog:read',
    'company:read',
    'contact:read',
    'opportunity:read', 'opportunity:read_others',
    'proposal:read', 'proposal:approve',
    'contract:read',
    'document:read',
    'inbound:view_reports',
    'reports:read', 'reports:financial', 'reports:export',
    'ai:use_scoring',
    'alert:receive_admin',
    'audit:read',
  ]), // 18

  GESTOR: new Set<Permission>([
    'user:read',
    'catalog:read',
    'company:create', 'company:read', 'company:update',
    'contact:create', 'contact:read', 'contact:update',
    'opportunity:create', 'opportunity:read', 'opportunity:update',
    'opportunity:advance_stage', 'opportunity:cancel', 'opportunity:read_others',
    'proposal:create', 'proposal:read', 'proposal:update',
    'contract:read',
    'document:upload', 'document:read',
    'task:create', 'task:update', 'task:delete',
    'partner:invite',
    'reports:read', 'reports:export',
    'ai:use_summary', 'ai:use_extraction', 'ai:use_scoring',
    'import:run', 'import:read',
  ]), // 31

  ANALISTA: new Set<Permission>([
    'catalog:read',
    'company:create', 'company:read', 'company:update',
    'contact:create', 'contact:read', 'contact:update',
    'opportunity:create', 'opportunity:read', 'opportunity:update',
    'opportunity:advance_stage', 'opportunity:cancel',
    // NOTE: ANALISTA NÃO tem `opportunity:read_others` — só vê próprias opps
    // Breaking change do Sprint 15E; admin pode conceder override individual.
    'proposal:read',
    'contract:read',
    'document:upload', 'document:read',
    'task:create', 'task:update', 'task:delete',
    'reports:read',
    'ai:use_summary', 'ai:use_extraction',
    'import:read',
  ]), // 23

  PARCEIRO: new Set<Permission>([
    // Row-level filter aplicado no service — só vê o próprio escopo.
    'company:read',
    'contact:read',
    'opportunity:read',
    'document:upload', 'document:read',
  ]), // 5
};

/**
 * Verifica se um role tem a permission por default (sem considerar
 * overrides individuais). Uso: UI condicional (esconder botões),
 * checks síncronos em componentes React.
 *
 * Backend deve preferir `hasPermission(userId, perm)` async pra
 * considerar overrides.
 */
export function hasPermissionByRole(
  role: UserRole | null | undefined,
  permission: Permission,
): boolean {
  if (!role) return false;
  const defaults = ROLE_DEFAULT_PERMISSIONS[role];
  return defaults ? defaults.has(permission) : false;
}

/**
 * Estrutura do cache retornado por `computeUserPermissions` — separada
 * pra evitar dependência circular com o Prisma client em tempo de teste.
 * Os métodos que tocam Prisma vivem em `permissions.service.ts`.
 */
export interface UserPermissionsInput {
  role: UserRole;
  overrides: Array<{ permission: string; action: 'granted' | 'revoked' }>;
}

/**
 * Puro — computa permissions efetivas a partir de role + overrides.
 * Regra: (defaults do role) ∪ (granted) − (revoked).
 * Precedência: revoked > granted > default.
 *
 * Usado por `permissions.service.ts` (async, com Prisma) e por testes
 * unitários (sem Prisma).
 */
export function computeEffectivePermissions(input: UserPermissionsInput): Set<Permission> {
  const defaults = ROLE_DEFAULT_PERMISSIONS[input.role];
  const revoked = new Set(
    input.overrides
      .filter((o) => o.action === 'revoked')
      .map((o) => o.permission)
      .filter((p): p is Permission => PERMISSION_KEYS.has(p as Permission)),
  );
  const granted = new Set(
    input.overrides
      .filter((o) => o.action === 'granted')
      .map((o) => o.permission)
      .filter((p): p is Permission => PERMISSION_KEYS.has(p as Permission)),
  );

  const effective = new Set<Permission>();
  defaults.forEach((p) => {
    if (!revoked.has(p)) effective.add(p);
  });
  granted.forEach((p) => {
    if (!revoked.has(p)) effective.add(p);
  });
  return effective;
}

// =====================================================================
// API LEGADA — mantida durante refactor Sprint 15E → Sprint 15G
// =====================================================================

/**
 * @deprecated Sprint 15E introduziu `PERMISSIONS_CATALOG` + `hasPermission`
 * async. Novo código usa `withPermission(...)` em vez de `withCapability(...)`.
 * ACTIONS + ROLE_CAPABILITIES seguem alinhados apenas pras keys que também
 * existem no catálogo novo, exceto por alguns aliases legados abaixo:
 *
 *   - `opportunity:assign`, `opportunity:set_inbound_owner` (Sprint 15D)
 *     → mapeiam pra `inbound:assign_prospects` no catálogo novo
 *   - `ai:configure` (Sprint 15F v1)
 *     → mapeia pra `ai:configure_global` OR `ai:configure_feature`
 *   - `inbound:view_queue`, `inbound:configure` (Sprint 15D)
 *     → keys idênticas nos dois
 */
export const ACTIONS = {
  tenant: ['read', 'update'] as const,
  user: ['create', 'read', 'update', 'delete'] as const,
  catalog: ['create', 'read', 'update', 'delete'] as const,
  company: ['create', 'read', 'update', 'delete'] as const,
  contact: ['create', 'read', 'update', 'delete'] as const,
  opportunity: [
    'create', 'read', 'update', 'delete', 'advance_stage', 'cancel',
    'assign', 'set_inbound_owner',
  ] as const,
  proposal: ['create', 'read', 'update', 'approve'] as const,
  contract: ['create', 'read', 'update'] as const,
  partner: ['invite', 'approve_engagement'] as const,
  ai: ['use_summary', 'configure'] as const,
  alert: ['configure'] as const,
  audit: ['read'] as const,
  inbound: ['view_queue', 'configure'] as const,
} as const;

type ActionMap = typeof ACTIONS;
type Resource = keyof ActionMap;
type ActionOf<R extends Resource> = ActionMap[R][number];

type LegacyPermissionKey = `${Resource}:${string}`;

/**
 * Mapa role → set de capabilities no formato legado `resource:action`.
 * Alinhado com `ROLE_DEFAULT_PERMISSIONS` — as capabilities extras (assign,
 * set_inbound_owner, ai:configure) são adicionadas explicitamente pros roles
 * que as tinham antes do Sprint 15E.
 */
const ROLE_CAPABILITIES: Record<UserRole, Set<LegacyPermissionKey>> = {
  ADMIN: new Set<LegacyPermissionKey>([
    'tenant:read', 'tenant:update',
    'user:create', 'user:read', 'user:update', 'user:delete',
    'catalog:create', 'catalog:read', 'catalog:update', 'catalog:delete',
    'company:create', 'company:read', 'company:update', 'company:delete',
    'contact:create', 'contact:read', 'contact:update', 'contact:delete',
    'opportunity:create', 'opportunity:read', 'opportunity:update', 'opportunity:delete',
    'opportunity:advance_stage', 'opportunity:cancel',
    'opportunity:assign', 'opportunity:set_inbound_owner',
    'proposal:create', 'proposal:read', 'proposal:update', 'proposal:approve',
    'contract:create', 'contract:read', 'contract:update',
    'partner:invite', 'partner:approve_engagement',
    'ai:use_summary', 'ai:configure',
    'alert:configure',
    'audit:read',
    'inbound:view_queue', 'inbound:configure',
  ]),

  DIRETOR_COMERCIAL: new Set<LegacyPermissionKey>([
    'tenant:read',
    'user:read',
    'catalog:read',
    'company:read', 'company:update',
    'contact:read', 'contact:update',
    'opportunity:create', 'opportunity:read', 'opportunity:update',
    'opportunity:advance_stage', 'opportunity:cancel',
    'opportunity:assign', 'opportunity:set_inbound_owner',
    'proposal:create', 'proposal:read', 'proposal:update', 'proposal:approve',
    'contract:create', 'contract:read', 'contract:update',
    'partner:invite', 'partner:approve_engagement',
    'ai:use_summary',
    'audit:read',
    'inbound:view_queue',
  ]),

  DIRETOR_OPERACOES: new Set<LegacyPermissionKey>([
    'tenant:read',
    'user:read',
    'catalog:read',
    'company:read', 'company:update',
    'contact:read', 'contact:update',
    'opportunity:read',
    'proposal:read',
    'contract:create', 'contract:read', 'contract:update',
    'partner:invite', 'partner:approve_engagement',
    'ai:use_summary',
    'audit:read',
  ]),

  DIRETOR_FINANCEIRO: new Set<LegacyPermissionKey>([
    'tenant:read',
    'company:read',
    'contact:read',
    'opportunity:read',
    'proposal:read', 'proposal:approve',
    'contract:read',
    'audit:read',
  ]),

  GESTOR: new Set<LegacyPermissionKey>([
    'company:create', 'company:read', 'company:update',
    'contact:create', 'contact:read', 'contact:update',
    'opportunity:create', 'opportunity:read', 'opportunity:update',
    'opportunity:advance_stage', 'opportunity:cancel',
    'proposal:create', 'proposal:read', 'proposal:update',
    'contract:read',
    'partner:invite', 'partner:approve_engagement',
    'ai:use_summary',
  ]),

  ANALISTA: new Set<LegacyPermissionKey>([
    'company:create', 'company:read', 'company:update',
    'contact:create', 'contact:read', 'contact:update',
    'opportunity:create', 'opportunity:read', 'opportunity:update',
    'proposal:create', 'proposal:read', 'proposal:update',
    'contract:read',
    'ai:use_summary',
  ]),

  PARCEIRO: new Set<LegacyPermissionKey>([
    'company:read',
    'contact:read',
    'opportunity:read',
    'proposal:read',
  ]),
};

/**
 * @deprecated Uso interno do `withCapability` legado. Novos procedures
 * devem usar `hasPermission(userId, permission)` async.
 */
export function hasCapability<R extends Resource>(
  role: UserRole | null | undefined,
  resource: R,
  action: ActionOf<R>,
): boolean {
  if (!role) return false;
  const perm = `${resource}:${action}` as LegacyPermissionKey;
  const set = ROLE_CAPABILITIES[role];
  return set ? set.has(perm) : false;
}

/**
 * @deprecated Uso interno das services que ainda não migraram.
 * Novos código lançam `TRPCError({code:'FORBIDDEN'})` diretamente via
 * `withPermission`.
 */
export function requireCapability<R extends Resource>(
  role: UserRole | null | undefined,
  resource: R,
  action: ActionOf<R>,
): void {
  if (!hasCapability(role, resource, action)) {
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
