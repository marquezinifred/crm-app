import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TRPCError } from '@trpc/server';
import { buildAuthedCaller, cleanupTestUsers, type AuthedCallerHandle } from './fixtures/authed-caller';

/**
 * P-42 — Integração do backstop reformado com Opportunity.update.
 * P-44 — Refatorado pra chamar via `appRouter.createCaller` em vez de Prisma
 *        direto. Isso exercita Zod → RBAC (withPermission → hasPermission) →
 *        audit → Prisma extension → RLS, cobrindo o mesmo path que UI/API
 *        chamam em prod. Reproduz o payload real que
 *        `opportunities.update` monta em src/server/trpc/routers/opportunities.ts
 *        (`data: {...campos, updatedBy}`) sem `tenantId` — que antes disparava
 *        `Error("[tenant-isolation] Opportunity.update sem tenantId no payload")`
 *        e virava 500 no batch tRPC.
 *
 * Também confirma que a WHERE injection continua bloqueando updates
 * cross-tenant (row de tenant B não é afetada mesmo se update roda em ctx A),
 * e cobre novos cenários: create com tenantId injetado, list respeitando
 * visibilityWhere (ANALISTA sem `opportunity:read_others`), byId cross-tenant,
 * audit log gravado com `tenantIdOverride`, FORBIDDEN pra role sem permission.
 *
 * Pulado automaticamente quando DATABASE_URL_TEST não está setada.
 *
 * Como rodar:
 *   DATABASE_URL_TEST=postgresql://crm:crm_test_password@localhost:5432/crm_test \
 *     npm run test -- tests/integration/opportunities-update
 */

const TEST_DB = process.env.DATABASE_URL_TEST;
const describeIfDb = TEST_DB ? describe : describe.skip;

describeIfDb('Opportunity.update via createCaller (P-42 + P-44)', () => {
  let tenantA: string;
  let tenantB: string;
  let oppA: string;
  let oppB: string;
  let companyA: string;
  let companyB: string;
  let adminA: AuthedCallerHandle;
  let analistaA: AuthedCallerHandle;
  let diretorFinA: AuthedCallerHandle;
  let bootstrapUserA: string;
  let prismaModule: typeof import('@/server/db/client');
  let ctxModule: typeof import('@/server/db/tenant-context');

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    prismaModule = await import('@/server/db/client');
    ctxModule = await import('@/server/db/tenant-context');

    await ctxModule.runAsSystem(async () => {
      const a = await prismaModule.prisma.tenant.upsert({
        where: { slug: 'p42-p44-tenant-a' },
        update: {},
        create: { slug: 'p42-p44-tenant-a', name: 'P42/P44 Tenant A' },
      });
      const b = await prismaModule.prisma.tenant.upsert({
        where: { slug: 'p42-p44-tenant-b' },
        update: {},
        create: { slug: 'p42-p44-tenant-b', name: 'P42/P44 Tenant B' },
      });
      tenantA = a.id;
      tenantB = b.id;

      // User bootstrap serve só como ownerId inicial das opps seed.
      // Os users que exercem o caller são criados via buildAuthedCaller depois.
      const suffix = Date.now();
      const uBootstrap = await prismaModule.prisma.user.create({
        data: {
          tenantId: tenantA,
          email: `bootstrap+${suffix}@a.p44.test`,
          fullName: 'Bootstrap A',
          role: 'ADMIN',
        } as never,
      });
      bootstrapUserA = uBootstrap.id;

      const cA = await prismaModule.prisma.company.create({
        data: {
          tenantId: tenantA,
          razaoSocial: 'P44 Client A',
          type: 'CLIENT',
        } as never,
      });
      companyA = cA.id;

      const cB = await prismaModule.prisma.company.create({
        data: {
          tenantId: tenantB,
          razaoSocial: 'P44 Client B',
          type: 'CLIENT',
        } as never,
      });
      companyB = cB.id;

      const opA = await prismaModule.prisma.opportunity.create({
        data: {
          tenantId: tenantA,
          title: 'Opp A pra P-44',
          clientCompanyId: companyA,
          ownerId: bootstrapUserA,
          source: 'OUTBOUND',
          stage: 'LEAD',
          status: 'ACTIVE',
        } as never,
      });
      oppA = opA.id;

      const opB = await prismaModule.prisma.opportunity.create({
        data: {
          tenantId: tenantB,
          title: 'Opp B pra P-44',
          clientCompanyId: companyB,
          ownerId: bootstrapUserA, // fake ownership, cross-tenant só pra satisfazer FK
          source: 'OUTBOUND',
          stage: 'LEAD',
          status: 'ACTIVE',
        } as never,
      });
      oppB = opB.id;
    });

    // Callers são criados fora do `runAsSystem` pra evitar interação com
    // AsyncLocalStorage do sentinel de sistema — cada `buildAuthedCaller`
    // faz seu próprio `runAsSystem` internamente pra criar o user.
    adminA = await buildAuthedCaller({
      tenantId: tenantA,
      role: 'ADMIN',
      emailPrefix: 'admin-a',
    });
    analistaA = await buildAuthedCaller({
      tenantId: tenantA,
      role: 'ANALISTA',
      emailPrefix: 'analista-a',
    });
    diretorFinA = await buildAuthedCaller({
      tenantId: tenantA,
      role: 'DIRETOR_FINANCEIRO',
      emailPrefix: 'df-a',
    });
  });

  afterAll(async () => {
    if (!prismaModule) return;

    await ctxModule.runAsSystem(async () => {
      // audit_logs referenciam userId → deletar antes dos users.
      await prismaModule.prisma.auditLog.deleteMany({
        where: { tenantId: { in: [tenantA, tenantB] } },
      });
      await prismaModule.prisma.opportunityStageHistory.deleteMany({
        where: { tenantId: { in: [tenantA, tenantB] } },
      });
      await prismaModule.prisma.opportunity.deleteMany({
        where: { tenantId: { in: [tenantA, tenantB] } },
      });
      await prismaModule.prisma.company.deleteMany({
        where: { id: { in: [companyA, companyB] } },
      });
    });

    await cleanupTestUsers(
      [
        adminA?.userId,
        analistaA?.userId,
        diretorFinA?.userId,
        bootstrapUserA,
      ].filter(Boolean) as string[],
    );

    await ctxModule.runAsSystem(() =>
      prismaModule.prisma.tenant.deleteMany({
        where: { slug: { in: ['p42-p44-tenant-a', 'p42-p44-tenant-b'] } },
      }),
    );

    await prismaModule.prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Casos herdados do P-42 — refatorados pra caller tRPC (P-44)
  // ---------------------------------------------------------------------------

  it('caller: update com meetingScheduledAt + meetingHappened (regressão do bug 500)', async () => {
    const updated = await adminA.run(() =>
      adminA.caller.opportunities.update({
        id: oppA,
        meetingScheduledAt: new Date('2026-07-10T10:00:00Z'),
        meetingHappened: false,
      }),
    );
    expect(updated).toMatchObject({ id: oppA, meetingHappened: false });
    expect(updated.updatedBy).toBe(adminA.userId);
  });

  it('caller: update com apenas description continua funcionando', async () => {
    const updated = await adminA.run(() =>
      adminA.caller.opportunities.update({
        id: oppA,
        description: 'nota via caller p44',
      }),
    );
    expect(updated).toMatchObject({
      id: oppA,
      description: 'nota via caller p44',
    });
  });

  it('caller: update cross-tenant retorna NOT_FOUND (não 500)', async () => {
    // A procedure faz `findFirst({where: {id, deletedAt:null}})` — Prisma
    // extension injeta tenantId=A no WHERE, então oppB não é encontrado e
    // vira NOT_FOUND legível em vez de 500 cru.
    await expect(
      adminA.run(() =>
        adminA.caller.opportunities.update({
          id: oppB,
          description: 'invasão via caller',
        }),
      ),
    ).rejects.toMatchObject({
      name: 'TRPCError',
      code: 'NOT_FOUND',
    });
  });

  it('caller: Zod strip protege contra tenantId no payload — update procede em ctx tenant', async () => {
    // Zod default strip: payloads com `tenantId` extra (não declarado no
    // schema) são silenciosamente descartados. A row nunca é movida entre
    // tenants via caller. O backstop de `data.tenantId ≠ ctx` (P-42) fica
    // coberto por `tests/unit/tenant-backstop.test.ts` — aqui garantimos
    // que o path caller não chega até lá porque Zod bloqueia antes.
    const updated = await adminA.run(() =>
      adminA.caller.opportunities.update({
        id: oppA,
        // @ts-expect-error — tenantId não está no schema, Zod deve strippar
        tenantId: tenantB,
        description: 'tentativa de move via caller',
      }),
    );
    expect(updated.tenantId).toBe(tenantA);
  });

  // ---------------------------------------------------------------------------
  // Casos novos P-44 — cobrem o path completo (Zod → RBAC → audit → Prisma)
  // ---------------------------------------------------------------------------

  it('caller: create injeta tenantId do contexto automaticamente', async () => {
    const created = await adminA.run(() =>
      adminA.caller.opportunities.create({
        title: 'Nova opp via caller p44',
        clientCompanyId: companyA,
        ownerId: adminA.userId,
        source: 'OUTBOUND',
      }),
    );

    expect(created.tenantId).toBe(tenantA);
    expect(created.clientCompanyId).toBe(companyA);
    expect(created.stage).toBe('PROSPECT');

    const stageRow = await ctxModule.runAsSystem(() =>
      prismaModule.prisma.opportunityStageHistory.findFirst({
        where: { opportunityId: created.id },
      }),
    );
    expect(stageRow?.tenantId).toBe(tenantA);
    expect(stageRow?.toStage).toBe('PROSPECT');
  });

  it('caller: ANALISTA sem opportunity:read_others só enxerga próprias opps no list', async () => {
    // Cria uma opp de propriedade do ANALISTA para garantir contraste com
    // as seed (oppA + a criada no teste anterior por ADMIN).
    const ownOpp = await ctxModule.runAsSystem(() =>
      prismaModule.prisma.opportunity.create({
        data: {
          tenantId: tenantA,
          title: 'Opp própria do ANALISTA',
          clientCompanyId: companyA,
          ownerId: analistaA.userId,
          source: 'OUTBOUND',
          stage: 'LEAD',
          status: 'ACTIVE',
        } as never,
      }),
    );

    const result = await analistaA.run(() =>
      analistaA.caller.opportunities.list({ page: 1, pageSize: 50 }),
    );

    const ids = result.rows.map((r) => r.id);
    expect(ids).toContain(ownOpp.id);
    expect(ids).not.toContain(oppA); // owner = bootstrap, não a analista
  });

  it('caller: byId cross-tenant retorna NOT_FOUND', async () => {
    await expect(
      adminA.run(() => adminA.caller.opportunities.byId({ id: oppB })),
    ).rejects.toMatchObject({ name: 'TRPCError', code: 'NOT_FOUND' });
  });

  it('caller: update grava audit_log com tenantId correto (via tenantIdOverride)', async () => {
    // Update via caller aciona `audit({..., tenantIdOverride: ctx.tenantId})`
    // dentro da procedure — sem isso o AsyncLocalStorage do fetchRequestHandler
    // escapa e a entrada seria descartada silenciosamente com warn.
    // Bug arquitetural documentado em memory/audit-trpc-context-loss.md.
    await adminA.run(() =>
      adminA.caller.opportunities.update({
        id: oppA,
        description: 'update pra checar audit',
      }),
    );

    const auditRow = await ctxModule.runAsSystem(() =>
      prismaModule.prisma.auditLog.findFirst({
        where: {
          recordId: oppA,
          action: 'opportunity.update',
          tenantId: tenantA,
        },
        orderBy: { at: 'desc' },
      }),
    );

    expect(auditRow).not.toBeNull();
    expect(auditRow?.tenantId).toBe(tenantA);
    expect(auditRow?.userId).toBe(adminA.userId);
    expect(auditRow?.tableName).toBe('opportunities');
  });

  it('caller: DIRETOR_FINANCEIRO sem opportunity:update recebe FORBIDDEN', async () => {
    await expect(
      diretorFinA.run(() =>
        diretorFinA.caller.opportunities.update({
          id: oppA,
          description: 'DIRETOR_FINANCEIRO tentando update',
        }),
      ),
    ).rejects.toMatchObject({ name: 'TRPCError', code: 'FORBIDDEN' });
  });

  it('caller: DIRETOR_FINANCEIRO com opportunity:read consegue byId (verifica que FORBIDDEN é procedure-específico)', async () => {
    // Sanity check — se FORBIDDEN vazasse pra todas as procedures, este
    // teste também falharia. Confirma que withPermission é granular.
    const found = await diretorFinA.run(() =>
      diretorFinA.caller.opportunities.byId({ id: oppA }),
    );
    expect(found.id).toBe(oppA);
  });

  it('caller: TRPCError propaga como instância real (não Error genérico)', async () => {
    // Regressão do wrapper de mapErrors: quando o teste chama .rejects.toThrow
    // com regex, precisa ser TRPCError pra shape { code, message } ser útil.
    try {
      await adminA.run(() =>
        adminA.caller.opportunities.byId({ id: oppB }),
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('NOT_FOUND');
    }
  });
});
