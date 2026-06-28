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
  approverRoles: UserRole[];
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

  // Coleciona roles únicos a aprovar
  const rolesNeeded = new Set<UserRole>();
  for (const m of matches) for (const r of m.approverRoles) rolesNeeded.add(r);

  for (const role of rolesNeeded) {
    const approver = await prisma.user.findFirst({
      where: { tenantId, role, active: true, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!approver) {
      result.noApproverFor.push(role);
      continue;
    }
    // Idempotência: não duplica Approval para mesmo (proposalVersionId, approver)
    const existing = await prisma.approval.findFirst({
      where: {
        tenantId,
        proposalVersionId,
        approverId: approver.id,
      },
    });
    if (existing) continue;

    await prisma.approval.create({
      data: {
        tenantId,
        proposalVersionId,
        approverId: approver.id,
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
