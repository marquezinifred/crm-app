import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router } from '@/server/trpc/trpc';
import { adminOnlyProcedure } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import {
  startCheckoutSession,
  openCustomerPortal,
} from '@/server/services/billing-checkout.service';
import { collectCurrentUsage } from '@/server/services/usage.service';
import { limitsFor, checkUsage } from '@/lib/billing/plan-limits';
import { stripeEnabled } from '@/lib/billing/stripe-client';
import { TenantPlan } from '@prisma/client';

export const billingRouter = router({
  status: adminOnlyProcedure.query(async ({ ctx }) => {
    const tenant = await runAsSystem(() =>
      prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: {
          plan: true,
          subscriptionStatus: true,
          currentPeriodEnd: true,
          trialEndsAt: true,
          stripeCustomerId: true,
        },
      }),
    );
    return { ...tenant, stripeConfigured: stripeEnabled() };
  }),

  startCheckout: adminOnlyProcedure
    .input(z.object({ plan: z.enum(['STARTER', 'PRO', 'ENTERPRISE']) }))
    .mutation(async ({ input, ctx }) => {
      if (!stripeEnabled()) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Stripe não configurado' });
      }
      const url = await startCheckoutSession({
        tenantId: ctx.tenantId,
        customerEmail: ctx.user.email,
        plan: input.plan,
      });
      return { url };
    }),

  openPortal: adminOnlyProcedure.mutation(async ({ ctx }) => {
    if (!stripeEnabled()) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Stripe não configurado' });
    }
    const url = await openCustomerPortal({ tenantId: ctx.tenantId });
    return { url };
  }),

  currentUsage: adminOnlyProcedure.query(async ({ ctx }) => {
    const usage = await collectCurrentUsage(ctx.tenantId);
    const tenant = await runAsSystem(() =>
      prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { plan: true },
      }),
    );
    const plan = (tenant?.plan ?? TenantPlan.TRIAL) as TenantPlan;
    const limits = limitsFor(plan);
    return {
      plan,
      limits,
      checks: {
        users: checkUsage(usage.userCount, limits.maxUsers),
        companies: checkUsage(usage.companyCount, limits.maxCompanies),
        contacts: checkUsage(usage.contactCount, limits.maxContacts),
        storage: checkUsage(Number(usage.storageBytes), limits.maxStorageBytes),
        aiTokens: checkUsage(usage.aiTokensMonth, limits.maxAiTokensMonth),
      },
      raw: {
        ...usage,
        storageBytes: Number(usage.storageBytes),
      },
    };
  }),

  history: adminOnlyProcedure.query(({ ctx }) =>
    prisma.billingEvent.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { processedAt: 'desc' },
      take: 50,
      select: { id: true, type: true, processedAt: true, error: true },
    }),
  ),
});
