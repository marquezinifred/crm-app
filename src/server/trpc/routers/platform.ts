import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { clerkClient } from '@clerk/nextjs/server';
import { router, platformProcedure } from '@/server/trpc/trpc';
import { prisma } from '@/server/db/client';
import { runAsPlatform } from '@/server/db/tenant-context';
import { platformAudit } from '@/server/services/audit-platform.service';
import { zCnpj, zEmail, zSlug, zUuid } from '@/lib/validators';
import { Prisma, TenantPlan, SubscriptionStatus } from '@prisma/client';

/**
 * platformRouter — Sprint 15A.
 *
 * Procedures exclusivas para `PLATFORM_OWNER`. Cada mutação roda em
 * `runAsPlatform` para bypassar a injeção de tenant da Prisma extension,
 * e grava audit logs com `metadata.platform_user_id` para rastreabilidade.
 *
 * Domínios:
 *  - dashboard: métricas agregadas cross-tenant
 *  - tenants: CRUD + suspender/reativar + métricas por tenant
 *  - impersonate: gerar/encerrar sessão como admin de um tenant alvo
 *  - audit: cross-tenant audit log
 *  - privacy: cross-tenant fila LGPD
 *  - featureFlags: lista + override por tenant
 */

const tenantCreateInput = z.object({
  name: z.string().min(2).max(120),
  slug: zSlug,
  razaoSocial: z.string().min(2).max(160),
  cnpj: zCnpj,
  plan: z.nativeEnum(TenantPlan).default('TRIAL'),
  firstAdminEmail: zEmail,
  firstAdminName: z.string().min(2).max(160),
});

export const platformRouter = router({
  me: platformProcedure.query(({ ctx }) => ({
    id: ctx.platformUser.id,
    email: ctx.platformUser.email,
    fullName: ctx.platformUser.fullName,
    role: ctx.platformRole,
  })),

  /* ============================================================ */
  /*                          DASHBOARD                           */
  /* ============================================================ */

  dashboard: platformProcedure.query(async ({ ctx }) => {
    return runAsPlatform(ctx.platformUser.id, async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const next7d = new Date(now.getTime() + 7 * 86_400_000);

      const [
        tenantsByPlan,
        activeSubs,
        aiTokens,
        privacyPending,
        trialsExpiring,
      ] = await Promise.all([
        prisma.tenant.groupBy({
          by: ['plan'],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
        prisma.tenant.findMany({
          where: { subscriptionStatus: 'ACTIVE', deletedAt: null },
          select: { plan: true },
        }),
        prisma.aIUsageLog.aggregate({
          where: { createdAt: { gte: monthStart } },
          _sum: { totalTokens: true, costUsd: true },
        }),
        prisma.dataSubjectRequest.count({
          where: { status: { in: ['PENDING', 'IN_PROGRESS'] }, deletedAt: null },
        }),
        prisma.tenant.count({
          where: {
            subscriptionStatus: 'TRIALING',
            trialEndsAt: { gte: now, lte: next7d },
            deletedAt: null,
          },
        }),
      ]);

      // MRR aproximado a partir de plan tiers (Sprint 12 não persiste valor)
      const PLAN_MRR_BRL: Record<TenantPlan, number> = {
        TRIAL: 0,
        STARTER: 199,
        PRO: 599,
        ENTERPRISE: 2499,
      };
      const mrrBrl = activeSubs.reduce(
        (acc, t) => acc + (PLAN_MRR_BRL[t.plan] ?? 0),
        0,
      );

      const tenantsCountByPlan: Record<string, number> = {};
      let totalTenants = 0;
      for (const row of tenantsByPlan) {
        tenantsCountByPlan[row.plan] = row._count._all;
        totalTenants += row._count._all;
      }

      return {
        tenants: { total: totalTenants, byPlan: tenantsCountByPlan },
        mrrBrl,
        aiTokensMonth: aiTokens._sum.totalTokens ?? 0,
        aiCostUsdMonth: Number(aiTokens._sum.costUsd ?? 0),
        privacyRequestsPending: privacyPending,
        trialsExpiring7d: trialsExpiring,
      };
    });
  }),

  /* ============================================================ */
  /*                            TENANTS                           */
  /* ============================================================ */

  tenantsList: platformProcedure
    .input(
      z
        .object({
          search: z.string().max(80).optional(),
          plan: z.nativeEnum(TenantPlan).optional(),
          status: z.nativeEnum(SubscriptionStatus).optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        const where: Prisma.TenantWhereInput = {
          deletedAt: null,
          ...(input.plan ? { plan: input.plan } : {}),
          ...(input.status ? { subscriptionStatus: input.status } : {}),
          ...(input.search
            ? {
                OR: [
                  { name: { contains: input.search, mode: 'insensitive' } },
                  { slug: { contains: input.search, mode: 'insensitive' } },
                ],
              }
            : {}),
        };
        return prisma.tenant.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: {
            id: true,
            name: true,
            slug: true,
            plan: true,
            subscriptionStatus: true,
            trialEndsAt: true,
            currentPeriodEnd: true,
            setupCompletedAt: true,
            createdAt: true,
            _count: { select: { users: true, opportunities: true } },
          },
        });
      }),
    ),

  tenantById: platformProcedure
    .input(z.object({ id: zUuid }))
    .query(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        const tenant = await prisma.tenant.findUnique({
          where: { id: input.id },
          include: {
            settings: true,
            _count: {
              select: {
                users: true,
                companies: true,
                contacts: true,
                opportunities: true,
                contracts: true,
              },
            },
          },
        });
        if (!tenant) throw new TRPCError({ code: 'NOT_FOUND' });

        const [members, recentEvents, aiUsage] = await Promise.all([
          prisma.user.findMany({
            where: { tenantId: tenant.id, deletedAt: null },
            select: {
              id: true,
              email: true,
              fullName: true,
              role: true,
              active: true,
              lastLoginAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
          }),
          prisma.billingEvent.findMany({
            where: { tenantId: tenant.id },
            orderBy: { processedAt: 'desc' },
            take: 20,
          }),
          prisma.aIUsageLog.aggregate({
            where: {
              tenantId: tenant.id,
              createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
            },
            _sum: { totalTokens: true, costUsd: true },
          }),
        ]);

        return {
          tenant,
          members,
          recentBillingEvents: recentEvents,
          aiUsage30d: {
            tokens: aiUsage._sum.totalTokens ?? 0,
            costUsd: Number(aiUsage._sum.costUsd ?? 0),
          },
        };
      }),
    ),

  tenantCreate: platformProcedure
    .input(tenantCreateInput)
    .mutation(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        const slugTaken = await prisma.tenant.findUnique({
          where: { slug: input.slug },
          select: { id: true },
        });
        if (slugTaken) throw new TRPCError({ code: 'CONFLICT', message: 'Slug já em uso' });

        const created = await prisma.tenant.create({
          data: {
            name: input.name,
            slug: input.slug,
            plan: input.plan,
            trialEndsAt:
              input.plan === 'TRIAL'
                ? new Date(Date.now() + 14 * 86_400_000)
                : null,
          },
        });

        await prisma.company.create({
          data: {
            tenantId: created.id,
            type: 'OWN',
            razaoSocial: input.razaoSocial,
            cnpj: input.cnpj,
            country: 'BR',
          } as Prisma.CompanyUncheckedCreateInput,
        });

        const adminLocal = await prisma.user.create({
          data: {
            tenantId: created.id,
            email: input.firstAdminEmail,
            fullName: input.firstAdminName,
            role: 'ADMIN',
            active: false,
          } as Prisma.UserUncheckedCreateInput,
        });

        try {
          await clerkClient().invitations.createInvitation({
            emailAddress: input.firstAdminEmail,
            publicMetadata: {
              tenantId: created.id,
              role: 'ADMIN',
              localUserId: adminLocal.id,
            },
            redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/`,
          });
        } catch (err) {
          // Mantém estado: tenant + user existem mesmo se Clerk falhar
          // — admin pode reinvitar pela UI depois.
          console.error('[platform.tenantCreate] Clerk invite falhou', err);
        }

        await platformAudit({
          platformUserId: ctx.platformUser.id,
          action: 'platform.tenant.create',
          tableName: 'tenants',
          recordId: created.id,
          after: { name: created.name, slug: created.slug, plan: created.plan },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });

        return { id: created.id, slug: created.slug };
      }),
    ),

  tenantSuspend: platformProcedure
    .input(z.object({ id: zUuid, reason: z.string().min(3).max(500) }))
    .mutation(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        const before = await prisma.tenant.findUnique({ where: { id: input.id } });
        if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
        const updated = await prisma.tenant.update({
          where: { id: input.id },
          data: { deletedAt: new Date() },
        });
        await platformAudit({
          platformUserId: ctx.platformUser.id,
          action: 'platform.tenant.suspend',
          tableName: 'tenants',
          recordId: input.id,
          tenantIdOverride: input.id,
          before,
          after: { ...updated, reason: input.reason },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
        return { ok: true };
      }),
    ),

  tenantUnsuspend: platformProcedure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        const tenant = await prisma.tenant.update({
          where: { id: input.id },
          data: { deletedAt: null },
        });
        await platformAudit({
          platformUserId: ctx.platformUser.id,
          action: 'platform.tenant.unsuspend',
          tableName: 'tenants',
          recordId: input.id,
          tenantIdOverride: input.id,
          after: tenant,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
        return { ok: true };
      }),
    ),

  /* ============================================================ */
  /*                         IMPERSONATE                          */
  /* ============================================================ */

  impersonateStart: platformProcedure
    .input(z.object({ tenantId: zUuid, asUserId: zUuid }))
    .mutation(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        const target = await prisma.user.findFirst({
          where: { id: input.asUserId, tenantId: input.tenantId, deletedAt: null },
          select: { id: true, email: true, fullName: true, role: true, tenantId: true, clerkId: true },
        });
        if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuário alvo não encontrado' });
        if (!target.clerkId) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Usuário alvo ainda não aceitou convite Clerk — sem clerkId.',
          });
        }

        const sessionId = `imp_${target.id}_${Date.now()}`;

        await platformAudit({
          platformUserId: ctx.platformUser.id,
          action: 'platform.impersonate.start',
          tableName: 'users',
          recordId: target.id,
          tenantIdOverride: input.tenantId,
          after: { sessionId, targetEmail: target.email, targetRole: target.role },
          impersonationSessionId: sessionId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });

        // Geração da sessão Clerk real fica para staging com STRIPE/Clerk
        // configurados. Aqui devolvemos os metadados suficientes para o
        // cliente redirecionar via `/api/platform/impersonate?session=...`
        // (handler em sprint posterior). Por ora apenas registramos audit.
        return {
          sessionId,
          target: {
            id: target.id,
            email: target.email,
            fullName: target.fullName,
            role: target.role,
            tenantId: target.tenantId,
            clerkId: target.clerkId,
          },
        };
      }),
    ),

  impersonateEnd: platformProcedure
    .input(z.object({ sessionId: z.string().min(3), tenantId: zUuid, asUserId: zUuid }))
    .mutation(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        await platformAudit({
          platformUserId: ctx.platformUser.id,
          action: 'platform.impersonate.end',
          tableName: 'users',
          recordId: input.asUserId,
          tenantIdOverride: input.tenantId,
          after: { sessionId: input.sessionId },
          impersonationSessionId: input.sessionId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
        return { ok: true };
      }),
    ),

  /* ============================================================ */
  /*                            AUDIT                             */
  /* ============================================================ */

  auditList: platformProcedure
    .input(
      z
        .object({
          tenantId: zUuid.optional(),
          action: z.string().max(80).optional(),
          impersonatedOnly: z.boolean().default(false),
          limit: z.number().int().min(1).max(500).default(100),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) =>
      runAsPlatform(ctx.platformUser.id, async () => {
        const where: Prisma.AuditLogWhereInput = {
          ...(input.tenantId ? { tenantId: input.tenantId } : {}),
          ...(input.action ? { action: { contains: input.action } } : {}),
          ...(input.impersonatedOnly
            ? { metadata: { path: ['impersonated_by'], not: Prisma.JsonNull } }
            : {}),
        };
        return prisma.auditLog.findMany({
          where,
          orderBy: { at: 'desc' },
          take: input.limit,
        });
      }),
    ),

  /* ============================================================ */
  /*                           PRIVACY                            */
  /* ============================================================ */

  privacyList: platformProcedure.query(async ({ ctx }) =>
    runAsPlatform(ctx.platformUser.id, async () => {
      return prisma.dataSubjectRequest.findMany({
        where: { deletedAt: null },
        orderBy: { dueAt: 'asc' },
        take: 200,
        include: { tenant: { select: { id: true, name: true, slug: true } } },
      });
    }),
  ),

  /* ============================================================ */
  /*                       FEATURE FLAGS                          */
  /* ============================================================ */

  featureFlagsList: platformProcedure.query(async () => {
    // Stub baseado no Unleash mock do Sprint 10.5. Em prod resolveremos
    // contra a API do Unleash self-hosted (env: UNLEASH_URL/TOKEN).
    return [
      { name: 'tenant_theming_enabled', enabled: true, description: 'Self-service de branding por tenant' },
      { name: 'platform_console_enabled', enabled: true, description: 'Console do Platform Owner (esse menu)' },
    ];
  }),
});
