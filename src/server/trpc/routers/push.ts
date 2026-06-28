import { z } from 'zod';
import { router, protectedProcedure } from '@/server/trpc/trpc';
import { prisma } from '@/server/db/client';
import { env } from '@/lib/env';
import { Prisma } from '@prisma/client';

const subscriptionInput = z.object({
  endpoint: z.string().url().max(500),
  p256dh: z.string().min(10).max(500),
  auth: z.string().min(10).max(200),
  userAgent: z.string().max(500).optional(),
});

export const pushRouter = router({
  config: protectedProcedure.query(() => ({
    enabled: !!env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    publicKey: env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null,
  })),

  subscribe: protectedProcedure
    .input(subscriptionInput)
    .mutation(async ({ input, ctx }) => {
      await prisma.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        update: {
          p256dhKey: input.p256dh,
          authKey: input.auth,
          userAgent: input.userAgent ?? null,
          lastSeenAt: new Date(),
          deletedAt: null,
        },
        create: {
          tenantId: ctx.tenantId,
          userId: ctx.user.id,
          endpoint: input.endpoint,
          p256dhKey: input.p256dh,
          authKey: input.auth,
          userAgent: input.userAgent ?? null,
        } as Prisma.PushSubscriptionUncheckedCreateInput,
      });
      return { ok: true };
    }),

  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string().url() }))
    .mutation(async ({ input }) => {
      await prisma.pushSubscription.updateMany({
        where: { endpoint: input.endpoint },
        data: { deletedAt: new Date() },
      });
      return { ok: true };
    }),

  mySubscriptions: protectedProcedure.query(({ ctx }) =>
    prisma.pushSubscription.findMany({
      where: { userId: ctx.user.id, deletedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, userAgent: true, lastSeenAt: true, createdAt: true },
    }),
  ),
});
