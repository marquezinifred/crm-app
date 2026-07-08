// @vitest-environment node
//
// Sprint 15G Fase 4c — Seed demonstração da estrutura comercial.
// Testa a função pura `seedCommercialStructure` (extraída de
// `prisma/seed.ts` pra evitar side-effects). Cobre:
//   1. Cria 3 unit types com levels 1/2/3
//   2. Cria 4 units usando SalesUnitRepository.create (A7)
//   3. addMember chamado com role MANAGER pra DIRETOR/GESTOR e MEMBER
//      pra ANALISTA/ADMIN
//   4. Idempotência: rodar 2× consecutivas não gera duplicata
//
// Padrão do mock alinhado com `sales-structure-service.test.ts`
// (Fase 2a) — vi.hoisted() + mocks de Repository/Service.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??=
  'pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient, UserRole } from '@prisma/client';

const {
  mockPrisma,
  createUnitTypeMock,
  createUnitMock,
  addMemberMock,
} = vi.hoisted(() => ({
  mockPrisma: {
    salesUnitType: { findFirst: vi.fn() },
    salesUnit: { findFirst: vi.fn() },
  },
  createUnitTypeMock: vi.fn(),
  createUnitMock: vi.fn(),
  addMemberMock: vi.fn(async () => undefined),
}));

vi.mock('@/server/db/repositories/sales-unit.repository', () => ({
  SalesUnitRepository: { create: createUnitMock },
}));
vi.mock('@/server/services/sales-structure.service', () => ({
  SalesStructureService: {
    createUnitType: createUnitTypeMock,
    addMember: addMemberMock,
  },
}));

import { seedCommercialStructure } from '../../prisma/seed-commercial-structure';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ADMIN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DIRETOR_C = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const GESTOR_1 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const GESTOR_2 = 'cccccccc-cccc-cccc-cccc-ccccccccccc2';
const ANALISTA_1 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ANALISTA_2 = 'dddddddd-dddd-dddd-dddd-ddddddddddd2';
const ANALISTA_3 = 'dddddddd-dddd-dddd-dddd-ddddddddddd3';

// IDs deterministicos que os mocks devolvem — bate com ordem de chamada
// (dirType, regType, teamType, dirSul, regSP, teamEnterprise, teamMidMarket).
const DIR_TYPE_ID = '1000-type-diretoria';
const REG_TYPE_ID = '2000-type-regional';
const TEAM_TYPE_ID = '3000-type-equipe';
const DIR_SUL_ID = '4000-unit-dir-sul';
const REG_SP_ID = '5000-unit-reg-sp';
const TEAM_ENT_ID = '6000-unit-team-ent';
const TEAM_MM_ID = '7000-unit-team-mm';

function seedUsers(): Array<{ id: string; role: UserRole }> {
  return [
    { id: ADMIN, role: 'ADMIN' },
    { id: DIRETOR_C, role: 'DIRETOR_COMERCIAL' },
    { id: GESTOR_1, role: 'GESTOR' },
    { id: GESTOR_2, role: 'GESTOR' },
    { id: ANALISTA_1, role: 'ANALISTA' },
    { id: ANALISTA_2, role: 'ANALISTA' },
    { id: ANALISTA_3, role: 'ANALISTA' },
  ];
}

function primeCreatorsFreshRun() {
  // Fresh run: nenhum tipo/unit existe. createUnitType e create devolvem
  // ids únicos por ordem de invocação.
  mockPrisma.salesUnitType.findFirst.mockResolvedValue(null);
  mockPrisma.salesUnit.findFirst.mockResolvedValue(null);

  createUnitTypeMock
    .mockResolvedValueOnce({ id: DIR_TYPE_ID })
    .mockResolvedValueOnce({ id: REG_TYPE_ID })
    .mockResolvedValueOnce({ id: TEAM_TYPE_ID });

  createUnitMock
    .mockResolvedValueOnce({ id: DIR_SUL_ID })
    .mockResolvedValueOnce({ id: REG_SP_ID })
    .mockResolvedValueOnce({ id: TEAM_ENT_ID })
    .mockResolvedValueOnce({ id: TEAM_MM_ID });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('seedCommercialStructure — Sprint 15G Fase 4c', () => {
  it('cria 3 unit types com levels 1/2/3 na ordem canônica', async () => {
    primeCreatorsFreshRun();

    await seedCommercialStructure(
      mockPrisma as unknown as PrismaClient,
      TENANT,
      { id: ADMIN },
      seedUsers(),
    );

    expect(createUnitTypeMock).toHaveBeenCalledTimes(3);
    expect(createUnitTypeMock).toHaveBeenNthCalledWith(1, {
      tenantId: TENANT,
      name: 'Diretoria',
      level: 1,
      color: '#6366F1',
      icon: 'building-2',
    });
    expect(createUnitTypeMock).toHaveBeenNthCalledWith(2, {
      tenantId: TENANT,
      name: 'Regional',
      level: 2,
      color: '#10B981',
      icon: 'map-pin',
    });
    expect(createUnitTypeMock).toHaveBeenNthCalledWith(3, {
      tenantId: TENANT,
      name: 'Equipe',
      level: 3,
      color: '#F59E0B',
      icon: 'users',
    });
  });

  it('cria 4 units via SalesUnitRepository.create respeitando hierarquia (A7)', async () => {
    primeCreatorsFreshRun();

    await seedCommercialStructure(
      mockPrisma as unknown as PrismaClient,
      TENANT,
      { id: ADMIN },
      seedUsers(),
    );

    expect(createUnitMock).toHaveBeenCalledTimes(4);
    // Diretoria Sul: raiz (parentId=null), typeId=Diretoria
    expect(createUnitMock).toHaveBeenNthCalledWith(1, {
      tenantId: TENANT,
      typeId: DIR_TYPE_ID,
      name: 'Diretoria Sul',
      parentId: null,
    });
    // Regional SP: filha de Diretoria Sul, typeId=Regional
    expect(createUnitMock).toHaveBeenNthCalledWith(2, {
      tenantId: TENANT,
      typeId: REG_TYPE_ID,
      name: 'Regional SP',
      parentId: DIR_SUL_ID,
    });
    // Equipe Enterprise: filha de Regional SP, typeId=Equipe
    expect(createUnitMock).toHaveBeenNthCalledWith(3, {
      tenantId: TENANT,
      typeId: TEAM_TYPE_ID,
      name: 'Equipe Enterprise',
      parentId: REG_SP_ID,
    });
    // Equipe Mid-Market: também filha de Regional SP
    expect(createUnitMock).toHaveBeenNthCalledWith(4, {
      tenantId: TENANT,
      typeId: TEAM_TYPE_ID,
      name: 'Equipe Mid-Market',
      parentId: REG_SP_ID,
    });
  });

  it('addMember chama MANAGER pra DIRETOR/GESTOR e MEMBER pra ANALISTA/ADMIN', async () => {
    primeCreatorsFreshRun();

    await seedCommercialStructure(
      mockPrisma as unknown as PrismaClient,
      TENANT,
      { id: ADMIN },
      seedUsers(),
    );

    // Esperado: 1 DIRETOR + 1 GESTOR (só o primeiro) + 3 ANALISTAs + 1 ADMIN = 6
    expect(addMemberMock).toHaveBeenCalledTimes(6);

    // DIRETOR_COMERCIAL → Diretoria Sul como MANAGER isPrimary
    expect(addMemberMock).toHaveBeenNthCalledWith(1, {
      unitId: DIR_SUL_ID,
      userId: DIRETOR_C,
      role: 'MANAGER',
      tenantId: TENANT,
      assignedBy: ADMIN,
      isPrimary: true,
    });

    // GESTOR (primeiro só) → Regional SP como MANAGER isPrimary
    expect(addMemberMock).toHaveBeenNthCalledWith(2, {
      unitId: REG_SP_ID,
      userId: GESTOR_1,
      role: 'MANAGER',
      tenantId: TENANT,
      assignedBy: ADMIN,
      isPrimary: true,
    });

    // ANALISTA_1 (i=0, par) → Enterprise MEMBER isPrimary
    expect(addMemberMock).toHaveBeenNthCalledWith(3, {
      unitId: TEAM_ENT_ID,
      userId: ANALISTA_1,
      role: 'MEMBER',
      tenantId: TENANT,
      assignedBy: ADMIN,
      isPrimary: true,
    });

    // ANALISTA_2 (i=1, ímpar) → Mid-Market MEMBER isPrimary
    expect(addMemberMock).toHaveBeenNthCalledWith(4, {
      unitId: TEAM_MM_ID,
      userId: ANALISTA_2,
      role: 'MEMBER',
      tenantId: TENANT,
      assignedBy: ADMIN,
      isPrimary: true,
    });

    // ANALISTA_3 (i=2, par) → Enterprise
    expect(addMemberMock).toHaveBeenNthCalledWith(5, {
      unitId: TEAM_ENT_ID,
      userId: ANALISTA_3,
      role: 'MEMBER',
      tenantId: TENANT,
      assignedBy: ADMIN,
      isPrimary: true,
    });

    // ADMIN → Diretoria Sul MEMBER SEM isPrimary (observador da árvore)
    expect(addMemberMock).toHaveBeenNthCalledWith(6, {
      unitId: DIR_SUL_ID,
      userId: ADMIN,
      role: 'MEMBER',
      tenantId: TENANT,
      assignedBy: ADMIN,
      isPrimary: false,
    });
  });

  it('idempotência — 2ª chamada não gera duplicatas (skip create quando findFirst hit)', async () => {
    // 1ª rodada: fresh (nada existe).
    primeCreatorsFreshRun();
    await seedCommercialStructure(
      mockPrisma as unknown as PrismaClient,
      TENANT,
      { id: ADMIN },
      seedUsers(),
    );

    expect(createUnitTypeMock).toHaveBeenCalledTimes(3);
    expect(createUnitMock).toHaveBeenCalledTimes(4);

    // Reseta contadores mas mantém o padrão de retorno via findFirst — agora
    // simula: tudo já existe no banco.
    createUnitTypeMock.mockClear();
    createUnitMock.mockClear();
    addMemberMock.mockClear();

    // 2ª rodada: findFirst retorna as rows existentes (pré-check hit).
    mockPrisma.salesUnitType.findFirst
      .mockResolvedValueOnce({ id: DIR_TYPE_ID })
      .mockResolvedValueOnce({ id: REG_TYPE_ID })
      .mockResolvedValueOnce({ id: TEAM_TYPE_ID });
    mockPrisma.salesUnit.findFirst
      .mockResolvedValueOnce({ id: DIR_SUL_ID })
      .mockResolvedValueOnce({ id: REG_SP_ID })
      .mockResolvedValueOnce({ id: TEAM_ENT_ID })
      .mockResolvedValueOnce({ id: TEAM_MM_ID });

    await seedCommercialStructure(
      mockPrisma as unknown as PrismaClient,
      TENANT,
      { id: ADMIN },
      seedUsers(),
    );

    // Idempotência: createUnitType e create NÃO foram chamados de novo.
    expect(createUnitTypeMock).not.toHaveBeenCalled();
    expect(createUnitMock).not.toHaveBeenCalled();
    // addMember é upsert por (userId, unitId) via Service.addMember —
    // seguro chamar de novo (Service faz a atualização vs criação).
    expect(addMemberMock).toHaveBeenCalledTimes(6);
  });

  it('sem DIRETOR_COMERCIAL nos users, addMember pula esse vínculo sem quebrar', async () => {
    primeCreatorsFreshRun();

    const usersSemDiretor = seedUsers().filter(
      (u) => u.role !== 'DIRETOR_COMERCIAL',
    );

    await seedCommercialStructure(
      mockPrisma as unknown as PrismaClient,
      TENANT,
      { id: ADMIN },
      usersSemDiretor,
    );

    // 1 GESTOR + 3 ANALISTAs + 1 ADMIN = 5 (sem o DIRETOR)
    expect(addMemberMock).toHaveBeenCalledTimes(5);
    // Nenhuma chamada com role MANAGER + unitId Diretoria Sul
    const calls = addMemberMock.mock.calls as unknown as Array<
      [{ unitId: string; role: string }]
    >;
    const chamadasDiretoria = calls.filter(
      (call) => call[0].unitId === DIR_SUL_ID && call[0].role === 'MANAGER',
    );
    expect(chamadasDiretoria).toHaveLength(0);
  });
});
