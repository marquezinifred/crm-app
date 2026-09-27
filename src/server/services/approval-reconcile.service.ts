import type { UserRole } from '@prisma/client';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { hasPermission } from '@/server/services/permissions.service';
import { sendPushToUser } from '@/server/services/push-sender.service';
import type { Permission } from '@/lib/auth/permissions-catalog';
import { env } from '@/lib/env';

/**
 * Sprint 15H Bloco A — Reconcile de Approvals (P-77).
 *
 * Approvals persistem `approverId` fixo no momento da criação. Quando a
 * role/rule/user muda, a approval fica "órfã": o novo approver correto não
 * a vê em /approvals e o antigo pode vê-la. Este service detecta essas
 * approvals e as marca `status='ORPHANED'` (Caminho A1 da spec §3.1 — worker
 * daily reconcile).
 *
 * A detecção é uma função PURA (`evaluateApprovalOrphan`) testável sem banco.
 * O orquestrador (`reconcileApprovalsForTenant`) faz a query + resolve a
 * permission via `hasPermission` + persiste + audita + notifica.
 *
 * ⚠️ Desvio consciente da spec §3.3 — `applicableRuleId IS NULL`:
 * a spec literal orfana quando `applicableRule` é null (reason 'rule_deleted').
 * MAS approvals legadas (anteriores ao 0034) têm `applicableRuleId = NULL`
 * porque não há backfill confiável (spec §3.2 autoriza deixar NULL). Orfanar
 * todas elas seria um incidente. Aqui `applicableRuleId == null` → PULA
 * (fail-safe: nunca orfana approval sem snapshot). "Rule deletada" é detectada
 * pelo `deletedAt`/`enabled` da rule carregada (rules usam soft delete, o id
 * sobrevive à remoção).
 */

export type OrphanReason =
  | 'approver_inactive'
  | 'rule_deleted'
  | 'rule_disabled'
  | 'approver_role_no_longer_matches_rule'
  | 'approver_permission_revoked';

export interface ApprovalOrphanInput {
  approver: { active: boolean; deletedAt: Date | null; role: UserRole };
  /** NULL = sem snapshot da rule (approval legada) → não reconciliável. */
  applicableRuleId: string | null;
  /**
   * A rule referida por applicableRuleId, se carregada. NULL quando
   * applicableRuleId é null OU (raro) o hard delete SET NULL já rodou.
   */
  rule: {
    deletedAt: Date | null;
    enabled: boolean;
    approverRoles: UserRole[];
    approverPermission: string | null;
  } | null;
  /**
   * Resultado de `hasPermission(approver, rule.approverPermission)` quando a
   * rule é permission-based; `null` quando a rule não usa permission (só role).
   */
  approverHasPermission: boolean | null;
}

export interface OrphanVerdict {
  shouldOrphan: boolean;
  reason: OrphanReason | null;
}

/**
 * Função pura: decide se uma approval PENDING virou órfã. Não toca em banco.
 *
 * Ordem de precedência (primeiro match vence). Desvia da ordem literal da
 * spec §3.3 (que checa inativo por último): aqui inativo vem primeiro porque
 * é a condição mais fundamental — um approver inativo não aprova NADA,
 * independentemente da rule. O `shouldOrphan` final é o mesmo; só o rótulo do
 * `reason` muda quando várias condições coincidem.
 */
export function evaluateApprovalOrphan(input: ApprovalOrphanInput): OrphanVerdict {
  const { approver, applicableRuleId, rule, approverHasPermission } = input;

  // 1. Approver não pode mais aprovar nada (desativado ou removido).
  if (!approver.active || approver.deletedAt) {
    return { shouldOrphan: true, reason: 'approver_inactive' };
  }

  // 2. Sem snapshot da rule → não dá pra reconciliar com segurança → NÃO órfã.
  if (applicableRuleId == null) {
    return { shouldOrphan: false, reason: null };
  }

  // 3. Rule sumiu (hard delete → SET NULL, raro) ou foi soft-deletada.
  if (rule == null || rule.deletedAt) {
    return { shouldOrphan: true, reason: 'rule_deleted' };
  }

  // 4. Rule desabilitada (enabled=false) — o critério não vale mais.
  if (!rule.enabled) {
    return { shouldOrphan: true, reason: 'rule_disabled' };
  }

  // 5. Rule role-based: approver não tem mais o role exigido.
  if (rule.approverRoles.length > 0 && !rule.approverRoles.includes(approver.role)) {
    return { shouldOrphan: true, reason: 'approver_role_no_longer_matches_rule' };
  }

  // 6. Rule permission-based: approver perdeu a permission.
  if (rule.approverPermission && approverHasPermission === false) {
    return { shouldOrphan: true, reason: 'approver_permission_revoked' };
  }

  return { shouldOrphan: false, reason: null };
}

/**
 * Sprint 15H Bloco A (chip 2a) — inverso puro de `evaluateApprovalOrphan`.
 *
 * Dado um candidato a novo approver (montado como `ApprovalOrphanInput`),
 * decide se ele SATISFAZ o critério da rule da approval órfã — i.e., se
 * reatribuir a approval a esse candidato NÃO produziria imediatamente outra
 * órfã. É a mesma checagem do reconcile, só que negada: reusar a lógica pura
 * garante que "quem o worker não orfanaria" == "para quem o admin pode
 * reatribuir", sem duplicar a matriz de regras (role/permission/enabled).
 *
 * Observações de contrato herdadas de `evaluateApprovalOrphan`:
 *  - candidato inativo/deletado → não satisfaz (nunca aprova nada);
 *  - rule deletada/desabilitada → NINGUÉM satisfaz (o critério não existe
 *    mais; a recurso é rejeitar, fora do escopo do chip 2a);
 *  - `applicableRuleId == null` (sem snapshot) → qualquer candidato ativo
 *    satisfaz (não há critério a violar).
 */
export function approverSatisfiesRule(input: ApprovalOrphanInput): boolean {
  return !evaluateApprovalOrphan(input).shouldOrphan;
}

export interface ReconcileTenantResult {
  tenantId: string;
  /** Approvals novas marcadas ORPHANED nesta execução. */
  orphaned: number;
  /** PENDING puladas por não terem snapshot (applicable_rule_id NULL). */
  skipped: number;
  /** 1 se houve notificação de admin (best-effort), 0 caso contrário. */
  notified: number;
}

/**
 * Notifica os ADMINs ativos do tenant que há novas approvals órfãs.
 * Best-effort (§3.3): nunca propaga rejection — falha de push não impede o
 * reconcile. Retorna true se disparou pelo menos a tentativa.
 */
async function notifyAdminOrphanedApprovals(
  tenantId: string,
  orphanedIds: string[],
): Promise<boolean> {
  try {
    const admins = await prisma.user.findMany({
      where: { tenantId, active: true, deletedAt: null, role: 'ADMIN' },
      select: { id: true },
    });
    if (admins.length === 0) return false;

    const url = `${env.NEXT_PUBLIC_APP_URL}/admin/approvals-orphaned`;
    const payload = {
      title: 'Aprovações órfãs detectadas',
      body:
        `${orphanedIds.length} aprovação(ões) ficaram sem responsável válido ` +
        `e precisam de reatribuição.`,
      url,
    };
    await Promise.allSettled(admins.map((a) => sendPushToUser(a.id, payload)));
    return true;
  } catch (err) {
    console.warn(
      `[approvals-reconcile] notificação de admins falhou (tenant ${tenantId}):`,
      err,
    );
    return false;
  }
}

/**
 * Reconcilia todas as approvals PENDING de UM tenant. Idempotente: a transição
 * usa `updateMany WHERE status=PENDING`, então rodar 2× (ou uma corrida com
 * approve/reject/decisão concorrente) não re-orfana nem re-notifica (count !== 1
 * → pula). Filtro `tenantId` explícito em toda query (RLS como 2ª barreira).
 *
 * Deve rodar dentro de `runAsSystem` (worker) — o cross-tenant é intencional.
 */
export async function reconcileApprovalsForTenant(
  tenantId: string,
): Promise<ReconcileTenantResult> {
  const result: ReconcileTenantResult = {
    tenantId,
    orphaned: 0,
    skipped: 0,
    notified: 0,
  };

  const pending = await prisma.approval.findMany({
    where: { tenantId, status: 'PENDING', deletedAt: null },
    select: {
      id: true,
      approverId: true,
      applicableRuleId: true,
      approver: { select: { active: true, deletedAt: true, role: true } },
      applicableRule: {
        select: {
          deletedAt: true,
          enabled: true,
          approverRoles: true,
          approverPermission: true,
        },
      },
    },
  });

  const orphanedIds: string[] = [];

  for (const app of pending) {
    // Resolve permission só quando a rule é permission-based (evita query extra).
    let approverHasPermission: boolean | null = null;
    if (app.applicableRule?.approverPermission) {
      approverHasPermission = await hasPermission(
        app.approverId,
        app.applicableRule.approverPermission as Permission,
      );
    }

    const verdict = evaluateApprovalOrphan({
      approver: app.approver,
      applicableRuleId: app.applicableRuleId,
      rule: app.applicableRule,
      approverHasPermission,
    });

    if (!verdict.shouldOrphan) {
      if (app.applicableRuleId == null) result.skipped += 1;
      continue;
    }

    // Transição idempotente: só marca se AINDA PENDING (guarda corrida +
    // reprocessamento). tenantId no WHERE (defesa em profundidade).
    const updated = await prisma.approval.updateMany({
      where: { id: app.id, tenantId, status: 'PENDING' },
      data: {
        status: 'ORPHANED',
        orphanedAt: new Date(),
        orphanedReason: verdict.reason,
      },
    });
    if (updated.count !== 1) continue;

    await audit({
      action: 'approval.orphaned',
      tableName: 'approvals',
      recordId: app.id,
      tenantIdOverride: tenantId,
      after: { reason: verdict.reason, previousApproverId: app.approverId },
    });
    result.orphaned += 1;
    orphanedIds.push(app.id);
  }

  if (orphanedIds.length > 0) {
    const notified = await notifyAdminOrphanedApprovals(tenantId, orphanedIds);
    if (notified) result.notified = 1;
  }

  return result;
}
