import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * P-42 — Integração do backstop reformado com Opportunity.update.
 *
 * Reproduz exatamente o payload que `opportunities.update` monta em
 * src/server/trpc/routers/opportunities.ts:204 (data: {...campos,
 * updatedBy}) sem `tenantId` — que antes disparava
 * `Error("[tenant-isolation] Opportunity.update sem tenantId no payload")`
 * e virava 500 no batch tRPC.
 *
 * Também confirma que a WHERE injection continua bloqueando updates
 * cross-tenant (row de tenant B não é afetada mesmo se update roda em ctx A).
 *
 * Pulado automaticamente quando DATABASE_URL_TEST não está setada.
 *
 * Como rodar:
 *   DATABASE_URL_TEST=postgresql://crm:crm_test_password@localhost:5432/crm_test \
 *     npm run test -- tests/integration/opportunities-update
 */

const TEST_DB = process.env.DATABASE_URL_TEST;
const describeIfDb = TEST_DB ? describe : describe.skip;

describeIfDb('Opportunity.update sem tenantId (P-42 regression)', () => {
  let tenantA: string;
  let tenantB: string;
  let oppA: string;
  let oppB: string;
  let userA: string;
  let companyA: string;
  let companyB: string;
  let prismaModule: typeof import('@/server/db/client');
  let ctxModule: typeof import('@/server/db/tenant-context');

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    prismaModule = await import('@/server/db/client');
    ctxModule = await import('@/server/db/tenant-context');

    await ctxModule.runAsSystem(async () => {
      const a = await prismaModule.prisma.tenant.upsert({
        where: { slug: 'p42-tenant-a' },
        update: {},
        create: { slug: 'p42-tenant-a', name: 'P42 Tenant A' },
      });
      const b = await prismaModule.prisma.tenant.upsert({
        where: { slug: 'p42-tenant-b' },
        update: {},
        create: { slug: 'p42-tenant-b', name: 'P42 Tenant B' },
      });
      tenantA = a.id;
      tenantB = b.id;

      const suffix = Date.now();
      const uA = await prismaModule.prisma.user.create({
        data: {
          tenantId: tenantA,
          email: `owner+${suffix}@a.p42.com`,
          fullName: 'Owner A',
          role: 'ADMIN',
        } as never,
      });
      userA = uA.id;

      const cA = await prismaModule.prisma.company.create({
        data: {
          tenantId: tenantA,
          razaoSocial: 'P42 Client A',
          type: 'CLIENT',
        } as never,
      });
      companyA = cA.id;

      const cB = await prismaModule.prisma.company.create({
        data: {
          tenantId: tenantB,
          razaoSocial: 'P42 Client B',
          type: 'CLIENT',
        } as never,
      });
      companyB = cB.id;

      const opA = await prismaModule.prisma.opportunity.create({
        data: {
          tenantId: tenantA,
          title: 'Opp A pra P-42',
          clientCompanyId: companyA,
          ownerId: userA,
          source: 'OUTBOUND',
          stage: 'LEAD',
          status: 'ACTIVE',
        } as never,
      });
      oppA = opA.id;

      const opB = await prismaModule.prisma.opportunity.create({
        data: {
          tenantId: tenantB,
          title: 'Opp B pra P-42',
          clientCompanyId: companyB,
          ownerId: userA, // fake, só pra satisfazer FK — teste não usa
          source: 'OUTBOUND',
          stage: 'LEAD',
          status: 'ACTIVE',
        } as never,
      });
      oppB = opB.id;
    });
  });

  afterAll(async () => {
    if (prismaModule) {
      await ctxModule.runAsSystem(async () => {
        await prismaModule.prisma.opportunity.deleteMany({
          where: { id: { in: [oppA, oppB] } },
        });
        await prismaModule.prisma.company.deleteMany({
          where: { id: { in: [companyA, companyB] } },
        });
        await prismaModule.prisma.user.deleteMany({
          where: { id: userA },
        });
        await prismaModule.prisma.tenant.deleteMany({
          where: { slug: { in: ['p42-tenant-a', 'p42-tenant-b'] } },
        });
      });
      await prismaModule.prisma.$disconnect();
    }
  });

  it('update com meetingScheduledAt + meetingHappened (regressão do bug 500)', async () => {
    // Payload igualzinho ao que a procedure `opportunities.update` monta:
    // data: { ...campos por estágio, updatedBy: ctx.user.id }
    await expect(
      ctxModule.runWithTenant(
        { tenantId: tenantA, userId: userA, role: 'ADMIN' },
        () =>
          prismaModule.prisma.opportunity.update({
            where: { id: oppA },
            data: {
              meetingScheduledAt: new Date('2026-07-10T10:00:00Z'),
              meetingHappened: false,
              updatedBy: userA,
            } as never,
          }),
      ),
    ).resolves.toMatchObject({
      id: oppA,
      meetingHappened: false,
    });
  });

  it('update simples sem campos de meeting continua funcionando', async () => {
    await expect(
      ctxModule.runWithTenant(
        { tenantId: tenantA, userId: userA, role: 'ADMIN' },
        () =>
          prismaModule.prisma.opportunity.update({
            where: { id: oppA },
            data: {
              description: 'nota qualquer',
              updatedBy: userA,
            } as never,
          }),
      ),
    ).resolves.toMatchObject({ id: oppA, description: 'nota qualquer' });
  });

  it('cross-tenant: update em ctx A na row do B falha com Prisma error (não 500 cru)', async () => {
    // WHERE injection acrescenta tenantId=A ao where, então a row de B
    // não é encontrada. Prisma joga `P2025` (An operation failed because
    // it depends on one or more records that were required but not found).
    await expect(
      ctxModule.runWithTenant(
        { tenantId: tenantA, userId: userA, role: 'ADMIN' },
        () =>
          prismaModule.prisma.opportunity.update({
            where: { id: oppB },
            data: {
              description: 'invasão!',
              updatedBy: userA,
            } as never,
          }),
      ),
    ).rejects.toThrow();
  });

  it('cross-tenant explícito: data.tenantId ≠ ctx dispara backstop', async () => {
    // Alguém malicioso monta o data com tenantId de outro tenant.
    // Backstop novo pega e throw explícito.
    await expect(
      ctxModule.runWithTenant(
        { tenantId: tenantA, userId: userA, role: 'ADMIN' },
        () =>
          prismaModule.prisma.opportunity.update({
            where: { id: oppA },
            data: {
              tenantId: tenantB,
              description: 'tentativa de mover row',
              updatedBy: userA,
            } as never,
          }),
      ),
    ).rejects.toThrow(/difere do contexto/);
  });
});
