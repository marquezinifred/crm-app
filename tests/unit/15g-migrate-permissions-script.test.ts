// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Sprint 15G Fase 1b — script de backfill A2.
 *
 * Cobre:
 *   1. Fluxo normal com múltiplos users → UPSERT + DELETE + UPDATE cache + AUDIT
 *   2. Idempotência: 2ª execução com zero legacy → nenhuma mutation
 *   3. ON CONFLICT DO NOTHING: user com read_team preexistente não duplica
 *   4. cache invalidado (cachedPermissionsAt = null) nos userIds afetados
 */

const mockOverride = {
  findMany: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
};
const mockUser = {
  updateMany: vi.fn(),
};

vi.mock('@/server/db/client', () => ({
  prisma: {
    userPermissionOverride: mockOverride,
    user: mockUser,
    $disconnect: vi.fn(),
  },
}));

const auditSpy = vi.fn();
vi.mock('@/server/services/audit.service', () => ({
  audit: (entry: unknown) => auditSpy(entry),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('scripts/15g-migrate-permissions — backfill A2', () => {
  it('primeira execução: migra 3 users de read_others → read_team + invalida cache + audita', async () => {
    mockOverride.findMany.mockImplementation(async ({ where }) => {
      if (where?.action === 'granted') {
        return [
          { id: 'ov-1', userId: 'u-1', tenantId: 't-A', grantedBy: 'admin-1', reason: 'Motivo 1' },
          { id: 'ov-2', userId: 'u-2', tenantId: 't-A', grantedBy: null, reason: null },
          { id: 'ov-3', userId: 'u-3', tenantId: 't-B', grantedBy: 'admin-2', reason: null },
        ];
      }
      return [];
    });
    mockOverride.upsert.mockImplementation(async ({ create }) => ({
      id: 'new-' + create.userId,
      ...create,
    }));
    mockOverride.deleteMany.mockResolvedValueOnce({ count: 3 });
    mockUser.updateMany.mockResolvedValueOnce({ count: 3 });

    const { migrate15gPermissions } = await import(
      '../../scripts/15g-migrate-permissions'
    );
    const summary = await migrate15gPermissions();

    expect(summary).toEqual({
      legacyGrantedCount: 3,
      legacyRevokedCount: 0,
      insertedCount: 3,
      deletedCount: 3,
      affectedUserCount: 3,
      auditedTenantCount: 2,
    });

    expect(mockOverride.upsert).toHaveBeenCalledTimes(3);
    expect(mockOverride.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_permission_unique: { userId: 'u-1', permission: 'opportunity:read_team' } },
        create: expect.objectContaining({
          userId: 'u-1',
          tenantId: 't-A',
          permission: 'opportunity:read_team',
          action: 'granted',
          reason: expect.stringContaining('[15G migration]'),
        }),
      }),
    );

    expect(mockOverride.deleteMany).toHaveBeenCalledWith({
      where: { permission: 'opportunity:read_others' },
    });

    expect(mockUser.updateMany).toHaveBeenCalledWith({
      where: { id: { in: expect.arrayContaining(['u-1', 'u-2', 'u-3']) } },
      data: { cachedPermissionsAt: null },
    });

    expect(auditSpy).toHaveBeenCalledTimes(2);
    const auditsByTenant = new Map<string, unknown>();
    for (const call of auditSpy.mock.calls) {
      const entry = call[0] as { tenantIdOverride: string };
      auditsByTenant.set(entry.tenantIdOverride, entry);
    }
    expect(auditsByTenant.get('t-A')).toEqual(
      expect.objectContaining({
        action: 'sales_structure.migration_backfill_read_others_to_read_team',
        tableName: 'user_permission_overrides',
        tenantIdOverride: 't-A',
        after: expect.objectContaining({
          userIds: expect.arrayContaining(['u-1', 'u-2']),
          migrated_count: 2,
          legacy_permission: 'opportunity:read_others',
          target_permission: 'opportunity:read_team',
        }),
      }),
    );
    expect(auditsByTenant.get('t-B')).toEqual(
      expect.objectContaining({
        tenantIdOverride: 't-B',
        after: expect.objectContaining({
          userIds: ['u-3'],
          migrated_count: 1,
        }),
      }),
    );
  });

  it('idempotência: segunda execução com zero legacy → nenhuma mutation', async () => {
    mockOverride.findMany.mockResolvedValue([]);

    const { migrate15gPermissions } = await import(
      '../../scripts/15g-migrate-permissions'
    );
    const summary = await migrate15gPermissions();

    expect(summary).toEqual({
      legacyGrantedCount: 0,
      legacyRevokedCount: 0,
      insertedCount: 0,
      deletedCount: 0,
      affectedUserCount: 0,
      auditedTenantCount: 0,
    });

    expect(mockOverride.upsert).not.toHaveBeenCalled();
    expect(mockOverride.deleteMany).not.toHaveBeenCalled();
    expect(mockUser.updateMany).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('ON CONFLICT DO NOTHING: user com read_team preexistente reutiliza row existente (upsert.update é no-op)', async () => {
    mockOverride.findMany.mockImplementation(async ({ where }) =>
      where?.action === 'granted'
        ? [
            { id: 'ov-1', userId: 'u-1', tenantId: 't-A', grantedBy: null, reason: null },
          ]
        : [],
    );

    mockOverride.upsert.mockResolvedValueOnce({
      id: 'preexisting-row',
      userId: 'u-1',
      tenantId: 't-A',
      permission: 'opportunity:read_team',
      action: 'granted',
      reason: 'Concedida manualmente antes da migração',
    });

    mockOverride.deleteMany.mockResolvedValueOnce({ count: 1 });
    mockUser.updateMany.mockResolvedValueOnce({ count: 1 });

    const { migrate15gPermissions } = await import(
      '../../scripts/15g-migrate-permissions'
    );
    const summary = await migrate15gPermissions();

    expect(mockOverride.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {},
      }),
    );
    expect(summary.insertedCount).toBe(0);
    expect(summary.deletedCount).toBe(1);
    expect(summary.affectedUserCount).toBe(1);
  });

  it('cachedPermissionsAt = null forçado nos userIds afetados (incluindo overrides revoked)', async () => {
    mockOverride.findMany.mockImplementation(async ({ where }) => {
      if (where?.action === 'granted') {
        return [
          { id: 'ov-1', userId: 'u-1', tenantId: 't-A', grantedBy: null, reason: null },
        ];
      }
      if (where?.action === 'revoked') {
        return [
          { id: 'ov-r-1', userId: 'u-9', tenantId: 't-A' },
        ];
      }
      return [];
    });
    mockOverride.upsert.mockResolvedValueOnce({
      id: 'new',
      userId: 'u-1',
      tenantId: 't-A',
      permission: 'opportunity:read_team',
      action: 'granted',
      reason: '[15G migration] migrado de opportunity:read_others',
    });
    mockOverride.deleteMany.mockResolvedValueOnce({ count: 2 });
    mockUser.updateMany.mockResolvedValueOnce({ count: 2 });

    const { migrate15gPermissions } = await import(
      '../../scripts/15g-migrate-permissions'
    );
    const summary = await migrate15gPermissions();

    expect(summary.legacyRevokedCount).toBe(1);
    expect(summary.affectedUserCount).toBe(2);

    expect(mockUser.updateMany).toHaveBeenCalledWith({
      where: { id: { in: expect.arrayContaining(['u-1', 'u-9']) } },
      data: { cachedPermissionsAt: null },
    });

    expect(auditSpy).toHaveBeenCalledTimes(1);
    const entry = auditSpy.mock.calls[0]?.[0] as {
      after: { userIds: string[]; migrated_count: number };
    };
    expect(new Set(entry.after.userIds)).toEqual(new Set(['u-1', 'u-9']));
    expect(entry.after.migrated_count).toBe(2);
  });
});
