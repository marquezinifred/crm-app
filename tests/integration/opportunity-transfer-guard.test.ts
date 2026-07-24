import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * Sprint 15G.5 chip 2c (T2/T15/T19) — Integração do guard de transferência
 * com a Prisma extension REAL (`src/server/db/client.ts`).
 *
 * Exercita o choke point de verdade: kill-switch ligado, lookup via `base`
 * (client não-estendido, anti-recursão), leitura do valor COMMITADO de
 * current_transfer_id e as carve-outs da T19. Os testes unitários
 * (`transfer-write-guard.test.ts`) cobrem a decisão pura; aqui provamos que
 * a extension liga tudo corretamente contra um Postgres real.
 *
 * Pulado automaticamente quando DATABASE_URL_TEST não está setada. A flag
 * `OPPORTUNITY_TRANSFER_ENABLED` é forçada pra `true` no beforeAll via
 * `vi.resetModules()` + import dinâmico (a flag é lida no import do env).
 *
 * Como rodar:
 *   DATABASE_URL_TEST=postgresql://crm:crm_test_password@localhost:5432/crm_test \
 *     npm run test -- tests/integration/opportunity-transfer-guard
 */

const TEST_DB = process.env.DATABASE_URL_TEST;
const describeIfDb = TEST_DB ? describe : describe.skip;

// Mensagem genérica do guard (ForbiddenError → FORBIDDEN via mapErrors).
// Checamos por mensagem (matcher core) — robusto à identidade de classe que
// cruza a fronteira do vi.resetModules().
const FORBIDDEN_MSG = 'Seu perfil não tem acesso a esta operação.';

describeIfDb('Guard de transferência via extension real (T19)', () => {
  let prisma: typeof import('@/server/db/client').prisma;
  let runWithTenant: typeof import('@/server/db/tenant-context').runWithTenant;
  let runAsSystem: typeof import('@/server/db/tenant-context').runAsSystem;

  let tenant: string;
  let requester: string;
  let owner: string;
  let recipient: string;
  let company: string;
  let oppPending: string; // opp com transferência PENDING
  let oppFree: string; // opp sem transferência
  let transferId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.OPPORTUNITY_TRANSFER_ENABLED = 'true';
    // Força reparse do env (a flag é lida no import) + client fresco.
    vi.resetModules();
    const clientMod = await import('@/server/db/client');
    const ctxMod = await import('@/server/db/tenant-context');
    prisma = clientMod.prisma;
    runWithTenant = ctxMod.runWithTenant;
    runAsSystem = ctxMod.runAsSystem;

    await runAsSystem(async () => {
      const t = await prisma.tenant.upsert({
        where: { slug: 'g5-2c-guard-tenant' },
        update: {},
        create: { slug: 'g5-2c-guard-tenant', name: '15G5 2c Guard Tenant' },
      });
      tenant = t.id;

      const suffix = `${Date.now()}`;
      const mk = (prefix: string) =>
        prisma.user.create({
          data: {
            tenantId: tenant,
            email: `${prefix}+${suffix}@g52c.test`,
            fullName: `${prefix} 2c`,
            role: 'GESTOR',
          } as never,
        });
      requester = (await mk('requester')).id;
      owner = (await mk('owner')).id;
      recipient = (await mk('recipient')).id;

      const c = await prisma.company.create({
        data: { tenantId: tenant, razaoSocial: '2c Guard Client', type: 'CLIENT' } as never,
      });
      company = c.id;

      const mkOpp = (title: string) =>
        prisma.opportunity.create({
          data: {
            tenantId: tenant,
            title,
            clientCompanyId: company,
            ownerId: owner,
            source: 'OUTBOUND',
            stage: 'LEAD',
            status: 'ACTIVE',
          } as never,
        });
      oppPending = (await mkOpp('Opp PENDING 2c')).id;
      oppFree = (await mkOpp('Opp livre 2c')).id;

      // Transferência PENDING (disparador=requester) + seta a flag na opp.
      const transfer = await prisma.opportunityTransfer.create({
        data: {
          tenantId: tenant,
          opportunityId: oppPending,
          requestedById: requester,
          originalOwnerId: owner,
          targetManagerId: recipient,
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        } as never,
      });
      transferId = transfer.id;
      await prisma.opportunity.update({
        where: { id: oppPending },
        data: { currentTransferId: transferId },
      });
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await runAsSystem(async () => {
      await prisma.opportunity.updateMany({
        where: { tenantId: tenant },
        data: { currentTransferId: null },
      });
      await prisma.opportunityTransfer.deleteMany({ where: { tenantId: tenant } });
      await prisma.task.deleteMany({ where: { tenantId: tenant } });
      await prisma.auditLog.deleteMany({ where: { tenantId: tenant } });
      await prisma.opportunityStageHistory.deleteMany({ where: { tenantId: tenant } });
      await prisma.opportunity.deleteMany({ where: { tenantId: tenant } });
      await prisma.company.deleteMany({ where: { id: company } });
      await prisma.user.deleteMany({ where: { id: { in: [requester, owner, recipient] } } });
      await prisma.tenant.deleteMany({ where: { slug: 'g5-2c-guard-tenant' } });
    });
    await prisma.$disconnect();
  });

  const asUser = <T>(userId: string, fn: () => Promise<T>) =>
    runWithTenant({ tenantId: tenant, userId, role: 'GESTOR' }, fn);

  it('dono NÃO edita business field durante PENDING → ForbiddenError', async () => {
    await expect(
      asUser(owner, () =>
        prisma.opportunity.update({
          where: { id: oppPending },
          data: { description: 'tentativa do dono' },
        }),
      ),
    ).rejects.toThrow(FORBIDDEN_MSG);
  });

  it('dono NÃO cria task na opp durante PENDING → ForbiddenError', async () => {
    await expect(
      asUser(owner, () =>
        prisma.task.create({
          data: { tenantId: tenant, opportunityId: oppPending, title: 'task do dono' } as never,
        }),
      ),
    ).rejects.toThrow(FORBIDDEN_MSG);
  });

  it('disparador (requester) CONSEGUE editar durante PENDING', async () => {
    const updated = await asUser(requester, () =>
      prisma.opportunity.update({
        where: { id: oppPending },
        data: { description: 'nota do disparador' },
      }),
    );
    expect(updated.description).toBe('nota do disparador');
  });

  it('destinatário CONSEGUE approve (troca owner + zera currentTransferId) — carve-out T19a', async () => {
    const updated = await asUser(recipient, () =>
      prisma.opportunity.update({
        where: { id: oppPending },
        data: { ownerId: recipient, currentTransferId: null },
      }),
    );
    expect(updated.currentTransferId).toBeNull();
    expect(updated.ownerId).toBe(recipient);
    // Restaura o estado PENDING pros testes seguintes.
    await runAsSystem(async () => {
      await prisma.opportunity.update({
        where: { id: oppPending },
        data: { ownerId: owner, currentTransferId: transferId },
      });
    });
  });

  it('worker (runAsSystem, userId null) CONSEGUE zerar currentTransferId — T19b', async () => {
    const res = await runAsSystem(() =>
      prisma.opportunity.updateMany({
        where: { id: oppPending, currentTransferId: transferId },
        data: { currentTransferId: null },
      }),
    );
    expect(res.count).toBe(1);
    // Restaura.
    await runAsSystem(() =>
      prisma.opportunity.update({
        where: { id: oppPending },
        data: { currentTransferId: transferId },
      }),
    );
  });

  it('opp SEM transferência → dono edita livremente', async () => {
    const updated = await asUser(owner, () =>
      prisma.opportunity.update({
        where: { id: oppFree },
        data: { description: 'edição livre' },
      }),
    );
    expect(updated.description).toBe('edição livre');
  });

  it('reject (destinatário zera flag, owner inalterado) — carve-out T19a', async () => {
    // Simula o reject: mesma carve-out do approve (payload zera currentTransferId).
    const updated = await asUser(recipient, () =>
      prisma.opportunity.update({
        where: { id: oppPending },
        data: { currentTransferId: null },
      }),
    );
    expect(updated.currentTransferId).toBeNull();
    await runAsSystem(() =>
      prisma.opportunity.update({
        where: { id: oppPending },
        data: { currentTransferId: transferId },
      }),
    );
  });
});
