/**
 * Fixtures compartilhadas — Sprint 15E RBAC Granular.
 *
 * Uso: importar apenas dentro de `it` / `beforeEach` para que fixtures não
 * carreguem código de produção em módulo scope (Sprint 15E ainda não
 * fechou; imports estáticos quebrariam type-check).
 *
 * Padrão: cada helper devolve dados puros — não toca Prisma nem tRPC.
 * Cada teste faz mock explícito de `@/server/db/client` e usa estas
 * factories pra popular respostas mockadas.
 */

import type { UserRole } from '@prisma/client';

// ---- Constants ----------------------------------------------------------

export const TENANT_A = 'tenant-A';
export const TENANT_B = 'tenant-B';

export const USER_IDS = {
  admin: 'user-admin-1',
  diretorC: 'user-dc-1',
  diretorO: 'user-do-1',
  diretorF: 'user-df-1',
  gestor: 'user-gestor-1',
  analista: 'user-analista-1',
  parceiro: 'user-parceiro-1',
  platformOwner: 'user-platform-1',
  crossTenant: 'user-crosstenant-1',
} as const;

export const OPP_IDS = {
  mineOwned: 'opp-own-1',           // ownerId = analista
  othersOwned: 'opp-others-1',      // ownerId = gestor
  crossTenant: 'opp-cross-1',       // tenantId = TENANT_B
  softDeleted: 'opp-deleted-1',
} as const;

/**
 * Contagens esperadas por role (Sprint 15E — permission-matrix.md validated).
 * Fonte da verdade: docs/permission-matrix.md §Contagens por role.
 */
export const EXPECTED_ROLE_COUNTS: Record<UserRole, number> = {
  ADMIN: 60,
  DIRETOR_COMERCIAL: 39,
  DIRETOR_OPERACOES: 25,
  DIRETOR_FINANCEIRO: 18,
  GESTOR: 31,
  ANALISTA: 23,
  PARCEIRO: 5,
};

/**
 * Total esperado no catálogo (permission-matrix §Contagens: "Total permissions
 * distintas: 65").
 */
export const EXPECTED_CATALOG_SIZE = 65;

/**
 * Categorias esperadas do catálogo (Sprint 15E §4.1).
 */
export const EXPECTED_CATEGORIES = new Set([
  'tenant', 'users', 'catalog',
  'companies', 'contacts', 'opportunities', 'proposals',
  'contracts', 'documents', 'tasks', 'partners',
  'inbound', 'reports', 'ai', 'alerts', 'audit', 'import',
]);

// ---- User factories -----------------------------------------------------

export interface FixtureUser {
  id: string;
  tenantId: string | null;
  role: UserRole;
  platformRole: 'PLATFORM_OWNER' | 'PLATFORM_SUPPORT' | null;
  active: boolean;
  deletedAt: Date | null;
  cachedPermissions: string[] | null;
  fullName: string;
  email: string;
}

export function makeUser(overrides: Partial<FixtureUser> = {}): FixtureUser {
  return {
    id: overrides.id ?? USER_IDS.analista,
    tenantId: overrides.tenantId ?? TENANT_A,
    role: overrides.role ?? ('ANALISTA' as UserRole),
    platformRole: overrides.platformRole ?? null,
    active: overrides.active ?? true,
    deletedAt: overrides.deletedAt ?? null,
    cachedPermissions: overrides.cachedPermissions === undefined
      ? null
      : overrides.cachedPermissions,
    fullName: overrides.fullName ?? 'Maria Silva',
    email: overrides.email ?? 'maria@empresa.com',
  };
}

export function makeAdmin(overrides: Partial<FixtureUser> = {}): FixtureUser {
  return makeUser({
    id: USER_IDS.admin,
    role: 'ADMIN' as UserRole,
    fullName: 'Fred Marquezini',
    email: 'fred@empresa.com',
    ...overrides,
  });
}

export function makePlatformOwner(overrides: Partial<FixtureUser> = {}): FixtureUser {
  return makeUser({
    id: USER_IDS.platformOwner,
    tenantId: null,
    role: 'ADMIN' as UserRole,
    platformRole: 'PLATFORM_OWNER',
    fullName: 'Platform Owner',
    email: 'owner@venzo.io',
    ...overrides,
  });
}

// ---- Permission override factory ---------------------------------------

export interface FixturePermissionOverride {
  id: string;
  userId: string;
  tenantId: string;
  permission: string;
  action: 'granted' | 'revoked';
  grantedBy: string | null;
  grantedAt: Date;
  reason: string | null;
}

export function makeOverride(
  overrides: Partial<FixturePermissionOverride> = {},
): FixturePermissionOverride {
  return {
    id: overrides.id ?? 'override-1',
    userId: overrides.userId ?? USER_IDS.analista,
    tenantId: overrides.tenantId ?? TENANT_A,
    permission: overrides.permission ?? 'inbound:view_queue',
    action: overrides.action ?? 'granted',
    grantedBy: overrides.grantedBy ?? USER_IDS.admin,
    grantedAt: overrides.grantedAt ?? new Date('2026-07-01T00:00:00.000Z'),
    reason: overrides.reason ?? null,
  };
}

// ---- tRPC context factory ----------------------------------------------

export interface FixtureCtx {
  req: Request;
  tenantId: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
    tenantId: string;
    partnerCompanyId: string | null;
  };
  platformUser: FixtureUser | null;
  platformRole: 'PLATFORM_OWNER' | 'PLATFORM_SUPPORT' | null;
  ip: string;
  userAgent: string;
}

export function makeCtx(overrides: Partial<{
  tenantId: string;
  userId: string;
  role: UserRole;
  platformRole: 'PLATFORM_OWNER' | 'PLATFORM_SUPPORT' | null;
  email: string;
  fullName: string;
}> = {}): FixtureCtx {
  const tenantId = overrides.tenantId ?? TENANT_A;
  const userId = overrides.userId ?? USER_IDS.analista;
  const role = overrides.role ?? ('ANALISTA' as UserRole);
  return {
    req: new Request('http://localhost/test'),
    tenantId,
    user: {
      id: userId,
      email: overrides.email ?? 'analista@empresa.com',
      fullName: overrides.fullName ?? 'Analista Teste',
      role,
      tenantId,
      partnerCompanyId: null,
    },
    platformUser: overrides.platformRole === 'PLATFORM_OWNER' ? makePlatformOwner() : null,
    platformRole: overrides.platformRole ?? null,
    ip: '127.0.0.1',
    userAgent: 'test-agent',
  };
}

// ---- Opportunity factory ------------------------------------------------

export interface FixtureOpp {
  id: string;
  tenantId: string;
  ownerId: string;
  title: string;
  stage: string;
  status: string;
  deletedAt: Date | null;
  estimatedValue: number | null;
  createdAt: Date;
}

export function makeOpp(overrides: Partial<FixtureOpp> = {}): FixtureOpp {
  return {
    id: overrides.id ?? OPP_IDS.mineOwned,
    tenantId: overrides.tenantId ?? TENANT_A,
    ownerId: overrides.ownerId ?? USER_IDS.analista,
    title: overrides.title ?? 'Distribuidora Alfa — SaaS Q4',
    stage: overrides.stage ?? 'LEAD',
    status: overrides.status ?? 'ACTIVE',
    deletedAt: overrides.deletedAt ?? null,
    estimatedValue: overrides.estimatedValue ?? 50_000,
    createdAt: overrides.createdAt ?? new Date('2026-06-15T00:00:00.000Z'),
  };
}

// ---- Common permission sets --------------------------------------------

/**
 * Permissions default do ANALISTA — Sprint 15E permission-matrix.md.
 * 23 permissions. Nota: NÃO inclui `opportunity:read_others` (AC-09 âncora).
 */
export const ANALISTA_DEFAULT_PERMS = [
  'catalog:read',
  'company:create', 'company:read', 'company:update',
  'contact:create', 'contact:read', 'contact:update',
  'opportunity:create', 'opportunity:read', 'opportunity:update',
  'opportunity:advance_stage', 'opportunity:cancel',
  'proposal:read',
  'contract:read',
  'document:upload', 'document:read',
  'task:create', 'task:update', 'task:delete',
  'reports:read',
  'ai:use_summary', 'ai:use_extraction',
] as const;

/**
 * Permissions default do PARCEIRO — 5 permissions.
 * Cenário-âncora do bug de loop de recompute quando todas viram revoked (AC-06).
 */
export const PARCEIRO_DEFAULT_PERMS = [
  'company:read',
  'contact:read',
  'opportunity:read',
  'document:upload',
  'document:read',
] as const;

/**
 * Amostra de 10 procedures representativas pra smoke test 403/200 (AC-08).
 * Cada tupla: [router.procedure, permission esperada].
 */
export const SMOKE_PROCEDURES: ReadonlyArray<readonly [string, string]> = [
  ['companies.create', 'company:create'],
  ['contacts.update', 'contact:update'],
  ['opportunities.advanceStage', 'opportunity:advance_stage'],
  ['proposals.approve', 'proposal:approve'],
  ['documents.upload', 'document:upload'],
  ['tasks.create', 'task:create'],
  ['inbound.assignInbound', 'inbound:assign_prospects'],
  ['aiConfig.testKey', 'ai:test_key'],
  ['aiConfig.clearCircuitBreaker', 'ai:manage_breaker'],
  ['reports.export', 'reports:export'],
] as const;
