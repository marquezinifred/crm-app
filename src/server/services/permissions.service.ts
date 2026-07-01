import { prisma } from '@/server/db/client';
import {
  computeEffectivePermissions,
  ROLE_DEFAULT_PERMISSIONS,
} from '@/lib/auth/rbac';
import type { Permission } from '@/lib/auth/permissions-catalog';
import { runAsSystem } from '@/server/db/tenant-context';

/**
 * Sprint 15E — resolução async de permission efetiva.
 *
 * Fluxo:
 *   1. Load do user (role, platformRole, cachedPermissions, cachedPermissionsAt, deletedAt, active)
 *   2. Platform Owner → bypass total (true pra qualquer permission)
 *   3. Cache hit (`cachedPermissionsAt !== null`) → checa array in-memory
 *   4. Cache miss (`cachedPermissionsAt === null`) → computa + persiste
 *
 * CRÍTICO §6.6 spec — Prisma não suporta `String[]?`, então usamos DUAS
 * colunas pra representar a semântica:
 *   - `cachedPermissions text[]` (nunca null; default `{}`)
 *   - `cachedPermissionsAt timestamptz?` (null = não computado)
 * A distinção evita loop de recompute pra PARCEIRO com todas defaults revogadas.
 */
export async function hasPermission(
  userId: string,
  permission: Permission,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      platformRole: true,
      cachedPermissions: true,
      cachedPermissionsAt: true,
      deletedAt: true,
      active: true,
    },
  });
  if (!user || user.deletedAt || !user.active) return false;

  // Platform Owner (Sprint 15A) — bypass total pra debug/recovery cross-tenant.
  if (user.platformRole === 'PLATFORM_OWNER') return true;

  // Cache hit — `cachedPermissionsAt !== null` significa que já computamos
  // (mesmo que o resultado tenha sido array vazio pra PARCEIRO revogado).
  if (user.cachedPermissionsAt !== null) {
    return user.cachedPermissions.includes(permission);
  }

  // Cache miss — computa e popula
  const effective = await computeAndCacheUserPermissions(userId);
  return effective.has(permission);
}

/**
 * Recomputa permissions efetivas + persiste no cache.
 * Chamado por:
 *   - `hasPermission` no cache miss
 *   - `permissions.grant/revoke/restore` após mutação
 *   - `users.updateRole` após mudar role
 *   - `scripts/rbac-backfill-cache.ts` no rollout
 *
 * Retorna Set pra facilitar consumo interno; persiste como array no DB.
 * Usa `runAsSystem` porque pode ser chamado fora de contexto tRPC
 * (worker, script backfill) — não depende de AsyncLocalStorage do tenant.
 */
export async function computeAndCacheUserPermissions(
  userId: string,
): Promise<Set<Permission>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      permissionOverrides: {
        select: { permission: true, action: true },
      },
    },
  });
  if (!user) return new Set();

  const effective = computeEffectivePermissions({
    role: user.role,
    overrides: user.permissionOverrides.map((o) => ({
      permission: o.permission,
      action: o.action as 'granted' | 'revoked',
    })),
  });

  await runAsSystem(() =>
    prisma.user.update({
      where: { id: userId },
      data: {
        cachedPermissions: Array.from(effective),
        cachedPermissionsAt: new Date(),
      },
    }),
  );

  return effective;
}

/**
 * Invalida cache. Zera `cachedPermissionsAt` (não `cachedPermissions`) —
 * a distinção preserva a semântica "não computado" vs "computado vazio".
 * Ver §6.6 spec.
 */
export async function invalidateUserPermissionsCache(userId: string): Promise<void> {
  await runAsSystem(() =>
    prisma.user.update({
      where: { id: userId },
      data: {
        cachedPermissions: [],
        cachedPermissionsAt: null,
      },
    }),
  );
}

/**
 * Snapshot puro do que seriam as defaults do role — usado pelo router
 * `permissions.forUser` na UI. Não toca DB.
 */
export function defaultsForRole(role: keyof typeof ROLE_DEFAULT_PERMISSIONS): Permission[] {
  return Array.from(ROLE_DEFAULT_PERMISSIONS[role]);
}
