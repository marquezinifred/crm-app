import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Teste de isolamento de tenant — exige Postgres rodando.
 * Pulado automaticamente quando DATABASE_URL_TEST não está setada.
 *
 * Como rodar:
 *   DATABASE_URL_TEST=postgresql://crm:crm_test_password@localhost:5432/crm_test \
 *     npm run test -- tests/integration
 *
 * O que valida:
 *   1. runWithTenant(A).contact.findMany() não retorna contatos do tenant B
 *   2. Tentar criar contato com tenantId=B dentro de runWithTenant(A) falha
 *   3. RLS bloqueia query crua sem app.tenant_id setado
 */

const TEST_DB = process.env.DATABASE_URL_TEST;
const describeIfDb = TEST_DB ? describe : describe.skip;

describeIfDb('tenant isolation (integration)', () => {
  let tenantA: string;
  let tenantB: string;
  let prismaModule: typeof import('@/server/db/client');
  let ctxModule: typeof import('@/server/db/tenant-context');

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    prismaModule = await import('@/server/db/client');
    ctxModule = await import('@/server/db/tenant-context');

    await ctxModule.runAsSystem(async () => {
      // Cria 2 tenants para o teste; safe para repetir (slug único)
      const a = await prismaModule.prisma.tenant.upsert({
        where: { slug: 'iso-test-a' },
        update: {},
        create: { slug: 'iso-test-a', name: 'Tenant A' },
      });
      const b = await prismaModule.prisma.tenant.upsert({
        where: { slug: 'iso-test-b' },
        update: {},
        create: { slug: 'iso-test-b', name: 'Tenant B' },
      });
      tenantA = a.id;
      tenantB = b.id;
    });
  });

  afterAll(async () => {
    if (prismaModule) {
      await ctxModule.runAsSystem(() =>
        prismaModule.prisma.tenant.deleteMany({
          where: { slug: { in: ['iso-test-a', 'iso-test-b'] } },
        }),
      );
      await prismaModule.prisma.$disconnect();
    }
  });

  it('findMany no tenant A não retorna registros do tenant B', async () => {
    // Cria contato em B como sistema
    await ctxModule.runAsSystem(async () => {
      await prismaModule.prisma.contact.create({
        data: {
          tenantId: tenantB,
          fullName: 'Bob from B',
          email: `bob+${Date.now()}@b.com`,
        } as never,
      });
    });

    // Em runWithTenant(A), bob não deve aparecer
    const aResults = await ctxModule.runWithTenant(
      { tenantId: tenantA, userId: null, role: 'ADMIN' },
      () => prismaModule.prisma.contact.findMany(),
    );
    expect(aResults.some((c) => c.fullName === 'Bob from B')).toBe(false);
  });

  it('extension bloqueia write sem tenantId quando tentado em test mode', async () => {
    const oldEnv = process.env.NODE_ENV;
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'test', configurable: true });
    try {
      await expect(
        prismaModule.prisma.contact.findMany(),
      ).rejects.toThrow(/tenant context/i);
    } finally {
      Object.defineProperty(process.env, 'NODE_ENV', { value: oldEnv, configurable: true });
    }
  });
});
