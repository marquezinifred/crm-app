// @vitest-environment node
//
// Sprint 15G Fase 2a — Service central da estrutura comercial.
// Cobre `resolveOpportunityScope` (path novo + fallback pré-15G que fecha
// P-73), `createUnitType`, `addMember` (A5 transação + cross-tenant),
// `removeMember`. Mocks fazem o teste puro (sem Postgres).
//
// Padrão do mock alinhado com `rbac-kill-switch.test.ts` (Proxy no env)
// e `inbound-assign-push.test.ts` (mock de services + prisma).

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??=
  'pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { UserRole } from '@prisma/client';

const {
  mockPrisma,
  mockEnv,
  hasPermissionMock,
  invalidateCacheMock,
  getSubtreeMock,
  auditMock,
} = vi.hoisted(() => ({
  mockPrisma: {
    salesUnitType: { create: vi.fn() },
    salesUnit: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    salesUnitMember: {
      upsert: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  },
  mockEnv: { SALES_STRUCTURE_ENABLED: true },
  hasPermissionMock: vi.fn(),
  invalidateCacheMock: vi.fn(async () => undefined),
  getSubtreeMock: vi.fn(),
  auditMock: vi.fn(async () => undefined),
}));

vi.mock('@/server/db/client', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/env', () => ({ env: mockEnv }));
vi.mock('@/server/services/permissions.service', () => ({
  hasPermission: hasPermissionMock,
  invalidateUserPermissionsCache: invalidateCacheMock,
}));
vi.mock('@/server/db/repositories/sales-unit.repository', () => ({
  SalesUnitRepository: { getSubtreeMemberIds: getSubtreeMock },
}));
vi.mock('@/server/services/audit.service', () => ({ audit: auditMock }));

import { SalesStructureService } from '@/server/services/sales-structure.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const USER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_USER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const UNIT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OTHER_UNIT = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const PARTNER_COMPANY = '99999999-9999-9999-9999-999999999999';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function scopeUser(overrides: Partial<{ id: string; role: UserRole; partnerCompanyId: string | null }> = {}) {
  return {
    id: USER,
    role: 'ANALISTA' as UserRole,
    partnerCompanyId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.SALES_STRUCTURE_ENABLED = true;
});

describe('SalesStructureService.resolveOpportunityScope', () => {
  describe('kill-switch OFF (fecha P-73) — fallback pré-15G', () => {
    beforeEach(() => {
      mockEnv.SALES_STRUCTURE_ENABLED = false;
    });

    it('não-PARCEIRO com opportunity:read_all → ALL (nunca consulta subtree)', async () => {
      hasPermissionMock.mockImplementation(
        async (_id: string, perm: string) => perm === 'opportunity:read_all',
      );

      const scope = await SalesStructureService.resolveOpportunityScope(
        scopeUser({ role: 'DIRETOR_COMERCIAL' }),
        TENANT,
      );

      expect(scope).toEqual({ type: 'ALL', filter: { tenantId: TENANT } });
      expect(getSubtreeMock).not.toHaveBeenCalled();
    });

    it('não-PARCEIRO com só opportunity:read_team → ALL binário (comportamento pré-15G)', async () => {
      // Fallback binário do visibilityWhere original (opportunities.ts:73):
      // qualquer das duas destrava tenant-wide. Diferente do path novo, que
      // consulta subtree quando só há read_team.
      hasPermissionMock.mockImplementation(
        async (_id: string, perm: string) => perm === 'opportunity:read_team',
      );

      const scope = await SalesStructureService.resolveOpportunityScope(
        scopeUser({ role: 'GESTOR' }),
        TENANT,
      );

      expect(scope).toEqual({ type: 'ALL', filter: { tenantId: TENANT } });
      expect(getSubtreeMock).not.toHaveBeenCalled();
    });

    it('não-PARCEIRO sem nenhuma permission → OWN', async () => {
      hasPermissionMock.mockResolvedValue(false);

      const scope = await SalesStructureService.resolveOpportunityScope(
        scopeUser({ role: 'ANALISTA' }),
        TENANT,
      );

      expect(scope).toEqual({
        type: 'OWN',
        filter: { ownerId: USER, tenantId: TENANT },
      });
    });

    it('PARCEIRO com partnerCompanyId preserva filtro row-level pré-15G', async () => {
      const scope = await SalesStructureService.resolveOpportunityScope(
        scopeUser({ role: 'PARCEIRO', partnerCompanyId: PARTNER_COMPANY }),
        TENANT,
      );

      expect(scope.type).toBe('PARTNER');
      expect(scope.filter).toEqual({
        tenantId: TENANT,
        partnerCompanyId: PARTNER_COMPANY,
        partnerEngagements: {
          some: { partnerCompanyId: PARTNER_COMPANY, status: 'APPROVED' },
        },
      });
      expect(hasPermissionMock).not.toHaveBeenCalled();
      expect(getSubtreeMock).not.toHaveBeenCalled();
    });
  });

  describe('kill-switch ON (path novo Sprint 15G)', () => {
    it('PARCEIRO com partnerCompanyId → PARTNER com engagement filter (A4)', async () => {
      const scope = await SalesStructureService.resolveOpportunityScope(
        scopeUser({ role: 'PARCEIRO', partnerCompanyId: PARTNER_COMPANY }),
        TENANT,
      );

      expect(scope).toEqual({
        type: 'PARTNER',
        filter: {
          tenantId: TENANT,
          partnerCompanyId: PARTNER_COMPANY,
          partnerEngagements: {
            some: { partnerCompanyId: PARTNER_COMPANY, status: 'APPROVED' },
          },
        },
      });
      // A4: PARCEIRO passa por early-return, NÃO consulta hasPermission
      expect(hasPermissionMock).not.toHaveBeenCalled();
      expect(getSubtreeMock).not.toHaveBeenCalled();
    });

    it('PARCEIRO sem partnerCompanyId → NONE com uuid zero', async () => {
      const scope = await SalesStructureService.resolveOpportunityScope(
        scopeUser({ role: 'PARCEIRO', partnerCompanyId: null }),
        TENANT,
      );

      expect(scope).toEqual({
        type: 'NONE',
        filter: { id: ZERO_UUID, tenantId: TENANT },
      });
    });

    it('não-PARCEIRO com read_all → ALL (não consulta subtree)', async () => {
      hasPermissionMock.mockImplementation(
        async (_id: string, perm: string) => perm === 'opportunity:read_all',
      );

      const scope = await SalesStructureService.resolveOpportunityScope(
        scopeUser({ role: 'DIRETOR_FINANCEIRO' }),
        TENANT,
      );

      expect(scope).toEqual({ type: 'ALL', filter: { tenantId: TENANT } });
      expect(getSubtreeMock).not.toHaveBeenCalled();
    });

    it('não-PARCEIRO com read_team + subtree não-vazia → TEAM com teamSize', async () => {
      hasPermissionMock.mockImplementation(
        async (_id: string, perm: string) => perm === 'opportunity:read_team',
      );
      getSubtreeMock.mockResolvedValueOnce([USER, OTHER_USER, 'other-3']);

      const scope = await SalesStructureService.resolveOpportunityScope(
        scopeUser({ role: 'GESTOR' }),
        TENANT,
      );

      expect(scope).toEqual({
        type: 'TEAM',
        filter: { ownerId: { in: [USER, OTHER_USER, 'other-3'] }, tenantId: TENANT },
        teamSize: 3,
      });
      expect(getSubtreeMock).toHaveBeenCalledWith(USER, TENANT);
    });

    it('não-PARCEIRO com read_team + subtree vazia → OWN (fallback)', async () => {
      hasPermissionMock.mockImplementation(
        async (_id: string, perm: string) => perm === 'opportunity:read_team',
      );
      getSubtreeMock.mockResolvedValueOnce([]);

      const scope = await SalesStructureService.resolveOpportunityScope(
        scopeUser({ role: 'GESTOR' }),
        TENANT,
      );

      expect(scope).toEqual({
        type: 'OWN',
        filter: { ownerId: USER, tenantId: TENANT },
      });
    });

    it('não-PARCEIRO sem nenhuma das duas permissions → OWN', async () => {
      hasPermissionMock.mockResolvedValue(false);

      const scope = await SalesStructureService.resolveOpportunityScope(
        scopeUser({ role: 'ANALISTA' }),
        TENANT,
      );

      expect(scope).toEqual({
        type: 'OWN',
        filter: { ownerId: USER, tenantId: TENANT },
      });
    });
  });
});

describe('SalesStructureService.createUnitType', () => {
  it('level abaixo do range (0) → BAD_REQUEST', async () => {
    await expect(
      SalesStructureService.createUnitType({
        tenantId: TENANT,
        name: 'X',
        level: 0,
      }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(mockPrisma.salesUnitType.create).not.toHaveBeenCalled();
  });

  it('level acima do range (9) → BAD_REQUEST', async () => {
    await expect(
      SalesStructureService.createUnitType({
        tenantId: TENANT,
        name: 'X',
        level: 9,
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('level fracionário (1.5) → BAD_REQUEST', async () => {
    await expect(
      SalesStructureService.createUnitType({
        tenantId: TENANT,
        name: 'X',
        level: 1.5,
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('level 1 OK → chama prisma.salesUnitType.create com tenantId', async () => {
    mockPrisma.salesUnitType.create.mockResolvedValueOnce({ id: 'sut-1' });

    await SalesStructureService.createUnitType({
      tenantId: TENANT,
      name: 'Equipe',
      level: 1,
      color: '#123',
      icon: 'users',
    });

    expect(mockPrisma.salesUnitType.create).toHaveBeenCalledWith({
      data: {
        tenantId: TENANT,
        name: 'Equipe',
        level: 1,
        color: '#123',
        icon: 'users',
      },
    });
  });

  it('level 8 (limite superior) OK', async () => {
    mockPrisma.salesUnitType.create.mockResolvedValueOnce({ id: 'sut-8' });

    await SalesStructureService.createUnitType({
      tenantId: TENANT,
      name: 'Diretoria',
      level: 8,
    });

    expect(mockPrisma.salesUnitType.create).toHaveBeenCalledWith({
      data: {
        tenantId: TENANT,
        name: 'Diretoria',
        level: 8,
        color: null,
        icon: null,
      },
    });
  });
});

describe('SalesStructureService.addMember', () => {
  it('unit de outro tenant + user do tenant → NOT_FOUND (cross-tenant guard)', async () => {
    // Unit filtrada pelo tenantId errado → findFirst retorna null
    mockPrisma.salesUnit.findFirst.mockResolvedValueOnce(null);
    mockPrisma.user.findFirst.mockResolvedValueOnce({ id: USER });

    await expect(
      SalesStructureService.addMember({
        unitId: OTHER_UNIT,
        userId: USER,
        role: 'MEMBER',
        tenantId: TENANT,
        assignedBy: OTHER_USER,
      }),
    ).rejects.toBeInstanceOf(TRPCError);

    expect(mockPrisma.salesUnitMember.upsert).not.toHaveBeenCalled();
    expect(invalidateCacheMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('user de outro tenant + unit do tenant → NOT_FOUND', async () => {
    mockPrisma.salesUnit.findFirst.mockResolvedValueOnce({ id: UNIT });
    mockPrisma.user.findFirst.mockResolvedValueOnce(null);

    await expect(
      SalesStructureService.addMember({
        unitId: UNIT,
        userId: OTHER_USER,
        role: 'MEMBER',
        tenantId: TENANT,
        assignedBy: USER,
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('isPrimary=true → transação com updateMany (desmarca outras) + upsert', async () => {
    mockPrisma.salesUnit.findFirst.mockResolvedValueOnce({ id: UNIT });
    mockPrisma.user.findFirst.mockResolvedValueOnce({ id: USER });

    await SalesStructureService.addMember({
      unitId: UNIT,
      userId: USER,
      role: 'MANAGER',
      tenantId: TENANT,
      assignedBy: OTHER_USER,
      isPrimary: true,
    });

    // Transação disparada
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    // updateMany chamada com filtro que exclui a própria unit
    expect(mockPrisma.salesUnitMember.updateMany).toHaveBeenCalledWith({
      where: {
        userId: USER,
        tenantId: TENANT,
        isPrimary: true,
        unitId: { not: UNIT },
      },
      data: { isPrimary: false },
    });
    // Upsert cria com isPrimary=true
    expect(mockPrisma.salesUnitMember.upsert).toHaveBeenCalledWith({
      where: { userId_unitId: { userId: USER, unitId: UNIT } },
      create: {
        userId: USER,
        unitId: UNIT,
        tenantId: TENANT,
        role: 'MANAGER',
        isPrimary: true,
        assignedBy: OTHER_USER,
      },
      update: {
        role: 'MANAGER',
        isPrimary: true,
        assignedBy: OTHER_USER,
      },
    });
  });

  it('isPrimary=false → só upsert (sem updateMany nem transação)', async () => {
    mockPrisma.salesUnit.findFirst.mockResolvedValueOnce({ id: UNIT });
    mockPrisma.user.findFirst.mockResolvedValueOnce({ id: USER });

    await SalesStructureService.addMember({
      unitId: UNIT,
      userId: USER,
      role: 'MEMBER',
      tenantId: TENANT,
      assignedBy: OTHER_USER,
      // sem isPrimary — default false
    });

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.salesUnitMember.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.salesUnitMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ isPrimary: false }),
        update: expect.objectContaining({ isPrimary: false }),
      }),
    );
  });

  it('cache de permissions invalidado após add (read_team depende da estrutura)', async () => {
    mockPrisma.salesUnit.findFirst.mockResolvedValueOnce({ id: UNIT });
    mockPrisma.user.findFirst.mockResolvedValueOnce({ id: USER });

    await SalesStructureService.addMember({
      unitId: UNIT,
      userId: USER,
      role: 'MEMBER',
      tenantId: TENANT,
      assignedBy: OTHER_USER,
    });

    expect(invalidateCacheMock).toHaveBeenCalledWith(USER);
    expect(invalidateCacheMock).toHaveBeenCalledTimes(1);
  });

  it('audit dispara com tenantIdOverride (P-04 pattern) e action correta', async () => {
    mockPrisma.salesUnit.findFirst.mockResolvedValueOnce({ id: UNIT });
    mockPrisma.user.findFirst.mockResolvedValueOnce({ id: USER });

    await SalesStructureService.addMember({
      unitId: UNIT,
      userId: USER,
      role: 'MANAGER',
      tenantId: TENANT,
      assignedBy: OTHER_USER,
      isPrimary: true,
    });

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sales_unit.member_added',
        tableName: 'sales_unit_members',
        recordId: USER,
        tenantIdOverride: TENANT,
        after: { unitId: UNIT, role: 'MANAGER', isPrimary: true },
      }),
    );
  });

  it('lookup de unit e user usam tenantId do input (não cross-tenant)', async () => {
    mockPrisma.salesUnit.findFirst.mockResolvedValueOnce({ id: UNIT });
    mockPrisma.user.findFirst.mockResolvedValueOnce({ id: USER });

    await SalesStructureService.addMember({
      unitId: UNIT,
      userId: USER,
      role: 'MEMBER',
      tenantId: TENANT,
      assignedBy: OTHER_USER,
    });

    expect(mockPrisma.salesUnit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: UNIT,
          tenantId: TENANT,
          deletedAt: null,
        }),
      }),
    );
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: USER,
          tenantId: TENANT,
          deletedAt: null,
        }),
      }),
    );
  });

  it('cross-tenant: unit=TENANT, user=OTHER_TENANT — user findFirst com tenantId retorna null', async () => {
    // Cenário: tentativa de adicionar user do outro tenant à unit do tenant atual.
    // O findFirst do user usa `tenantId: input.tenantId` → user do outro tenant
    // não é encontrado → NOT_FOUND.
    mockPrisma.salesUnit.findFirst.mockResolvedValueOnce({ id: UNIT });
    mockPrisma.user.findFirst.mockResolvedValueOnce(null);

    await expect(
      SalesStructureService.addMember({
        unitId: UNIT,
        userId: OTHER_USER, // teoricamente do OTHER_TENANT
        role: 'MEMBER',
        tenantId: TENANT,
        assignedBy: USER,
      }),
    ).rejects.toBeInstanceOf(TRPCError);

    // Sanity check: user findFirst usou o tenantId do caller, não o do target
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: OTHER_USER, tenantId: TENANT }),
      }),
    );
    // Uso do OTHER_TENANT só documenta a intenção; guard pega via tenantId do input
    expect(OTHER_TENANT).not.toBe(TENANT);
  });
});

describe('SalesStructureService.removeMember', () => {
  it('deleteMany com tenantId no where (cross-tenant guard)', async () => {
    await SalesStructureService.removeMember({
      unitId: UNIT,
      userId: USER,
      tenantId: TENANT,
    });

    expect(mockPrisma.salesUnitMember.deleteMany).toHaveBeenCalledWith({
      where: {
        unitId: UNIT,
        userId: USER,
        tenantId: TENANT,
      },
    });
  });

  it('cache de permissions invalidado após remove', async () => {
    await SalesStructureService.removeMember({
      unitId: UNIT,
      userId: USER,
      tenantId: TENANT,
    });

    expect(invalidateCacheMock).toHaveBeenCalledWith(USER);
    expect(invalidateCacheMock).toHaveBeenCalledTimes(1);
  });

  it('audit dispara com tenantIdOverride e action member_removed', async () => {
    await SalesStructureService.removeMember({
      unitId: UNIT,
      userId: USER,
      tenantId: TENANT,
    });

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sales_unit.member_removed',
        tableName: 'sales_unit_members',
        recordId: USER,
        tenantIdOverride: TENANT,
        after: { unitId: UNIT },
      }),
    );
  });
});
