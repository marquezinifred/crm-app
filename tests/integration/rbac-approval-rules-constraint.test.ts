// AC-21 (integration) — Postgres CHECK constraint XOR de approval_rules.
//
// Exige DATABASE_URL_TEST. Executa contra banco real e testa que INSERTs
// violando XOR (nem ambos, nem nenhum) falham com erro de constraint.
//
// TODO(Sprint 15E): remover describe.skip após merge da migration 0030.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const TEST_DB = process.env.DATABASE_URL_TEST;
const describeIfDb = TEST_DB ? describe.skip : describe.skip;

describeIfDb('AC-21 (integration) — approval_rules CHECK XOR constraint', () => {
  let prismaModule: typeof import('@/server/db/client');
  let ctxModule: typeof import('@/server/db/tenant-context');
  let tenantId: string;

  beforeAll(async () => {
    if (!TEST_DB) return;
    process.env.DATABASE_URL = TEST_DB;
    prismaModule = await import('@/server/db/client');
    ctxModule = await import('@/server/db/tenant-context');

    await ctxModule.runAsSystem(async () => {
      const t = await prismaModule.prisma.tenant.upsert({
        where: { slug: 'iso-15e-a' },
        update: {},
        create: { slug: 'iso-15e-a', name: 'Tenant 15E A' },
      });
      tenantId = t.id;
    });
  });

  afterAll(async () => {
    if (!TEST_DB || !prismaModule) return;
    await ctxModule.runAsSystem(() =>
      prismaModule.prisma.tenant.deleteMany({ where: { slug: 'iso-15e-a' } }),
    );
    await prismaModule.prisma.$disconnect();
  });

  it('INSERT com approver_roles preenchido + approver_permission null → sucesso', async () => {
    await ctxModule.runAsSystem(async () => {
      const rule = await prismaModule.prisma.approvalRule.create({
        data: {
          tenantId,
          name: 'test-only-roles',
          criteria: 'UNIVERSAL',
          approverRoles: ['DIRETOR_COMERCIAL'] as never,
          approverPermission: null,
          enabled: true,
        } as never,
      });
      expect(rule.id).toBeDefined();
    });
  });

  it('INSERT com approver_permission preenchido + approver_roles null → sucesso', async () => {
    await ctxModule.runAsSystem(async () => {
      const rule = await prismaModule.prisma.approvalRule.create({
        data: {
          tenantId,
          name: 'test-only-permission',
          criteria: 'UNIVERSAL',
          approverRoles: null,
          approverPermission: 'proposal:approve',
          enabled: true,
        } as never,
      });
      expect(rule.id).toBeDefined();
    });
  });

  it('INSERT com AMBOS setados → ERROR (CHECK constraint XOR)', async () => {
    await expect(
      ctxModule.runAsSystem(() =>
        prismaModule.prisma.approvalRule.create({
          data: {
            tenantId,
            name: 'test-both-set',
            criteria: 'UNIVERSAL',
            approverRoles: ['DIRETOR_COMERCIAL'] as never,
            approverPermission: 'proposal:approve',
            enabled: true,
          } as never,
        }),
      ),
    ).rejects.toThrow(/approval_rules_approver_check|constraint/i);
  });

  it('INSERT com AMBOS null → ERROR (CHECK constraint XOR)', async () => {
    await expect(
      ctxModule.runAsSystem(() =>
        prismaModule.prisma.approvalRule.create({
          data: {
            tenantId,
            name: 'test-neither-set',
            criteria: 'UNIVERSAL',
            approverRoles: null,
            approverPermission: null,
            enabled: true,
          } as never,
        }),
      ),
    ).rejects.toThrow(/approval_rules_approver_check|constraint/i);
  });

  it('INSERT com approver_roles: [] (array vazio) → ERROR (equivalente a null)', async () => {
    await expect(
      ctxModule.runAsSystem(() =>
        prismaModule.prisma.approvalRule.create({
          data: {
            tenantId,
            name: 'test-empty-array',
            criteria: 'UNIVERSAL',
            approverRoles: [] as never,
            approverPermission: null,
            enabled: true,
          } as never,
        }),
      ),
    ).rejects.toThrow(/approval_rules_approver_check|constraint/i);
  });
});
