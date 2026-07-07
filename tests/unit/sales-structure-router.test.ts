// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Sprint 15G Fase 2b — testes do router `sales-structure`.
 *
 * Contrato: o router delega a `SalesStructureService` (Fase 2a) e ao
 * `SalesUnitRepository` (Fase 1a). Ambos são mockados aqui — o objetivo
 * é validar a camada tRPC (Zod input, permissions, cross-tenant guard,
 * audit, delegação correta). Toda a semântica interna (ltree, cache,
 * scope resolver) é escopo dos outros chips.
 */

// ----------------- Prisma mocks -----------------
const mockSalesUnitType = {
  findMany: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};
const mockSalesUnit = {
  findFirst: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
};

vi.mock('@/server/db/client', () => ({
  prisma: {
    salesUnitType: mockSalesUnitType,
    salesUnit: mockSalesUnit,
  },
}));

vi.mock('@/server/db/tenant-context', () => ({
  runAsSystem: <T,>(fn: () => Promise<T>) => fn(),
  getTenantContext: () => ({ tenantId: 'tenant-A', userId: 'admin-1' }),
  SYSTEM_TENANT_SENTINEL: '__system__',
}));

// ----------------- Audit mock -----------------
const auditSpy = vi.fn();
vi.mock('@/server/services/audit.service', () => ({
  audit: (entry: unknown) => auditSpy(entry),
}));

// ----------------- Permissions mock (RBAC granular) -----------------
const hasPermissionMock = vi.fn<(userId: string, permission: string) => Promise<boolean>>(
  async () => true,
);
vi.mock('@/server/services/permissions.service', () => ({
  hasPermission: (userId: string, permission: string) => hasPermissionMock(userId, permission),
}));

// ----------------- Service mock (contrato Fase 2a) -----------------
const svcCreateUnitType = vi.fn();
const svcAddMember = vi.fn();
const svcRemoveMember = vi.fn();
const svcResolveScope = vi.fn();
vi.mock('@/server/services/sales-structure.service', () => ({
  SalesStructureService: {
    createUnitType: (i: unknown) => svcCreateUnitType(i),
    addMember: (i: unknown) => svcAddMember(i),
    removeMember: (i: unknown) => svcRemoveMember(i),
    resolveOpportunityScope: (u: unknown, t: unknown) => svcResolveScope(u, t),
  },
}));

// ----------------- Repository mock (Fase 1a) -----------------
const repoCreate = vi.fn();
const repoGetTree = vi.fn();
const repoGetAncestors = vi.fn();
const repoGetChildren = vi.fn();
vi.mock('@/server/db/repositories/sales-unit.repository', () => ({
  SalesUnitRepository: {
    create: (i: unknown) => repoCreate(i),
    getTree: (t: string) => repoGetTree(t),
    getAncestors: (id: string, t: string) => repoGetAncestors(id, t),
    getChildren: (id: string, t: string) => repoGetChildren(id, t),
  },
}));

// UUIDs de fixtura (válidos pra passar Zod)
const UUID_UNIT_TYPE = '11111111-1111-1111-1111-111111111111';
const UUID_UNIT = '22222222-2222-2222-2222-222222222222';
const UUID_PARENT = '33333333-3333-3333-3333-333333333333';
const UUID_USER = '44444444-4444-4444-4444-444444444444';

async function makeCaller() {
  const { salesStructureRouter } = await import('@/server/trpc/routers/sales-structure');
  return salesStructureRouter.createCaller({
    req: new Request('http://localhost/test'),
    tenantId: 'tenant-A',
    user: {
      id: 'admin-1',
      email: 'admin@test.co',
      fullName: 'Admin',
      role: 'ADMIN',
      tenantId: 'tenant-A',
      partnerCompanyId: null,
    },
    platformUser: null,
    platformRole: null,
    ip: '127.0.0.1',
    userAgent: 'test-agent',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionMock.mockImplementation(async () => true);
});

// ================================================================
// Types
// ================================================================

describe('salesStructureRouter.listUnitTypes', () => {
  it('retorna tipos filtrados por tenantId ordenados por level', async () => {
    mockSalesUnitType.findMany.mockResolvedValueOnce([
      { id: 't1', name: 'Equipe', level: 1 },
      { id: 't2', name: 'Regional', level: 2 },
    ]);

    const caller = await makeCaller();
    const out = await caller.listUnitTypes();

    expect(out.length).toBe(2);
    expect(mockSalesUnitType.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-A' },
      orderBy: { level: 'asc' },
    });
  });
});

describe('salesStructureRouter.createUnitType', () => {
  it('delega ao Service com tenantId injetado + audit + tenantIdOverride', async () => {
    svcCreateUnitType.mockResolvedValueOnce({
      id: 'new-t',
      name: 'Regional',
      level: 2,
      color: '#FF0000',
      icon: 'map',
    });

    const caller = await makeCaller();
    const out = await caller.createUnitType({
      name: 'Regional',
      level: 2,
      color: '#FF0000',
      icon: 'map',
    });

    expect(out.id).toBe('new-t');
    expect(svcCreateUnitType).toHaveBeenCalledWith({
      tenantId: 'tenant-A',
      name: 'Regional',
      level: 2,
      color: '#FF0000',
      icon: 'map',
    });
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sales_structure.unit_type_created',
        tenantIdOverride: 'tenant-A',
        tableName: 'sales_unit_types',
      }),
    );
  });

  it('rejeita level fora do range 1..8 via Zod', async () => {
    const caller = await makeCaller();
    await expect(
      caller.createUnitType({ name: 'X', level: 0 }),
    ).rejects.toBeDefined();
    await expect(
      caller.createUnitType({ name: 'X', level: 9 }),
    ).rejects.toBeDefined();
    expect(svcCreateUnitType).not.toHaveBeenCalled();
  });

  it('rejeita color não-hex via Zod', async () => {
    const caller = await makeCaller();
    await expect(
      caller.createUnitType({ name: 'Regional', level: 2, color: 'red' }),
    ).rejects.toBeDefined();
    expect(svcCreateUnitType).not.toHaveBeenCalled();
  });
});

describe('salesStructureRouter.updateUnitType', () => {
  it('NOT_FOUND quando type pertence a outro tenant', async () => {
    mockSalesUnitType.findFirst.mockResolvedValueOnce(null);

    const caller = await makeCaller();
    await expect(
      caller.updateUnitType({ id: UUID_UNIT_TYPE, name: 'Novo' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(mockSalesUnitType.update).not.toHaveBeenCalled();
  });

  it('atualiza + audit quando type é do tenant', async () => {
    mockSalesUnitType.findFirst.mockResolvedValueOnce({ id: UUID_UNIT_TYPE });
    mockSalesUnitType.update.mockResolvedValueOnce({ id: UUID_UNIT_TYPE, name: 'Novo' });

    const caller = await makeCaller();
    const out = await caller.updateUnitType({ id: UUID_UNIT_TYPE, name: 'Novo' });

    expect(out.name).toBe('Novo');
    expect(mockSalesUnitType.update).toHaveBeenCalledWith({
      where: { id: UUID_UNIT_TYPE },
      data: { name: 'Novo' },
    });
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sales_structure.unit_type_updated',
        recordId: UUID_UNIT_TYPE,
        tenantIdOverride: 'tenant-A',
      }),
    );
  });
});

describe('salesStructureRouter.deleteUnitType', () => {
  it('CONFLICT quando tipo em uso por unidades ativas', async () => {
    mockSalesUnitType.findFirst.mockResolvedValueOnce({ id: UUID_UNIT_TYPE });
    mockSalesUnit.count.mockResolvedValueOnce(3);

    const caller = await makeCaller();
    await expect(
      caller.deleteUnitType({ id: UUID_UNIT_TYPE }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(mockSalesUnitType.delete).not.toHaveBeenCalled();
  });

  it('exclui e audita quando não há unidades usando o tipo', async () => {
    mockSalesUnitType.findFirst.mockResolvedValueOnce({ id: UUID_UNIT_TYPE });
    mockSalesUnit.count.mockResolvedValueOnce(0);
    mockSalesUnitType.delete.mockResolvedValueOnce({ id: UUID_UNIT_TYPE });

    const caller = await makeCaller();
    const out = await caller.deleteUnitType({ id: UUID_UNIT_TYPE });

    expect(out.ok).toBe(true);
    expect(mockSalesUnitType.delete).toHaveBeenCalledWith({ where: { id: UUID_UNIT_TYPE } });
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sales_structure.unit_type_deleted',
        tenantIdOverride: 'tenant-A',
      }),
    );
  });
});

// ================================================================
// Units
// ================================================================

describe('salesStructureRouter.getTree', () => {
  it('delega ao Repository.getTree', async () => {
    repoGetTree.mockResolvedValueOnce([{ id: 'u1', path: 'root.abc', depth: 1 }]);

    const caller = await makeCaller();
    const out = await caller.getTree();

    expect(out.length).toBe(1);
    expect(repoGetTree).toHaveBeenCalledWith('tenant-A');
  });
});

describe('salesStructureRouter.getUnit', () => {
  it('NOT_FOUND cross-tenant', async () => {
    mockSalesUnit.findFirst.mockResolvedValueOnce(null);
    repoGetAncestors.mockResolvedValueOnce([]);
    repoGetChildren.mockResolvedValueOnce([]);

    const caller = await makeCaller();
    await expect(caller.getUnit({ id: UUID_UNIT })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('retorna { unit, ancestors, children } quando encontrado', async () => {
    mockSalesUnit.findFirst.mockResolvedValueOnce({
      id: UUID_UNIT,
      name: 'Equipe A',
      type: { name: 'Equipe', level: 1 },
      members: [
        {
          id: 'm1',
          role: 'MANAGER',
          user: { id: UUID_USER, fullName: 'Ana', email: 'a@x.co', role: 'GESTOR' },
        },
      ],
    });
    repoGetAncestors.mockResolvedValueOnce([{ id: 'ancestor-1' }]);
    repoGetChildren.mockResolvedValueOnce([{ id: 'child-1' }]);

    const caller = await makeCaller();
    const out = await caller.getUnit({ id: UUID_UNIT });

    expect(out.unit.id).toBe(UUID_UNIT);
    expect(out.ancestors.length).toBe(1);
    expect(out.children.length).toBe(1);
    expect(mockSalesUnit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: UUID_UNIT, tenantId: 'tenant-A', deletedAt: null },
      }),
    );
  });
});

describe('salesStructureRouter.createUnit — Emenda A7', () => {
  it('cross-tenant NOT_FOUND quando typeId não é do tenant', async () => {
    mockSalesUnitType.findFirst.mockResolvedValueOnce(null);

    const caller = await makeCaller();
    await expect(
      caller.createUnit({ typeId: UUID_UNIT_TYPE, name: 'Nova' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(repoCreate).not.toHaveBeenCalled();
  });

  it('cross-tenant NOT_FOUND quando parentId não é do tenant', async () => {
    mockSalesUnitType.findFirst.mockResolvedValueOnce({ id: UUID_UNIT_TYPE });
    mockSalesUnit.findFirst.mockResolvedValueOnce(null);

    const caller = await makeCaller();
    await expect(
      caller.createUnit({ typeId: UUID_UNIT_TYPE, name: 'Nova', parentId: UUID_PARENT }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(repoCreate).not.toHaveBeenCalled();
  });

  it('A7 CRÍTICO: delega ao Repository (nunca prisma direto) — path ltree calculado no Repository', async () => {
    mockSalesUnitType.findFirst.mockResolvedValueOnce({ id: UUID_UNIT_TYPE });
    mockSalesUnit.findFirst.mockResolvedValueOnce({ id: UUID_PARENT });
    repoCreate.mockResolvedValueOnce({
      id: 'new-unit',
      tenantId: 'tenant-A',
      typeId: UUID_UNIT_TYPE,
      name: 'Nova',
      shortId: 'abc',
      path: 'root.xyz.abc',
      depth: 2,
      parentId: UUID_PARENT,
    });

    const caller = await makeCaller();
    const out = await caller.createUnit({
      typeId: UUID_UNIT_TYPE,
      name: 'Nova',
      parentId: UUID_PARENT,
    });

    expect(out.id).toBe('new-unit');
    expect(repoCreate).toHaveBeenCalledWith({
      tenantId: 'tenant-A',
      typeId: UUID_UNIT_TYPE,
      name: 'Nova',
      parentId: UUID_PARENT,
    });
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sales_structure.unit_created',
        tenantIdOverride: 'tenant-A',
      }),
    );
  });

  it('parentId omitido vira null (nó raiz)', async () => {
    mockSalesUnitType.findFirst.mockResolvedValueOnce({ id: UUID_UNIT_TYPE });
    repoCreate.mockResolvedValueOnce({
      id: 'root-unit',
      tenantId: 'tenant-A',
      typeId: UUID_UNIT_TYPE,
      name: 'Raiz',
      shortId: 'abc',
      path: 'root.abc',
      depth: 1,
      parentId: null,
    });

    const caller = await makeCaller();
    await caller.createUnit({ typeId: UUID_UNIT_TYPE, name: 'Raiz' });

    expect(mockSalesUnit.findFirst).not.toHaveBeenCalled(); // parent check pulado
    expect(repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: null }),
    );
  });
});

describe('salesStructureRouter.deactivateUnit', () => {
  it('CONFLICT quando há subunidades ativas', async () => {
    mockSalesUnit.findFirst.mockResolvedValueOnce({ id: UUID_UNIT });
    mockSalesUnit.count.mockResolvedValueOnce(2);

    const caller = await makeCaller();
    await expect(
      caller.deactivateUnit({ id: UUID_UNIT }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(mockSalesUnit.update).not.toHaveBeenCalled();
  });

  it('soft delete + audit quando sem filhos ativos', async () => {
    mockSalesUnit.findFirst.mockResolvedValueOnce({ id: UUID_UNIT });
    mockSalesUnit.count.mockResolvedValueOnce(0);
    mockSalesUnit.update.mockResolvedValueOnce({ id: UUID_UNIT });

    const caller = await makeCaller();
    const out = await caller.deactivateUnit({ id: UUID_UNIT });

    expect(out.ok).toBe(true);
    expect(mockSalesUnit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: UUID_UNIT },
        data: expect.objectContaining({ active: false }),
      }),
    );
    // Verifica que deletedAt é populado com uma Date
    const updateCall = mockSalesUnit.update.mock.calls[0]![0]!;
    expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sales_structure.unit_deactivated',
        tenantIdOverride: 'tenant-A',
      }),
    );
  });
});

// ================================================================
// Members
// ================================================================

describe('salesStructureRouter.addMember', () => {
  it('delega ao Service com tenantId + assignedBy do ctx', async () => {
    svcAddMember.mockResolvedValueOnce(undefined);

    const caller = await makeCaller();
    const out = await caller.addMember({
      unitId: UUID_UNIT,
      userId: UUID_USER,
      role: 'MANAGER',
      isPrimary: true,
    });

    expect(out.ok).toBe(true);
    expect(svcAddMember).toHaveBeenCalledWith({
      tenantId: 'tenant-A',
      unitId: UUID_UNIT,
      userId: UUID_USER,
      role: 'MANAGER',
      isPrimary: true,
      assignedBy: 'admin-1',
    });
  });

  it('rejeita role inválido via Zod', async () => {
    const caller = await makeCaller();
    await expect(
      caller.addMember({
        unitId: UUID_UNIT,
        userId: UUID_USER,
        // @ts-expect-error — força role inválido
        role: 'OWNER',
      }),
    ).rejects.toBeDefined();
    expect(svcAddMember).not.toHaveBeenCalled();
  });
});

describe('salesStructureRouter.removeMember', () => {
  it('delega ao Service', async () => {
    svcRemoveMember.mockResolvedValueOnce(undefined);

    const caller = await makeCaller();
    const out = await caller.removeMember({
      unitId: UUID_UNIT,
      userId: UUID_USER,
    });

    expect(out.ok).toBe(true);
    expect(svcRemoveMember).toHaveBeenCalledWith({
      tenantId: 'tenant-A',
      unitId: UUID_UNIT,
      userId: UUID_USER,
    });
  });
});

// ================================================================
// Scope
// ================================================================

describe('salesStructureRouter.myScope', () => {
  it('delega ao Service.resolveOpportunityScope com user + tenantId', async () => {
    svcResolveScope.mockResolvedValueOnce({
      type: 'ALL',
      filter: { tenantId: 'tenant-A' },
    });

    const caller = await makeCaller();
    const out = await caller.myScope();

    expect(out.type).toBe('ALL');
    expect(svcResolveScope).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'admin-1',
        role: 'ADMIN',
        partnerCompanyId: null,
      }),
      'tenant-A',
    );
  });
});

// ================================================================
// RBAC — permissions guard
// ================================================================

describe('salesStructureRouter RBAC', () => {
  it('FORBIDDEN quando user não tem sales_structure:read (listUnitTypes)', async () => {
    hasPermissionMock.mockImplementation(async (_uid: string, perm: string) => {
      if (perm === 'sales_structure:read') return false;
      return true;
    });

    const caller = await makeCaller();
    await expect(caller.listUnitTypes()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mockSalesUnitType.findMany).not.toHaveBeenCalled();
  });

  it('FORBIDDEN quando user não tem sales_structure:manage (createUnitType)', async () => {
    hasPermissionMock.mockImplementation(async (_uid: string, perm: string) => {
      if (perm === 'sales_structure:manage') return false;
      return true;
    });

    const caller = await makeCaller();
    await expect(
      caller.createUnitType({ name: 'Regional', level: 2 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svcCreateUnitType).not.toHaveBeenCalled();
  });
});
