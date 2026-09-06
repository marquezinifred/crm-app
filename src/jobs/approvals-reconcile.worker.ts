import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { env } from '@/lib/env';
import {
  reconcileApprovalsForTenant,
  type ReconcileTenantResult,
} from '@/server/services/approval-reconcile.service';
import {
  makeWorker,
  QUEUE_NAMES,
  type ApprovalsReconcileJobData,
} from './queues';

/**
 * Sprint 15H Bloco A — Worker de reconcile de approvals órfãs (chip 1a, P-77).
 *
 * Diário 03:00 BRT (padrão Sprint 3). Varre cada tenant ativo e chama
 * `reconcileApprovalsForTenant`, que marca como ORPHANED as approvals PENDING
 * cujo approver não satisfaz mais a rule original (role trocada, permission
 * revogada, rule deletada/desabilitada, approver inativo).
 *
 * Idempotente: a transição usa `updateMany WHERE status=PENDING` no service,
 * então rodar 2× não re-orfana nem re-notifica.
 *
 * Best-effort por tenant (padrão transfer-timeout / alert-generator): falha em
 * 1 tenant loga e segue.
 *
 * Kill-switch (§3.6): `APPROVAL_RECONCILE_ENABLED=false` (default) → no-op
 * total. As approvals ficam intactas e são reconciliadas no próximo tick
 * quando a flag religar.
 *
 * ⚠️ Dependência P-36: este worker só roda de fato quando o processo de
 * workers BullMQ estiver no ar (Railway). Registrado e inerte até lá + flag ON.
 */

/**
 * Entry point testável: itera tenants ativos e reconcilia. No-op quando a
 * flag está OFF (§3.6). Retorna stats por tenant.
 */
export async function reconcileAllTenants(): Promise<ReconcileTenantResult[]> {
  if (!env.APPROVAL_RECONCILE_ENABLED) return [];

  return runAsSystem(async () => {
    const tenants = await prisma.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    const results: ReconcileTenantResult[] = [];
    for (const t of tenants) {
      try {
        results.push(await reconcileApprovalsForTenant(t.id));
      } catch (err) {
        // Best-effort por tenant: loga e segue (não bloqueia os demais).
        console.error(`[approvals-reconcile] tenant ${t.id} falhou:`, err);
      }
    }
    return results;
  });
}

export function startApprovalsReconcileWorker() {
  return makeWorker<ApprovalsReconcileJobData>(
    QUEUE_NAMES.approvalsReconcile,
    async () => {
      const stats = await reconcileAllTenants();
      const orphaned = stats.reduce((s, x) => s + x.orphaned, 0);
      const skipped = stats.reduce((s, x) => s + x.skipped, 0);
      const notified = stats.reduce((s, x) => s + x.notified, 0);
      console.info(
        `[approvals-reconcile] enabled=${env.APPROVAL_RECONCILE_ENABLED} ` +
          `tenants=${stats.length} orphaned=${orphaned} skipped=${skipped} ` +
          `notified=${notified}`,
      );
      return { tenants: stats.length, orphaned, skipped, notified };
    },
  );
}
