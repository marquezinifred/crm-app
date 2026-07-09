/**
 * Sprint 15E — Backfill do cache de permissions.
 *
 * Executa `computeAndCacheUserPermissions` pra TODOS os users ativos
 * (tenant + platform) do banco. Idempotente — pode re-executar.
 *
 * ⚠️ OBRIGATÓRIO no rollout pós-migration 0030:
 *   1. npx prisma migrate deploy       ← adiciona colunas + backfill overrides
 *   2. npm run rbac:backfill-cache     ← este script
 *   3. Ativar RBAC_GRANULAR_ENABLED=true no ambiente
 *
 * Sem este script rodando, `permissions.whoHas('...')` retorna [] até
 * cada user logar (populando o cache on-demand via `hasPermission`).
 * Bloqueia notificações inbound (worker filtra por cachedPermissions).
 *
 * Performance esperada: ~30s pra 1000 users. Executa serialmente pra
 * evitar spike de conexões no Neon. Se precisar, subir concorrência
 * com Promise.all + chunks.
 *
 * Uso:
 *   npx tsx scripts/rbac-backfill-cache.ts
 *   npm run rbac:backfill-cache            (após adicionar em package.json)
 */

import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { computeAndCacheUserPermissions } from '@/server/services/permissions.service';

async function main() {
  // P-79 (2026-07-08) — extension em src/server/db/client.ts agora é
  // fail-closed em test E dev. Scripts que rodam prisma sem contexto
  // precisam envolver em runAsSystem() pra bypassar injeção legítimamente.
  return runAsSystem(runMain);
}

async function runMain() {
  const start = Date.now();
  console.log('[rbac-backfill] iniciando...');

  const users = await prisma.user.findMany({
    where: { deletedAt: null, active: true },
    select: { id: true, email: true, tenantId: true, role: true },
    orderBy: [{ tenantId: 'asc' }, { createdAt: 'asc' }],
  });

  console.log(`[rbac-backfill] ${users.length} users ativos encontrados`);

  let successCount = 0;
  let failCount = 0;

  for (const u of users) {
    try {
      const perms = await computeAndCacheUserPermissions(u.id);
      successCount++;
      if (successCount % 50 === 0) {
        console.log(
          `[rbac-backfill] processados ${successCount}/${users.length}`,
        );
      }
      if (perms.size === 0) {
        console.warn(
          `[rbac-backfill] ⚠️  ${u.email} (${u.role}) → 0 permissions ` +
            '(role sem defaults? PARCEIRO com todas revogadas? investigar)',
        );
      }
    } catch (err) {
      failCount++;
      console.error(`[rbac-backfill] ❌ ${u.email}:`, err);
    }
  }

  const durationMs = Date.now() - start;
  console.log(
    `[rbac-backfill] concluído em ${(durationMs / 1000).toFixed(1)}s — ` +
      `${successCount} sucesso / ${failCount} falha / ${users.length} total`,
  );

  if (failCount > 0) process.exit(1);
}

main()
  .catch((err) => {
    console.error('[rbac-backfill] erro fatal:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
