import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Sprint 15H chip 1a — Integração do reconcile de approvals órfãs (P-77)
 * contra DB real. Cria approvals nas 4 configurações de órfã + 1 controle
 * PENDING + 1 legada (applicable_rule_id NULL) e roda
 * `reconcileApprovalsForTenant`, verificando que:
 *   - role mismatch / approver inativo / rule soft-deletada / rule desabilitada
 *     → viram ORPHANED com o reason correto
 *   - controle (role bate) permanece PENDING
 *   - legada (sem snapshot) permanece PENDING (skipped — fail-safe)
 *   - approval de OUTRO tenant não é tocada (isolamento)
 *   - audit_logs recebe action='approval.orphaned' por órfã marcada
 *
 * Pulado automaticamente quando DATABASE_URL_TEST não está setada.
 *
 * Como rodar:
 *   DATABASE_URL_TEST=postgresql://crm:crm_test_password@localhost:5432/crm_test \
 *     APPROVAL_RECONCILE_ENABLED=true \
 *     npm run test -- tests/integration/approval-reconcile-worker
 */

const TEST_DB = process.env.DATABASE_URL_TEST;
const describeIfDb = TEST_DB ? describe : describe.skip;

describeIfDb('reconcile de approvals órfãs (integration)', () => {
  let prisma: typeof import('@/server/db/client').prisma;
  let runAsSystem: typeof import('@/server/db/tenant-context').runAsSystem;
  let reconcileApprovalsForTenant: typeof import('@/server/services/approval-reconcile.service').reconcileApprovalsForTenant;

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  let tenantA: string;
  let tenantB: string;

  // ids das approvals sob teste (chaves concretas — evita index type undefined
  // sob noUncheckedIndexedAccess).
  const ids = {} as {
    control: string;
    roleMismatch: string;
    inactive: string;
    ruleDeleted: string;
    ruleDisabled: string;
    legacy: string;
    tenantB: string;
  };

  beforeAll(async () => {
    ({ prisma } = await import('@/server/db/client'));
    ({ runAsSystem } = await import('@/server/db/tenant-context'));
    ({ reconcileApprovalsForTenant } = await import(
      '@/server/services/approval-reconcile.service'
    ));

    await runAsSystem(async () => {
      const tA = await prisma.tenant.create({
        data: { slug: `recon-a-${suffix}`, name: 'Reconcile A' } as never,
      });
      const tB = await prisma.tenant.create({
        data: { slug: `recon-b-${suffix}`, name: 'Reconcile B' } as never,
      });
      tenantA = tA.id;
      tenantB = tB.id;

      // Cadeia mínima em A: company → opportunity → proposal → proposalVersion.
      const company = await prisma.company.create({
        data: { tenantId: tenantA, type: 'CLIENT', razaoSocial: 'ACME LTDA' } as never,
      });
      const opp = await prisma.opportunity.create({
        data: { tenantId: tenantA, title: 'Deal', clientCompanyId: company.id } as never,
      });
      const proposal = await prisma.proposal.create({
        data: { tenantId: tenantA, opportunityId: opp.id, title: 'Proposta' } as never,
      });
      const version = await prisma.proposalVersion.create({
        data: {
          tenantId: tenantA,
          proposalId: proposal.id,
          version: 1,
          contentJson: {},
          totalValue: 1000,
        } as never,
      });

      // Rules: uma ativa (role DIRETOR_COMERCIAL) + uma soft-deletada + uma desabilitada.
      const ruleActive = await prisma.approvalRule.create({
        data: {
          tenantId: tenantA,
          name: 'Universal DC',
          criteria: 'UNIVERSAL',
          approverRoles: ['DIRETOR_COMERCIAL'],
        } as never,
      });
      const ruleDeleted = await prisma.approvalRule.create({
        data: {
          tenantId: tenantA,
          name: 'Deletada',
          criteria: 'UNIVERSAL',
          approverRoles: ['DIRETOR_COMERCIAL'],
          deletedAt: new Date(),
        } as never,
      });
      const ruleDisabled = await prisma.approvalRule.create({
        data: {
          tenantId: tenantA,
          name: 'Desabilitada',
          criteria: 'UNIVERSAL',
          approverRoles: ['DIRETOR_COMERCIAL'],
          enabled: false,
        } as never,
      });

      // Approvers.
      const mkUser = (role: string, active: boolean, tag: string) =>
        prisma.user.create({
          data: {
            tenantId: tenantA,
            email: `${tag}+${suffix}@recon.test`,
            fullName: `Approver ${tag}`,
            role,
            active,
          } as never,
        });
      const dcActive = await mkUser('DIRETOR_COMERCIAL', true, 'dc');
      const analista = await mkUser('ANALISTA', true, 'an');
      const dcInactive = await mkUser('DIRETOR_COMERCIAL', false, 'inact');

      const mkApproval = (
        approverId: string,
        applicableRuleId: string | null,
      ) =>
        prisma.approval.create({
          data: {
            tenantId: tenantA,
            proposalVersionId: version.id,
            approverId,
            status: 'PENDING',
            applicableRuleId,
          } as never,
        });

      // 1. controle: role bate + rule ativa → permanece PENDING
      ids.control = (await mkApproval(dcActive.id, ruleActive.id)).id;
      // 2. role mismatch → ORPHANED approver_role_no_longer_matches_rule
      ids.roleMismatch = (await mkApproval(analista.id, ruleActive.id)).id;
      // 3. approver inativo → ORPHANED approver_inactive
      ids.inactive = (await mkApproval(dcInactive.id, ruleActive.id)).id;
      // 4. rule soft-deletada → ORPHANED rule_deleted
      ids.ruleDeleted = (await mkApproval(dcActive.id, ruleDeleted.id)).id;
      // 5. rule desabilitada → ORPHANED rule_disabled
      ids.ruleDisabled = (await mkApproval(dcActive.id, ruleDisabled.id)).id;
      // 6. legada sem snapshot → permanece PENDING (skipped)
      ids.legacy = (await mkApproval(dcActive.id, null)).id;

      // Tenant B: uma órfã óbvia que NÃO pode ser tocada por reconcile(A).
      const companyB = await prisma.company.create({
        data: { tenantId: tenantB, type: 'CLIENT', razaoSocial: 'B LTDA' } as never,
      });
      const oppB = await prisma.opportunity.create({
        data: { tenantId: tenantB, title: 'Deal B', clientCompanyId: companyB.id } as never,
      });
      const proposalB = await prisma.proposal.create({
        data: { tenantId: tenantB, opportunityId: oppB.id, title: 'Prop B' } as never,
      });
      const versionB = await prisma.proposalVersion.create({
        data: {
          tenantId: tenantB,
          proposalId: proposalB.id,
          version: 1,
          contentJson: {},
          totalValue: 500,
        } as never,
      });
      const ruleB = await prisma.approvalRule.create({
        data: {
          tenantId: tenantB,
          name: 'B rule',
          criteria: 'UNIVERSAL',
          approverRoles: ['DIRETOR_COMERCIAL'],
        } as never,
      });
      const analistaB = await prisma.user.create({
        data: {
          tenantId: tenantB,
          email: `anb+${suffix}@recon.test`,
          fullName: 'Analista B',
          role: 'ANALISTA',
          active: true,
        } as never,
      });
      ids.tenantB = (
        await prisma.approval.create({
          data: {
            tenantId: tenantB,
            proposalVersionId: versionB.id,
            approverId: analistaB.id,
            status: 'PENDING',
            applicableRuleId: ruleB.id,
          } as never,
        })
      ).id;
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await runAsSystem(async () => {
      // CASCADE de Tenant remove companies/opps/proposals/versions/approvals/
      // rules/users criados.
      await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    });
  });

  it('marca as 4 configs de órfã e preserva controle + legada', async () => {
    const res = await runAsSystem(() => reconcileApprovalsForTenant(tenantA));

    expect(res.orphaned).toBe(4);
    expect(res.skipped).toBe(1);

    const rows = await runAsSystem(() =>
      prisma.approval.findMany({
        where: { id: { in: Object.values(ids) } },
        select: { id: true, status: true, orphanedReason: true, orphanedAt: true },
      }),
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    expect(byId[ids.control]!.status).toBe('PENDING');
    expect(byId[ids.legacy]!.status).toBe('PENDING');

    expect(byId[ids.roleMismatch]!.status).toBe('ORPHANED');
    expect(byId[ids.roleMismatch]!.orphanedReason).toBe('approver_role_no_longer_matches_rule');
    expect(byId[ids.roleMismatch]!.orphanedAt).toBeInstanceOf(Date);

    expect(byId[ids.inactive]!.status).toBe('ORPHANED');
    expect(byId[ids.inactive]!.orphanedReason).toBe('approver_inactive');

    expect(byId[ids.ruleDeleted]!.status).toBe('ORPHANED');
    expect(byId[ids.ruleDeleted]!.orphanedReason).toBe('rule_deleted');

    expect(byId[ids.ruleDisabled]!.status).toBe('ORPHANED');
    expect(byId[ids.ruleDisabled]!.orphanedReason).toBe('rule_disabled');
  });

  it('não toca approvals de outro tenant (isolamento)', async () => {
    // reconcile já rodou pra tenantA no teste anterior; a órfã de B segue PENDING
    const b = await runAsSystem(() =>
      prisma.approval.findFirst({ where: { id: ids.tenantB }, select: { status: true } }),
    );
    expect(b!.status).toBe('PENDING');
  });

  it('idempotente: 2ª execução não gera novas órfãs', async () => {
    const res = await runAsSystem(() => reconcileApprovalsForTenant(tenantA));
    expect(res.orphaned).toBe(0);
    expect(res.skipped).toBe(1); // a legada segue sendo pulada, sem virar órfã
  });

  it('grava audit_logs action=approval.orphaned por órfã marcada', async () => {
    const logs = await runAsSystem(() =>
      prisma.auditLog.findMany({
        where: { tenantId: tenantA, action: 'approval.orphaned' },
        select: { recordId: true },
      }),
    );
    const recordIds = logs.map((l) => l.recordId);
    expect(recordIds).toEqual(
      expect.arrayContaining([ids.roleMismatch, ids.inactive, ids.ruleDeleted, ids.ruleDisabled]),
    );
  });
});
