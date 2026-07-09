/**
 * Sprint 15G Fase 1b — Migration A2: backfill de permission overrides.
 *
 * Objetivo: usuários que tinham override individual explícito de
 * `opportunity:read_others` (granted) preservam a intenção migrando pra
 * `opportunity:read_team` (visão da equipe gerenciada — semanticamente
 * mais próxima do que era o read_others no Sprint 15E). Overrides
 * revoked de `read_others` (raros) são simplesmente removidos porque
 * a permission alvo deixou de existir.
 *
 * Fluxo idempotente:
 *   1. SELECT overrides granted de `opportunity:read_others` (por tenant)
 *   2. Pra cada userId: UPSERT `opportunity:read_team` granted (ON CONFLICT DO NOTHING)
 *   3. DELETE todos os overrides de `opportunity:read_others` (granted + revoked)
 *   4. UPDATE users afetados: cached_permissions_at = NULL (força recompute)
 *   5. Grava audit por tenant com metadata {userIds, migrated_count, removed_count}
 *
 * Idempotência: re-execução após primeira passagem encontra zero
 * overrides de read_others (foram deletados) → loga "nada a migrar"
 * e não faz mutations.
 *
 * ⚠️ Roda como sistema (Prisma direto), sem passar por withPermission.
 * Audit log preserva rastreabilidade cross-tenant via tenantIdOverride.
 *
 * Uso:
 *   npx tsx scripts/15g-migrate-permissions.ts
 *   npm run 15g:migrate-permissions
 *
 * ⚠️ IMPORTANTE: quando `RBAC_GRANULAR_ENABLED=false`, o cache/overrides
 * ficam persistidos mas o runtime path legado ignora ambos. Rollout
 * padrão: migrate → backfill-cache → religar flag.
 */

import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { audit } from '@/server/services/audit.service';

export const LEGACY_PERMISSION = 'opportunity:read_others';
export const TARGET_PERMISSION = 'opportunity:read_team';

export interface MigrationSummary {
  legacyGrantedCount: number;
  legacyRevokedCount: number;
  insertedCount: number;
  deletedCount: number;
  affectedUserCount: number;
  auditedTenantCount: number;
}

export async function migrate15gPermissions(): Promise<MigrationSummary> {
  const start = Date.now();
  console.log('[15g-migrate] iniciando migração de permissions read_others → read_team...');

  const legacyOverrides = await prisma.userPermissionOverride.findMany({
    where: { permission: LEGACY_PERMISSION, action: 'granted' },
    select: {
      id: true,
      userId: true,
      tenantId: true,
      grantedBy: true,
      reason: true,
    },
  });

  const revokedOverrides = await prisma.userPermissionOverride.findMany({
    where: { permission: LEGACY_PERMISSION, action: 'revoked' },
    select: { id: true, userId: true, tenantId: true },
  });

  const totalLegacy = legacyOverrides.length + revokedOverrides.length;
  if (totalLegacy === 0) {
    console.log('[15g-migrate] nada a migrar (zero overrides de opportunity:read_others).');
    return {
      legacyGrantedCount: 0,
      legacyRevokedCount: 0,
      insertedCount: 0,
      deletedCount: 0,
      affectedUserCount: 0,
      auditedTenantCount: 0,
    };
  }

  console.log(
    `[15g-migrate] encontrados ${legacyOverrides.length} granted + ${revokedOverrides.length} revoked = ${totalLegacy} overrides.`,
  );

  const affectedUserIds = new Set<string>();
  let insertedCount = 0;

  for (const o of legacyOverrides) {
    const upserted = await prisma.userPermissionOverride.upsert({
      where: { user_permission_unique: { userId: o.userId, permission: TARGET_PERMISSION } },
      update: {},
      create: {
        userId: o.userId,
        tenantId: o.tenantId,
        permission: TARGET_PERMISSION,
        action: 'granted',
        grantedBy: o.grantedBy,
        reason: o.reason
          ? `[15G migration] ${o.reason}`
          : '[15G migration] migrado de opportunity:read_others',
      },
    });
    if (upserted.reason?.startsWith('[15G migration]')) {
      insertedCount++;
    }
    affectedUserIds.add(o.userId);
  }

  for (const o of revokedOverrides) {
    affectedUserIds.add(o.userId);
  }

  const deleted = await prisma.userPermissionOverride.deleteMany({
    where: { permission: LEGACY_PERMISSION },
  });

  if (affectedUserIds.size > 0) {
    await prisma.user.updateMany({
      where: { id: { in: Array.from(affectedUserIds) } },
      data: { cachedPermissionsAt: null },
    });
  }

  const usersByTenant = new Map<string, string[]>();
  for (const o of [...legacyOverrides, ...revokedOverrides]) {
    const list = usersByTenant.get(o.tenantId) ?? [];
    list.push(o.userId);
    usersByTenant.set(o.tenantId, list);
  }

  for (const [tenantId, userIds] of usersByTenant.entries()) {
    const uniqueUserIds = Array.from(new Set(userIds));
    await audit({
      action: 'sales_structure.migration_backfill_read_others_to_read_team',
      tableName: 'user_permission_overrides',
      recordId: `15g-fase1b-${tenantId}`,
      tenantIdOverride: tenantId,
      after: {
        userIds: uniqueUserIds,
        migrated_count: uniqueUserIds.length,
        legacy_permission: LEGACY_PERMISSION,
        target_permission: TARGET_PERMISSION,
      },
    });
  }

  const durationMs = Date.now() - start;
  console.log(
    `[15g-migrate] concluído em ${(durationMs / 1000).toFixed(1)}s — ` +
      `${insertedCount} inseridos / ${deleted.count} deletados / ` +
      `${affectedUserIds.size} caches invalidados / ${usersByTenant.size} tenants auditados.`,
  );

  return {
    legacyGrantedCount: legacyOverrides.length,
    legacyRevokedCount: revokedOverrides.length,
    insertedCount,
    deletedCount: deleted.count,
    affectedUserCount: affectedUserIds.size,
    auditedTenantCount: usersByTenant.size,
  };
}

const invokedAsScript =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  /15g-migrate-permissions\.[tj]s$/.test(process.argv[1]);

if (invokedAsScript) {
  // P-79 (2026-07-08) — extension em src/server/db/client.ts agora é
  // fail-closed em test E dev. Wrap em runAsSystem() bypassa
  // legítimamente a injeção de tenant (script cross-tenant por design).
  runAsSystem(migrate15gPermissions)
    .catch((err) => {
      console.error('[15g-migrate] erro fatal:', err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
