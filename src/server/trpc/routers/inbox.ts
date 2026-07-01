import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '@/server/trpc/trpc';
import { withCapability, adminOnlyProcedure } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { naturalQuery } from '@/server/services/semantic-search.service';
import { tryAutoLink } from '@/server/services/email-link.service';
import { zUuid } from '@/lib/validators';
import { ActivityType, IncomingEmailStatus, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';

const canRead = withCapability('opportunity', 'read');

export const inboxRouter = router({
  list: canRead
    .input(
      z
        .object({
          status: z.nativeEnum(IncomingEmailStatus).default('PENDING'),
        })
        .default({ status: 'PENDING' }),
    )
    .query(({ input }) =>
      prisma.incomingEmail.findMany({
        where: { status: input.status, deletedAt: null },
        orderBy: { receivedAt: 'desc' },
        take: 100,
      }),
    ),

  byId: canRead.input(z.object({ id: zUuid })).query(async ({ input }) => {
    const e = await prisma.incomingEmail.findFirst({
      where: { id: input.id, deletedAt: null },
    });
    if (!e) throw new TRPCError({ code: 'NOT_FOUND' });
    return e;
  }),

  retryAutoLink: canRead.input(z.object({ id: zUuid })).mutation(async ({ input, ctx }) => {
    return tryAutoLink(input.id, ctx.tenantId);
  }),

  linkManually: canRead
    .input(z.object({ id: zUuid, opportunityId: zUuid }))
    .mutation(async ({ input, ctx }) => {
      const email = await prisma.incomingEmail.findFirst({
        where: { id: input.id, status: IncomingEmailStatus.PENDING },
      });
      if (!email) throw new TRPCError({ code: 'NOT_FOUND' });

      const activity = await prisma.$transaction(async (tx) => {
        const a = await tx.activity.create({
          data: {
            tenantId: ctx.tenantId,
            opportunityId: input.opportunityId,
            authorId: ctx.user.id,
            type: ActivityType.EMAIL,
            title: email.subject ?? '(sem assunto)',
            content: email.bodyText ?? email.bodyHtml ?? '(corpo vazio)',
            rawText: email.bodyText ?? null,
            occurredAt: email.receivedAt,
            createdBy: ctx.user.id,
          } as Prisma.ActivityUncheckedCreateInput,
        });
        await tx.incomingEmail.update({
          where: { id: input.id },
          data: {
            status: IncomingEmailStatus.LINKED,
            linkedActivityId: a.id,
            linkedOpportunityId: input.opportunityId,
            linkConfidence: 1.0,
            linkMethod: 'manual',
            linkedAt: new Date(),
            linkedById: ctx.user.id,
          },
        });
        return a;
      });

      await audit({
        action: 'incoming_email.link_manual',
        tableName: 'incoming_emails',
        recordId: input.id,
        after: { opportunityId: input.opportunityId, activityId: activity.id },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return { activityId: activity.id };
    }),

  reject: canRead
    .input(z.object({ id: zUuid, reason: z.string().max(200).optional() }))
    .mutation(async ({ input, ctx }) => {
      const updated = await prisma.incomingEmail.updateMany({
        where: { id: input.id, status: IncomingEmailStatus.PENDING },
        data: {
          status: IncomingEmailStatus.REJECTED,
          rejectionReason: input.reason ?? null,
          linkedById: ctx.user.id,
          linkedAt: new Date(),
        },
      });
      if (updated.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      await audit({
        action: 'incoming_email.reject',
        tableName: 'incoming_emails',
        recordId: input.id,
        after: { reason: input.reason },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return { ok: true };
    }),
});

export const searchNaturalRouter = router({
  natural: canRead
    .input(
      z.object({
        query: z.string().min(2).max(300),
        rerank: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return naturalQuery(ctx.tenantId, ctx.user.id, input.query, {
        rerank: input.rerank,
      });
    }),
});

export const adminEmailRouter = router({
  getSlug: protectedProcedure.query(async ({ ctx }) => {
    const t = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { inboundEmailSlug: true },
    });
    return {
      slug: t?.inboundEmailSlug ?? null,
      domain: 'inbound.crm.local',
      fullAddress: t?.inboundEmailSlug
        ? `crm-${t.inboundEmailSlug}@inbound.crm.local`
        : null,
    };
  }),

  setSlug: adminOnlyProcedure
    .input(z.object({ slug: z.string().regex(/^[a-z0-9-]{4,40}$/) }))
    .mutation(async ({ input, ctx }) => {
      try {
        await prisma.tenant.update({
          where: { id: ctx.tenantId },
          data: { inboundEmailSlug: input.slug },
        });
      } catch {
        throw new TRPCError({ code: 'CONFLICT', message: 'Slug em uso por outro tenant' });
      }
      await audit({
        action: 'tenant.set_inbound_slug',
        tableName: 'tenants',
        recordId: ctx.tenantId,
        after: { slug: input.slug },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return { ok: true };
    }),

  regenerateSlug: adminOnlyProcedure.mutation(async ({ ctx }) => {
    const slug = `${nanoid(10).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
    await prisma.tenant.update({
      where: { id: ctx.tenantId },
      data: { inboundEmailSlug: slug },
    });
    await audit({
      action: 'tenant.regenerate_inbound_slug',
      tableName: 'tenants',
      recordId: ctx.tenantId,
      after: { slug },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      tenantIdOverride: ctx.tenantId,
    });
    return { slug };
  }),
});
