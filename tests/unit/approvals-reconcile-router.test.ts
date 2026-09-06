// @vitest-environment node
//
// Sprint 15H Bloco A (chip 2a) — router `approvalsReconcile` (P-77).
// Testa listOrphaned + candidatesForReassign + reassign via createCaller com
// prisma + permissions + audit mockados (padrão opportunity-transfers-router).
//
// A checagem "novo approver satisfaz a rule?" usa o REAL `approverSatisfiesRule`
// (pura, reuso de `evaluateApprovalOrphan`) — só os efeitos colaterais são
// mockados. Cobre: fila só ORPHANED do tenant, cross-tenant NOT_FOUND,
// reassign válido → PENDING + audit tenantIdOverride, reassign a approver que
// NÃO satisfaz a rule → BAD_REQUEST (role e permission), non-orphaned →
// BAD_REQUEST, race → CONFLICT, candidate ausente → NOT_FOUND, RBAC FORBIDDEN.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??=
  'pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ApprovalStatus } from '@prisma/client';

const { mockPrisma, hasPermissionMock, auditMock } = vi.hoisted(() => ({
  mockPrisma: {
    approval: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
  hasPermissionMock: vi.fn(async (_userId: string, _permission: string) => true),
  auditMock: vi.fn(),
}));

vi.mock('@/server/db/client', () => ({ prisma: mockPrisma }));
vi.mock('@/server/services/permissions.service', () => ({
  hasPermission: hasPermissionMock,
  computeAndCacheUserPermissions: vi.fn(async () => new Set()),
  invalidateUserPermissionsCache: vi.fn(async () => undefined),
}));
vi.mock('@/server/services/audit.service', () => ({ audit: auditMock }));
// push-sender e env são deps do approval-reconcile.service, mas as funções
// PURAS (approverSatisfiesRule/evaluateApprovalOrphan) não as usam. Mock só
// pra manter o import hermético (sem web-push / validação de env real).
vi.mock('@/server/services/push-sender.service', () => ({
  sendPushToUser: vi.fn(async () => undefined),
}));
vi.mock('@/lib/env', () => ({ env: { APPROVAL_RECONCILE_ENABLED: true } }));

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const APPROVAL_ID = '22222222-2222-2222-2222-222222222222';
const OLD_APPROVER = '33333333-3333-3333-3333-333333333333';
const NEW_APPROVER = '44444444-4444-4444-4444-444444444444';
const RULE_ID = '55555555-5555-5555-5555-555555555555';
const ADMIN_ID = '66666666-6666-6666-6666-666666666666';

async function makeCaller(userId: string = ADMIN_ID) {
  const { approvalsReconcileRouter } = await import(
    '@/server/trpc/routers/approvals-reconcile'
  );
  return approvalsReconcileRouter.createCaller({
    req: new Request('http://localhost/test'),
    tenantId: TENANT_A,
    user: {
      id: userId,
      email: 'admin@venzo.co',
      fullName: 'Admin',
      role: 'ADMIN',
      tenantId: TENANT_A,
      partnerCompanyId: null,
    },
    platformUser: null,
    platformRole: null,
    ip: '127.0.0.1',
    userAgent: 'test-agent',
  });
}

/** Approval órfã (shape do select de reassign). Rule role-based por default. */
function orphanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: APPROVAL_ID,
    status: ApprovalStatus.ORPHANED,
    approverId: OLD_APPROVER,
    applicableRuleId: RULE_ID,
    applicableRule: {
      deletedAt: null,
      enabled: true,
      approverRoles: ['DIRETOR_FINANCEIRO'],
      approverPermission: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // hasPermission: middleware (approval:reconcile / approval:reassign) sempre
  // OK; rule permission-based controlada por teste (default: tem a permission).
  hasPermissionMock.mockResolvedValue(true);
  auditMock.mockResolvedValue(undefined);
  mockPrisma.approval.updateMany.mockResolvedValue({ count: 1 });
});

// ════════════════════════════════════════════════════════════════════
// listOrphaned
// ════════════════════════════════════════════════════════════════════
describe('approvalsReconcile.listOrphaned', () => {
  it('lista só ORPHANED do tenant (where explícito)', async () => {
    mockPrisma.approval.findMany.mockResolvedValueOnce([orphanRow()]);
    const caller = await makeCaller();
    const rows = await caller.listOrphaned();

    expect(rows).toHaveLength(1);
    const args = mockPrisma.approval.findMany.mock.calls[0]![0]!;
    expect(args.where).toMatchObject({
      tenantId: TENANT_A,
      status: ApprovalStatus.ORPHANED,
      deletedAt: null,
    });
  });

  it('FORBIDDEN sem approval:reconcile', async () => {
    hasPermissionMock.mockImplementation(
      async (_u: string, p: string) => p !== 'approval:reconcile',
    );
    const caller = await makeCaller();
    await expect(caller.listOrphaned()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockPrisma.approval.findMany).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════
// candidatesForReassign
// ════════════════════════════════════════════════════════════════════
describe('approvalsReconcile.candidatesForReassign', () => {
  it('rule role-based: filtra por role e exclui o approver atual', async () => {
    mockPrisma.approval.findFirst.mockResolvedValueOnce(orphanRow());
    mockPrisma.user.findMany.mockResolvedValueOnce([
      { id: NEW_APPROVER, fullName: 'Novo Diretor', role: 'DIRETOR_FINANCEIRO' },
    ]);
    const caller = await makeCaller();
    const candidates = await caller.candidatesForReassign({ approvalId: APPROVAL_ID });

    expect(candidates).toHaveLength(1);
    const where = mockPrisma.user.findMany.mock.calls[0]![0]!.where;
    expect(where).toMatchObject({
      tenantId: TENANT_A,
      active: true,
      deletedAt: null,
      role: { in: ['DIRETOR_FINANCEIRO'] },
      id: { not: OLD_APPROVER },
    });
  });

  it('rule permission-based: filtra por cachedPermissions', async () => {
    mockPrisma.approval.findFirst.mockResolvedValueOnce(
      orphanRow({
        applicableRule: {
          deletedAt: null,
          enabled: true,
          approverRoles: [],
          approverPermission: 'proposal:approve',
        },
      }),
    );
    mockPrisma.user.findMany.mockResolvedValueOnce([]);
    const caller = await makeCaller();
    await caller.candidatesForReassign({ approvalId: APPROVAL_ID });

    const where = mockPrisma.user.findMany.mock.calls[0]![0]!.where;
    expect(where).toMatchObject({
      cachedPermissions: { has: 'proposal:approve' },
    });
  });

  it('rule deletada/desabilitada → sem candidatos (não consulta users)', async () => {
    mockPrisma.approval.findFirst.mockResolvedValueOnce(
      orphanRow({
        applicableRule: {
          deletedAt: new Date(),
          enabled: true,
          approverRoles: ['DIRETOR_FINANCEIRO'],
          approverPermission: null,
        },
      }),
    );
    const caller = await makeCaller();
    const candidates = await caller.candidatesForReassign({ approvalId: APPROVAL_ID });
    expect(candidates).toEqual([]);
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it('cross-tenant / inexistente → NOT_FOUND', async () => {
    mockPrisma.approval.findFirst.mockResolvedValueOnce(null);
    const caller = await makeCaller();
    await expect(
      caller.candidatesForReassign({ approvalId: APPROVAL_ID }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ════════════════════════════════════════════════════════════════════
// reassign
// ════════════════════════════════════════════════════════════════════
describe('approvalsReconcile.reassign', () => {
  const input = { approvalId: APPROVAL_ID, newApproverId: NEW_APPROVER };

  it('happy path role-based: ORPHANED → PENDING + audit com tenantIdOverride', async () => {
    mockPrisma.approval.findFirst.mockResolvedValueOnce(orphanRow());
    mockPrisma.user.findFirst.mockResolvedValueOnce({
      id: NEW_APPROVER,
      active: true,
      deletedAt: null,
      role: 'DIRETOR_FINANCEIRO', // ∈ approverRoles → satisfaz
    });
    const caller = await makeCaller();
    const result = await caller.reassign(input);

    expect(result).toMatchObject({
      id: APPROVAL_ID,
      approverId: NEW_APPROVER,
      status: ApprovalStatus.PENDING,
    });

    // updateMany idempotente com WHERE ORPHANED + tenantId
    const upArgs = mockPrisma.approval.updateMany.mock.calls[0]![0]!;
    expect(upArgs.where).toMatchObject({
      id: APPROVAL_ID,
      tenantId: TENANT_A,
      status: ApprovalStatus.ORPHANED,
    });
    expect(upArgs.data).toMatchObject({
      status: ApprovalStatus.PENDING,
      approverId: NEW_APPROVER,
      orphanedAt: null,
      orphanedReason: null,
    });

    // audit com tenantIdOverride
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0]![0]).toMatchObject({
      action: 'approval.reassigned',
      tableName: 'approvals',
      recordId: APPROVAL_ID,
      tenantIdOverride: TENANT_A,
    });
  });

  it('candidato NÃO satisfaz rule role-based → BAD_REQUEST (sem update/audit)', async () => {
    mockPrisma.approval.findFirst.mockResolvedValueOnce(orphanRow());
    mockPrisma.user.findFirst.mockResolvedValueOnce({
      id: NEW_APPROVER,
      active: true,
      deletedAt: null,
      role: 'ANALISTA', // ∉ approverRoles → NÃO satisfaz
    });
    const caller = await makeCaller();
    await expect(caller.reassign(input)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockPrisma.approval.updateMany).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('rule permission-based: candidato COM a permission → PENDING', async () => {
    mockPrisma.approval.findFirst.mockResolvedValueOnce(
      orphanRow({
        applicableRule: {
          deletedAt: null,
          enabled: true,
          approverRoles: [],
          approverPermission: 'proposal:approve',
        },
      }),
    );
    mockPrisma.user.findFirst.mockResolvedValueOnce({
      id: NEW_APPROVER,
      active: true,
      deletedAt: null,
      role: 'DIRETOR_FINANCEIRO',
    });
    // middleware + rule permission-based ambos passam
    hasPermissionMock.mockResolvedValue(true);
    const caller = await makeCaller();
    const result = await caller.reassign(input);
    expect(result.status).toBe(ApprovalStatus.PENDING);
    // hasPermission chamado pro candidato com a permission da rule
    expect(hasPermissionMock).toHaveBeenCalledWith(NEW_APPROVER, 'proposal:approve');
  });

  it('rule permission-based: candidato SEM a permission → BAD_REQUEST', async () => {
    mockPrisma.approval.findFirst.mockResolvedValueOnce(
      orphanRow({
        applicableRule: {
          deletedAt: null,
          enabled: true,
          approverRoles: [],
          approverPermission: 'proposal:approve',
        },
      }),
    );
    mockPrisma.user.findFirst.mockResolvedValueOnce({
      id: NEW_APPROVER,
      active: true,
      deletedAt: null,
      role: 'ANALISTA',
    });
    // middleware OK, mas candidato não tem 'proposal:approve'
    hasPermissionMock.mockImplementation(
      async (_u: string, p: string) => p !== 'proposal:approve',
    );
    const caller = await makeCaller();
    await expect(caller.reassign(input)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockPrisma.approval.updateMany).not.toHaveBeenCalled();
  });

  it('approval não órfã (PENDING) → BAD_REQUEST', async () => {
    mockPrisma.approval.findFirst.mockResolvedValueOnce(
      orphanRow({ status: ApprovalStatus.PENDING }),
    );
    const caller = await makeCaller();
    await expect(caller.reassign(input)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('approval cross-tenant / inexistente → NOT_FOUND', async () => {
    mockPrisma.approval.findFirst.mockResolvedValueOnce(null);
    const caller = await makeCaller();
    await expect(caller.reassign(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('candidato cross-tenant / inexistente → NOT_FOUND', async () => {
    mockPrisma.approval.findFirst.mockResolvedValueOnce(orphanRow());
    mockPrisma.user.findFirst.mockResolvedValueOnce(null);
    const caller = await makeCaller();
    await expect(caller.reassign(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('corrida (updateMany count 0) → CONFLICT', async () => {
    mockPrisma.approval.findFirst.mockResolvedValueOnce(orphanRow());
    mockPrisma.user.findFirst.mockResolvedValueOnce({
      id: NEW_APPROVER,
      active: true,
      deletedAt: null,
      role: 'DIRETOR_FINANCEIRO',
    });
    mockPrisma.approval.updateMany.mockResolvedValueOnce({ count: 0 });
    const caller = await makeCaller();
    await expect(caller.reassign(input)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('FORBIDDEN sem approval:reassign', async () => {
    hasPermissionMock.mockImplementation(
      async (_u: string, p: string) => p !== 'approval:reassign',
    );
    const caller = await makeCaller();
    await expect(caller.reassign(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockPrisma.approval.findFirst).not.toHaveBeenCalled();
  });

  it('TRPCError propaga como instância real', async () => {
    mockPrisma.approval.findFirst.mockResolvedValueOnce(null);
    const caller = await makeCaller();
    await expect(caller.reassign(input)).rejects.toBeInstanceOf(TRPCError);
  });
});
