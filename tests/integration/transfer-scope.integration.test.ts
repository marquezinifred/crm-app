import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Sprint 15G.5 Fase 1b (integration) — `SalesUnitRepository.resolveTransferTargets`
 * contra estrutura ltree real. Prova a semântica T14 que os testes de shape de
 * SQL (mock `$queryRaw`) não conseguem: irmãs (mesmo `parent_id`) + pai
 * (`id = parent_id`), UNIÃO por membership no multi-membership, exclusão de
 * subordinados/self, e o filtro de user ativo.
 *
 * ⚠️ Prova T13 concretamente: TODOS os users recebem `users.role='ANALISTA'`.
 * A autoridade emerge SÓ de `sales_unit_members.role='MANAGER'` + posição ltree
 * — se a query indexasse por `users.role`, o resultado seria vazio.
 *
 * Pulado automaticamente quando DATABASE_URL_TEST não está setada.
 *
 * Como rodar:
 *   DATABASE_URL_TEST=postgresql://crm:crm_test_password@localhost:5432/crm_test \
 *     npm run test -- tests/integration/transfer-scope
 */

const TEST_DB = process.env.DATABASE_URL_TEST;
const describeIfDb = TEST_DB ? describe : describe.skip;

describeIfDb('SalesUnitRepository.resolveTransferTargets (integração ltree)', () => {
  let prismaModule: typeof import('@/server/db/client');
  let ctxModule: typeof import('@/server/db/tenant-context');
  let repoModule: typeof import('@/server/db/repositories/sales-unit.repository');

  let tenantId: string;
  const ids = {
    caller: '',
    managerR1: '',
    managerB1: '',
    managerB1Inactive: '',
    managerR2: '',
    managerB2: '',
    analistaA1: '',
  };

  const SLUG = `t15g5-1b-${Date.now()}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    prismaModule = await import('@/server/db/client');
    ctxModule = await import('@/server/db/tenant-context');
    repoModule = await import('@/server/db/repositories/sales-unit.repository');
    const { prisma } = prismaModule;
    const { runAsSystem } = ctxModule;
    const { SalesUnitRepository } = repoModule;

    await runAsSystem(async () => {
      const tenant = await prisma.tenant.upsert({
        where: { slug: SLUG },
        update: {},
        create: { slug: SLUG, name: '15G.5 Fase 1b' },
      });
      tenantId = tenant.id;

      // Um único tipo serve pra todos os nós — o repo não valida level vs depth.
      const type = await prisma.salesUnitType.create({
        data: { tenantId, name: 'Unidade', level: 1 } as never,
      });

      // Duas subárvores disjuntas pra provar a UNIÃO no multi-membership.
      const r1 = await SalesUnitRepository.create({ tenantId, typeId: type.id, name: 'R1', parentId: null });
      const a1 = await SalesUnitRepository.create({ tenantId, typeId: type.id, name: 'A1', parentId: r1.id });
      const b1 = await SalesUnitRepository.create({ tenantId, typeId: type.id, name: 'B1', parentId: r1.id });
      const r2 = await SalesUnitRepository.create({ tenantId, typeId: type.id, name: 'R2', parentId: null });
      const a2 = await SalesUnitRepository.create({ tenantId, typeId: type.id, name: 'A2', parentId: r2.id });
      const b2 = await SalesUnitRepository.create({ tenantId, typeId: type.id, name: 'B2', parentId: r2.id });

      // T13: users.role = ANALISTA de propósito — a autoridade vem da membership.
      const mkUser = async (label: string, active = true) => {
        const u = await prisma.user.create({
          data: {
            tenantId,
            email: `${label}.${SLUG}@transfer.test`,
            fullName: label,
            role: 'ANALISTA',
            active,
          } as never,
        });
        return u.id;
      };

      ids.caller = await mkUser('caller');
      ids.managerR1 = await mkUser('managerR1');
      ids.managerB1 = await mkUser('managerB1');
      ids.managerB1Inactive = await mkUser('managerB1Inactive', false);
      ids.managerR2 = await mkUser('managerR2');
      ids.managerB2 = await mkUser('managerB2');
      ids.analistaA1 = await mkUser('analistaA1');

      const mkMember = (userId: string, unitId: string, role: 'MANAGER' | 'MEMBER') =>
        prisma.salesUnitMember.create({
          data: { tenantId, userId, unitId, role } as never,
        });

      // caller gerencia A1 e A2 (multi-membership em subárvores disjuntas).
      await mkMember(ids.caller, a1.id, 'MANAGER');
      await mkMember(ids.caller, a2.id, 'MANAGER');
      // pais e irmãs.
      await mkMember(ids.managerR1, r1.id, 'MANAGER');
      await mkMember(ids.managerB1, b1.id, 'MANAGER');
      await mkMember(ids.managerB1Inactive, b1.id, 'MANAGER'); // inativo → excluído
      await mkMember(ids.managerR2, r2.id, 'MANAGER');
      await mkMember(ids.managerB2, b2.id, 'MANAGER');
      // subordinado (MEMBER de uma unidade gerida pelo caller) → nunca alvo.
      await mkMember(ids.analistaA1, a1.id, 'MEMBER');
    });
  });

  afterAll(async () => {
    if (!TEST_DB || !prismaModule) return;
    // CASCADE do tenant remove units/members/users seedados.
    await ctxModule.runAsSystem(() =>
      prismaModule.prisma.tenant.deleteMany({ where: { slug: SLUG } }),
    );
    await prismaModule.prisma.$disconnect();
  });

  it('une irmãs + pai das DUAS subárvores geridas (tie-break multi-membership T14)', async () => {
    const { SalesUnitRepository } = repoModule;
    const targets = await ctxModule.runAsSystem(() =>
      SalesUnitRepository.resolveTransferTargets(ids.caller, tenantId),
    );

    // {managerB1, managerR1} vêm de A1; {managerB2, managerR2} vêm de A2.
    expect(new Set(targets)).toEqual(
      new Set([ids.managerB1, ids.managerR1, ids.managerB2, ids.managerR2]),
    );
  });

  it('exclui o próprio caller, subordinados (MEMBER) e managers inativos', async () => {
    const { SalesUnitRepository } = repoModule;
    const targets = await ctxModule.runAsSystem(() =>
      SalesUnitRepository.resolveTransferTargets(ids.caller, tenantId),
    );

    expect(targets).not.toContain(ids.caller); // não é alvo de si mesmo
    expect(targets).not.toContain(ids.analistaA1); // subordinado ≠ transferência
    expect(targets).not.toContain(ids.managerB1Inactive); // inativo filtrado
  });

  it('user sem membership MANAGER → sem targets (autoridade é estrutural, T13)', async () => {
    const { SalesUnitRepository } = repoModule;
    // analistaA1 é MEMBER, nunca MANAGER → não dispara, sem alvos.
    const targets = await ctxModule.runAsSystem(() =>
      SalesUnitRepository.resolveTransferTargets(ids.analistaA1, tenantId),
    );
    expect(targets).toEqual([]);
  });
});
