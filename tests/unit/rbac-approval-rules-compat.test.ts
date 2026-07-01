// @vitest-environment node
// @ts-nocheck — Sprint 15E ainda não mergeado. Remover junto com describe.skip.
//
// AC-21 — approval_rules.approver_permission alternativa a approver_roles:
//          CHECK constraint XOR (SQL-level, ver rbac-migration-0030),
//          service approval-engine respeita ambos.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TENANT_A, USER_IDS, makeUser } from '../helpers/rbac-fixtures';

const mockUser = { findMany: vi.fn() };
const mockRule = { findMany: vi.fn() };

vi.mock('@/server/db/client', () => ({
  prisma: { user: mockUser, approvalRule: mockRule },
}));

beforeEach(() => vi.clearAllMocks());

describe.skip('AC-21 — approval-engine backward compat com approver_roles', () => {
  it('rule com approver_roles (padrão antigo) resolve via role query', async () => {
    mockRule.findMany.mockResolvedValueOnce([
      {
        id: 'rule-1',
        name: 'DIRETOR_C aprovação universal',
        criteria: 'UNIVERSAL',
        thresholdNumeric: null,
        approverRoles: ['DIRETOR_COMERCIAL'],
        approverPermission: null, // XOR: um ou o outro
        enabled: true,
      },
    ]);
    mockUser.findMany.mockResolvedValueOnce([
      makeUser({ id: USER_IDS.diretorC, role: 'DIRETOR_COMERCIAL' }),
    ]);

    const { createApprovalsForProposalVersion } = await import(
      '@/server/services/approval-engine.service'
    );
    const result = await createApprovalsForProposalVersion({
      tenantId: TENANT_A,
      proposalVersionId: 'pv-1',
      totalValue: 100000,
      marginPct: 20,
    });

    expect(mockUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { in: ['DIRETOR_COMERCIAL'] },
        }),
      }),
    );
    expect(result.approvers.length).toBeGreaterThan(0);
  });
});

describe.skip('AC-21 — approval-engine novo path via approver_permission', () => {
  it('rule com approver_permission resolve via cachedPermissions has', async () => {
    mockRule.findMany.mockResolvedValueOnce([
      {
        id: 'rule-2',
        name: 'Alto valor exige quem tenha proposal:approve',
        criteria: 'TOTAL_VALUE_ABOVE',
        thresholdNumeric: 500_000,
        approverRoles: null,
        approverPermission: 'proposal:approve',
        enabled: true,
      },
    ]);
    mockUser.findMany.mockResolvedValueOnce([
      makeUser({ id: USER_IDS.admin, role: 'ADMIN' }),
      makeUser({ id: USER_IDS.diretorF, role: 'DIRETOR_FINANCEIRO' }),
    ]);

    const { createApprovalsForProposalVersion } = await import(
      '@/server/services/approval-engine.service'
    );
    await createApprovalsForProposalVersion({
      tenantId: TENANT_A,
      proposalVersionId: 'pv-2',
      totalValue: 600_000,
      marginPct: 15,
    });

    expect(mockUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cachedPermissions: { has: 'proposal:approve' },
        }),
      }),
    );
  });

  it('rule com approver_permission inclui filtros tenantId + active + not deleted', async () => {
    mockRule.findMany.mockResolvedValueOnce([
      {
        id: 'rule-3',
        name: 'x',
        criteria: 'UNIVERSAL',
        thresholdNumeric: null,
        approverRoles: null,
        approverPermission: 'proposal:approve',
        enabled: true,
      },
    ]);
    mockUser.findMany.mockResolvedValueOnce([]);

    const { createApprovalsForProposalVersion } = await import(
      '@/server/services/approval-engine.service'
    );
    await createApprovalsForProposalVersion({
      tenantId: TENANT_A,
      proposalVersionId: 'pv-3',
      totalValue: 1000,
      marginPct: 50,
    });

    const call = mockUser.findMany.mock.calls[0]![0]!;
    expect(call.where).toMatchObject({
      tenantId: TENANT_A,
      deletedAt: null,
      active: true,
    });
  });
});

describe.skip('AC-21 — rule que tenta ter ambos falha em runtime', () => {
  it('service prioriza approverPermission quando ambos setados (defensivo)', async () => {
    // Cenário: DB corrupto ou seed de outra época — service deve preferir o novo.
    mockRule.findMany.mockResolvedValueOnce([
      {
        id: 'rule-4',
        name: 'ambiguidade',
        criteria: 'UNIVERSAL',
        thresholdNumeric: null,
        approverRoles: ['DIRETOR_COMERCIAL'],
        approverPermission: 'proposal:approve',
        enabled: true,
      },
    ]);
    mockUser.findMany.mockResolvedValueOnce([]);

    const { createApprovalsForProposalVersion } = await import(
      '@/server/services/approval-engine.service'
    );
    await createApprovalsForProposalVersion({
      tenantId: TENANT_A,
      proposalVersionId: 'pv-4',
      totalValue: 1000,
      marginPct: 50,
    });

    const call = mockUser.findMany.mock.calls[0]![0]!;
    expect(call.where.cachedPermissions).toEqual({ has: 'proposal:approve' });
    expect(call.where.role).toBeUndefined();
  });
});
