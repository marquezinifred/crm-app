import { prisma } from '@/server/db/client';
import { ApprovalRuleCriteria, ApprovalStatus, Prisma, UserRole } from '@prisma/client';

/**
 * Approval engine (§14.1 do spec).
 *
 * Decide quais ApprovalRules ENABLED do tenant disparam para uma dada
 * proposta (totalValue, marginPct). Para cada regra aplicável, gera 1
 * Approval(status=PENDING) por aprovador necessário, agrupado por role:
 *   - Para cada role em rule.approverRoles, busca o 1º usuário ativo com
 *     esse perfil — esse será o aprovador específico.
 *
 * Critérios:
 *   - UNIVERSAL: sempre dispara
 *   - MIN_MARGIN_BELOW: dispara se proposta.marginPct < threshold
 *   - TOTAL_VALUE_ABOVE: dispara se proposta.totalValue > threshold
 *
 * Uma proposta com 0 regras aplicáveis avança automaticamente — não há
 * Approval criada (= não há nada para bloquear o estágio).
 */

export interface ProposalForApproval {
  totalValue: number;
  marginPct: number | null;
}

export interface RuleMatch {
  ruleId: string;
  ruleName: string;
  criteria: ApprovalRuleCriteria;
  // Sprint 15E — dual approver spec: uma regra tem approverRoles
  // (não-vazio) OU approverPermission (não-null). CHECK XOR em SQL.
  approverRoles: UserRole[];
  approverPermission: string | null;
}

/** Função pura: decide quais regras se aplicam. Não toca em banco. */
export function selectApplicableRules(
  proposal: ProposalForApproval,
  rules: Array<{
    id: string;
    name: string;
    criteria: ApprovalRuleCriteria;
    thresholdNumeric: number | null;
    approverRoles: UserRole[];
    approverPermission: string | null;
    enabled: boolean;
  }>,
): RuleMatch[] {
  return rules
    .filter((r) => r.enabled)
    .filter((r) => {
      if (r.criteria === ApprovalRuleCriteria.UNIVERSAL) return true;
      if (r.criteria === ApprovalRuleCriteria.MIN_MARGIN_BELOW) {
        if (r.thresholdNumeric == null || proposal.marginPct == null) return false;
        return proposal.marginPct < r.thresholdNumeric;
      }
      if (r.criteria === ApprovalRuleCriteria.TOTAL_VALUE_ABOVE) {
        if (r.thresholdNumeric == null) return false;
        return proposal.totalValue > r.thresholdNumeric;
      }
      return false;
    })
    .map((r) => ({
      ruleId: r.id,
      ruleName: r.name,
      criteria: r.criteria,
      approverRoles: r.approverRoles,
      approverPermission: r.approverPermission,
    }));
}

export interface CreateApprovalsResult {
  proposalVersionId: string;
  rulesMatched: number;
  approvalsCreated: number;
  noApproverFor: UserRole[];
}

/**
 * Para uma ProposalVersion recém-criada, dispara as regras aplicáveis e
 * cria as Approvals PENDING. Idempotente: se já houver Approvals para a
 * versão, não duplica.
 */
export async function createApprovalsForProposalVersion(
  tenantId: string,
  proposalVersionId: string,
): Promise<CreateApprovalsResult> {
  const result: CreateApprovalsResult = {
    proposalVersionId,
    rulesMatched: 0,
    approvalsCreated: 0,
    noApproverFor: [],
  };

  const version = await prisma.proposalVersion.findFirst({
    where: { id: proposalVersionId, deletedAt: null },
    select: {
      id: true,
      totalValue: true,
      marginPct: true,
    },
  });
  if (!version) return result;

  const rules = await prisma.approvalRule.findMany({
    where: { tenantId, enabled: true, deletedAt: null },
    select: {
      id: true,
      name: true,
      criteria: true,
      thresholdNumeric: true,
      approverRoles: true,
      approverPermission: true,
      enabled: true,
    },
  });

  const matches = selectApplicableRules(
    {
      totalValue: Number(version.totalValue),
      marginPct: version.marginPct ? Number(version.marginPct) : null,
    },
    rules.map((r) => ({
      ...r,
      thresholdNumeric: r.thresholdNumeric ? Number(r.thresholdNumeric) : null,
    })),
  );
  result.rulesMatched = matches.length;

  // Sprint 15E — cada rule gera aprovadores por 1 de 2 caminhos:
  //   1. approverRoles (legado) — 1 aprovador por role, primeiro user ativo
  //   2. approverPermission (novo) — TODOS os users com cached_permissions
  //      contendo a permission viram aprovadores
  //
  // Rules migradas do Sprint 15D usam approverRoles; rules novas podem
  // apontar direto pra permission (`proposal:approve`) e abranger overrides
  // individuais.
  const approverIds = new Set<string>();

  for (const m of matches) {
    if (m.approverPermission) {
      const users = await prisma.user.findMany({
        where: {
          tenantId,
          active: true,
          deletedAt: null,
          cachedPermissions: { has: m.approverPermission },
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      if (users.length === 0) {
        result.noApproverFor.push(m.approverPermission as UserRole);
      } else {
        for (const u of users) approverIds.add(u.id);
      }
    } else {
      for (const role of m.approverRoles) {
        const approver = await prisma.user.findFirst({
          where: { tenantId, role, active: true, deletedAt: null },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        });
        if (!approver) {
          result.noApproverFor.push(role);
          continue;
        }
        approverIds.add(approver.id);
      }
    }
  }

  for (const approverId of approverIds) {
    // Idempotência: não duplica Approval para mesmo (proposalVersionId, approver)
    const existing = await prisma.approval.findFirst({
      where: {
        tenantId,
        proposalVersionId,
        approverId,
      },
    });
    if (existing) continue;

    await prisma.approval.create({
      data: {
        tenantId,
        proposalVersionId,
        approverId,
        status: ApprovalStatus.PENDING,
      } as Prisma.ApprovalUncheckedCreateInput,
    });
    result.approvalsCreated += 1;
  }

  return result;
}

/**
 * Estado consolidado das aprovações de UMA ProposalVersion.
 *   - allApproved: todos os PENDING decidiram APPROVED
 *   - hasBlockers: há pelo menos 1 PENDING ou REJECTED ou CHANGES_REQUESTED
 *   - noRulesApply: zero approvals (= regras não dispararam)
 */
export interface ApprovalState {
  total: number;
  approved: number;
  rejected: number;
  changesRequested: number;
  pending: number;
  noRulesApply: boolean;
  allApproved: boolean;
  hasBlockers: boolean;
}

export async function getApprovalState(
  proposalVersionId: string,
): Promise<ApprovalState> {
  const rows = await prisma.approval.groupBy({
    by: ['status'],
    where: { proposalVersionId, deletedAt: null },
    _count: { _all: true },
  });
  const by: Record<ApprovalStatus, number> = {
    PENDING: 0,
    APPROVED: 0,
    REJECTED: 0,
    CHANGES_REQUESTED: 0,
  };
  for (const r of rows) by[r.status] = r._count._all;
  const total = by.PENDING + by.APPROVED + by.REJECTED + by.CHANGES_REQUESTED;
  return {
    total,
    approved: by.APPROVED,
    rejected: by.REJECTED,
    changesRequested: by.CHANGES_REQUESTED,
    pending: by.PENDING,
    noRulesApply: total === 0,
    allApproved: total > 0 && by.APPROVED === total,
    hasBlockers: by.PENDING + by.REJECTED + by.CHANGES_REQUESTED > 0,
  };
}
