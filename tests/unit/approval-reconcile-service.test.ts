// @vitest-environment node
// Sprint 15H chip 1a — reconcile de approvals órfãs (P-77).
// Cobre: função pura evaluateApprovalOrphan (todos os motivos + precedência +
// skip de snapshot NULL); orquestrador reconcileApprovalsForTenant (marca
// ORPHANED idempotente, audita, notifica, isola por tenant); worker
// reconcileAllTenants (no-op sob flag OFF, agrega, best-effort por tenant).
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { envStub, mockTenant, mockApproval, mockUser, auditSpy, permSpy, pushSpy } =
  vi.hoisted(() => ({
    envStub: {
      APPROVAL_RECONCILE_ENABLED: true,
      NEXT_PUBLIC_APP_URL: 'https://crm.venzo.app',
    } as { APPROVAL_RECONCILE_ENABLED: boolean; NEXT_PUBLIC_APP_URL: string },
    mockTenant: { findMany: vi.fn() },
    mockApproval: { findMany: vi.fn(), updateMany: vi.fn() },
    mockUser: { findMany: vi.fn() },
    auditSpy: vi.fn(),
    permSpy: vi.fn(),
    pushSpy: vi.fn(),
  }));

vi.mock('@/lib/env', () => ({
  env: new Proxy({} as Record<string, unknown>, {
    get: (_t, prop) =>
      prop in envStub ? (envStub as Record<string, unknown>)[prop as string] : undefined,
  }),
}));
vi.mock('@/server/db/client', () => ({
  prisma: { tenant: mockTenant, approval: mockApproval, user: mockUser },
}));
vi.mock('@/server/db/tenant-context', () => ({
  runAsSystem: <T,>(fn: () => Promise<T>) => fn(),
}));
vi.mock('@/server/services/audit.service', () => ({
  audit: (...a: unknown[]) => auditSpy(...a),
}));
vi.mock('@/server/services/permissions.service', () => ({
  hasPermission: (...a: unknown[]) => permSpy(...a),
}));
vi.mock('@/server/services/push-sender.service', () => ({
  sendPushToUser: (...a: unknown[]) => pushSpy(...a),
}));

import {
  evaluateApprovalOrphan,
  approverSatisfiesRule,
  reconcileApprovalsForTenant,
  type ApprovalOrphanInput,
} from '@/server/services/approval-reconcile.service';
import { reconcileAllTenants } from '@/jobs/approvals-reconcile.worker';

// ── helpers ──────────────────────────────────────────────────────────

function orphanInput(over: Partial<ApprovalOrphanInput> = {}): ApprovalOrphanInput {
  return {
    approver: { active: true, deletedAt: null, role: 'DIRETOR_COMERCIAL' },
    applicableRuleId: 'rule-1',
    rule: {
      deletedAt: null,
      enabled: true,
      approverRoles: ['DIRETOR_COMERCIAL'],
      approverPermission: null,
    },
    approverHasPermission: null,
    ...over,
  };
}

function pendingApproval(over: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    approverId: 'approver-1',
    applicableRuleId: 'rule-1',
    approver: { active: true, deletedAt: null, role: 'DIRETOR_COMERCIAL' },
    applicableRule: {
      deletedAt: null,
      enabled: true,
      approverRoles: ['DIRETOR_COMERCIAL'],
      approverPermission: null,
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  envStub.APPROVAL_RECONCILE_ENABLED = true;
  auditSpy.mockResolvedValue(undefined);
  permSpy.mockResolvedValue(true);
  pushSpy.mockResolvedValue({ sent: 1, failed: 0 });
  mockTenant.findMany.mockResolvedValue([{ id: 'tenant-A' }]);
  mockApproval.findMany.mockResolvedValue([]);
  mockApproval.updateMany.mockResolvedValue({ count: 1 });
  mockUser.findMany.mockResolvedValue([{ id: 'admin-1' }]);
});

// ── função pura ──────────────────────────────────────────────────────

describe('evaluateApprovalOrphan — função pura', () => {
  it('tudo em ordem → NÃO órfã', () => {
    expect(evaluateApprovalOrphan(orphanInput())).toEqual({
      shouldOrphan: false,
      reason: null,
    });
  });

  it('approver inativo (active=false) → órfã approver_inactive', () => {
    expect(
      evaluateApprovalOrphan(orphanInput({ approver: { active: false, deletedAt: null, role: 'DIRETOR_COMERCIAL' } })),
    ).toEqual({ shouldOrphan: true, reason: 'approver_inactive' });
  });

  it('approver soft-deletado (deletedAt) → órfã approver_inactive', () => {
    expect(
      evaluateApprovalOrphan(
        orphanInput({ approver: { active: true, deletedAt: new Date(), role: 'DIRETOR_COMERCIAL' } }),
      ).reason,
    ).toBe('approver_inactive');
  });

  it('applicableRuleId NULL (approval legada sem snapshot) → PULA, NÃO órfã (desvio §3.3 fail-safe)', () => {
    expect(evaluateApprovalOrphan(orphanInput({ applicableRuleId: null, rule: null }))).toEqual({
      shouldOrphan: false,
      reason: null,
    });
  });

  it('rule soft-deletada (deletedAt) → órfã rule_deleted', () => {
    expect(
      evaluateApprovalOrphan(
        orphanInput({
          rule: { deletedAt: new Date(), enabled: true, approverRoles: ['DIRETOR_COMERCIAL'], approverPermission: null },
        }),
      ),
    ).toEqual({ shouldOrphan: true, reason: 'rule_deleted' });
  });

  it('rule sumiu (id setado mas row null — hard delete SET NULL) → órfã rule_deleted', () => {
    expect(
      evaluateApprovalOrphan(orphanInput({ applicableRuleId: 'rule-1', rule: null })),
    ).toEqual({ shouldOrphan: true, reason: 'rule_deleted' });
  });

  it('rule desabilitada (enabled=false) → órfã rule_disabled', () => {
    expect(
      evaluateApprovalOrphan(
        orphanInput({
          rule: { deletedAt: null, enabled: false, approverRoles: ['DIRETOR_COMERCIAL'], approverPermission: null },
        }),
      ),
    ).toEqual({ shouldOrphan: true, reason: 'rule_disabled' });
  });

  it('approver perdeu o role exigido pela rule → órfã approver_role_no_longer_matches_rule', () => {
    expect(
      evaluateApprovalOrphan(
        orphanInput({ approver: { active: true, deletedAt: null, role: 'ANALISTA' } }),
      ),
    ).toEqual({ shouldOrphan: true, reason: 'approver_role_no_longer_matches_rule' });
  });

  it('rule permission-based + approver perdeu a permission → órfã approver_permission_revoked', () => {
    expect(
      evaluateApprovalOrphan(
        orphanInput({
          rule: { deletedAt: null, enabled: true, approverRoles: [], approverPermission: 'proposal:approve' },
          approverHasPermission: false,
        }),
      ),
    ).toEqual({ shouldOrphan: true, reason: 'approver_permission_revoked' });
  });

  it('rule permission-based + approver AINDA tem a permission → NÃO órfã', () => {
    expect(
      evaluateApprovalOrphan(
        orphanInput({
          rule: { deletedAt: null, enabled: true, approverRoles: [], approverPermission: 'proposal:approve' },
          approverHasPermission: true,
        }),
      ),
    ).toEqual({ shouldOrphan: false, reason: null });
  });

  it('precedência: inativo vence role mismatch (ambos verdadeiros → reason approver_inactive)', () => {
    expect(
      evaluateApprovalOrphan(
        orphanInput({ approver: { active: false, deletedAt: null, role: 'ANALISTA' } }),
      ).reason,
    ).toBe('approver_inactive');
  });
});

// ── orquestrador ─────────────────────────────────────────────────────

// Sprint 15H Bloco A (chip 2a) — inverso puro usado no reassign da UI.
describe('approverSatisfiesRule — função pura (reuse do reassign)', () => {
  it('candidato ativo com role da rule → satisfaz', () => {
    expect(approverSatisfiesRule(orphanInput())).toBe(true);
  });

  it('candidato inativo → NÃO satisfaz', () => {
    expect(
      approverSatisfiesRule(
        orphanInput({ approver: { active: false, deletedAt: null, role: 'DIRETOR_COMERCIAL' } }),
      ),
    ).toBe(false);
  });

  it('role fora de approverRoles → NÃO satisfaz', () => {
    expect(
      approverSatisfiesRule(
        orphanInput({ approver: { active: true, deletedAt: null, role: 'ANALISTA' } }),
      ),
    ).toBe(false);
  });

  it('rule permission-based: com permission → satisfaz; sem → NÃO', () => {
    const permRule = orphanInput({
      rule: { deletedAt: null, enabled: true, approverRoles: [], approverPermission: 'proposal:approve' },
    });
    expect(approverSatisfiesRule({ ...permRule, approverHasPermission: true })).toBe(true);
    expect(approverSatisfiesRule({ ...permRule, approverHasPermission: false })).toBe(false);
  });

  it('rule deletada → NINGUÉM satisfaz (recurso é rejeitar)', () => {
    expect(
      approverSatisfiesRule(orphanInput({ applicableRuleId: 'rule-1', rule: null })),
    ).toBe(false);
  });

  it('sem snapshot da rule (applicableRuleId null) → qualquer ativo satisfaz', () => {
    expect(
      approverSatisfiesRule(orphanInput({ applicableRuleId: null, rule: null })),
    ).toBe(true);
  });
});

describe('reconcileApprovalsForTenant', () => {
  it('marca ORPHANED (updateMany WHERE PENDING) + audita com tenantIdOverride', async () => {
    mockApproval.findMany.mockResolvedValueOnce([
      pendingApproval({ approver: { active: true, deletedAt: null, role: 'ANALISTA' } }),
    ]);

    const res = await reconcileApprovalsForTenant('tenant-A');

    // query filtra tenantId + PENDING + não-deletadas
    expect(mockApproval.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-A', status: 'PENDING', deletedAt: null },
      }),
    );
    // transição idempotente com tenantId no WHERE
    expect(mockApproval.updateMany).toHaveBeenCalledWith({
      where: { id: 'app-1', tenantId: 'tenant-A', status: 'PENDING' },
      data: {
        status: 'ORPHANED',
        orphanedAt: expect.any(Date),
        orphanedReason: 'approver_role_no_longer_matches_rule',
      },
    });
    // audit com override + payload correto
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'approval.orphaned',
        tableName: 'approvals',
        recordId: 'app-1',
        tenantIdOverride: 'tenant-A',
        after: { reason: 'approver_role_no_longer_matches_rule', previousApproverId: 'approver-1' },
      }),
    );
    expect(res).toEqual({ tenantId: 'tenant-A', orphaned: 1, skipped: 0, notified: 1 });
  });

  it('idempotência: updateMany count 0 (já não-PENDING) → sem audit, orphaned 0', async () => {
    mockApproval.findMany.mockResolvedValueOnce([
      pendingApproval({ approver: { active: false, deletedAt: null, role: 'DIRETOR_COMERCIAL' } }),
    ]);
    mockApproval.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await reconcileApprovalsForTenant('tenant-A');

    expect(mockApproval.updateMany).toHaveBeenCalledTimes(1);
    expect(auditSpy).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(res).toEqual({ tenantId: 'tenant-A', orphaned: 0, skipped: 0, notified: 0 });
  });

  it('approval legada (applicableRuleId NULL) → skipped, sem updateMany nem audit', async () => {
    mockApproval.findMany.mockResolvedValueOnce([
      pendingApproval({ applicableRuleId: null, applicableRule: null }),
    ]);

    const res = await reconcileApprovalsForTenant('tenant-A');

    expect(mockApproval.updateMany).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
    expect(res).toEqual({ tenantId: 'tenant-A', orphaned: 0, skipped: 1, notified: 0 });
  });

  it('rule permission-based chama hasPermission com approverId + permission', async () => {
    mockApproval.findMany.mockResolvedValueOnce([
      pendingApproval({
        applicableRule: { deletedAt: null, enabled: true, approverRoles: [], approverPermission: 'proposal:approve' },
      }),
    ]);
    permSpy.mockResolvedValueOnce(false);

    const res = await reconcileApprovalsForTenant('tenant-A');

    expect(permSpy).toHaveBeenCalledWith('approver-1', 'proposal:approve');
    expect(res.orphaned).toBe(1);
    expect(mockApproval.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orphanedReason: 'approver_permission_revoked' }),
      }),
    );
  });

  it('órfãs > 0 → notifica ADMINs do tenant via push (best-effort)', async () => {
    mockApproval.findMany.mockResolvedValueOnce([
      pendingApproval({ approver: { active: false, deletedAt: null, role: 'DIRETOR_COMERCIAL' } }),
    ]);

    await reconcileApprovalsForTenant('tenant-A');

    expect(mockUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-A', active: true, deletedAt: null, role: 'ADMIN' },
      }),
    );
    expect(pushSpy).toHaveBeenCalledWith('admin-1', expect.objectContaining({
      url: 'https://crm.venzo.app/admin/approvals-orphaned',
    }));
  });

  it('nenhuma órfã → sem updateMany, sem notificação', async () => {
    mockApproval.findMany.mockResolvedValueOnce([pendingApproval()]);

    const res = await reconcileApprovalsForTenant('tenant-A');

    expect(mockApproval.updateMany).not.toHaveBeenCalled();
    expect(mockUser.findMany).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(res).toEqual({ tenantId: 'tenant-A', orphaned: 0, skipped: 0, notified: 0 });
  });

  it('push de notificação falha → reconcile ainda persiste a marcação (best-effort)', async () => {
    mockApproval.findMany.mockResolvedValueOnce([
      pendingApproval({ approver: { active: false, deletedAt: null, role: 'DIRETOR_COMERCIAL' } }),
    ]);
    pushSpy.mockRejectedValue(new Error('push down'));

    const res = await reconcileApprovalsForTenant('tenant-A');

    expect(mockApproval.updateMany).toHaveBeenCalledTimes(1);
    expect(res.orphaned).toBe(1);
    // notificação retorna best-effort: allSettled não propaga, notified=1
    expect(res.notified).toBe(1);
  });
});

// ── worker ───────────────────────────────────────────────────────────

describe('reconcileAllTenants — worker', () => {
  it('flag OFF → no-op total, nem lista tenants', async () => {
    envStub.APPROVAL_RECONCILE_ENABLED = false;
    const res = await reconcileAllTenants();
    expect(res).toEqual([]);
    expect(mockTenant.findMany).not.toHaveBeenCalled();
    expect(mockApproval.findMany).not.toHaveBeenCalled();
  });

  it('flag ON → itera tenants ativos e agrega resultados', async () => {
    mockTenant.findMany.mockResolvedValueOnce([{ id: 'tenant-A' }, { id: 'tenant-B' }]);
    mockApproval.findMany.mockResolvedValue([]); // ambos sem PENDING
    const res = await reconcileAllTenants();
    expect(mockTenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
    expect(res).toEqual([
      { tenantId: 'tenant-A', orphaned: 0, skipped: 0, notified: 0 },
      { tenantId: 'tenant-B', orphaned: 0, skipped: 0, notified: 0 },
    ]);
  });

  it('best-effort: um tenant lança → os outros seguem', async () => {
    mockTenant.findMany.mockResolvedValueOnce([{ id: 'tenant-A' }, { id: 'tenant-B' }]);
    mockApproval.findMany
      .mockRejectedValueOnce(new Error('DB down for A'))
      .mockResolvedValueOnce([]);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await reconcileAllTenants();

    expect(res).toEqual([{ tenantId: 'tenant-B', orphaned: 0, skipped: 0, notified: 0 }]);
    expect(errSpy).toHaveBeenCalled();
    expect(String(errSpy.mock.calls[0]![0])).toContain('tenant tenant-A falhou');
    errSpy.mockRestore();
  });
});
