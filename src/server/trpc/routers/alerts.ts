import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '@/server/trpc/trpc';
import { adminOnlyProcedure } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { AlertType, AlertStatus, Prisma } from '@prisma/client';
import { zEmail, zUuid } from '@/lib/validators';

export const alertsRouter = router({
  myAlerts: protectedProcedure
    .input(
      z
        .object({
          type: z.nativeEnum(AlertType).optional(),
          status: z.nativeEnum(AlertStatus).optional(),
          windowDays: z.number().int().min(1).max(60).default(14),
        })
        .default({ windowDays: 14 }),
    )
    .query(async ({ input, ctx }) => {
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + input.windowDays);
      const where: Prisma.AlertLogWhereInput = {
        recipientEmail: ctx.user.email,
        scheduledFor: { lte: horizon },
        ...(input.type ? { type: input.type } : {}),
        ...(input.status ? { status: input.status } : {}),
      };
      return prisma.alertLog.findMany({
        where,
        orderBy: { scheduledFor: 'asc' },
        take: 200,
      });
    }),

  tenantConfig: protectedProcedure.query(async ({ ctx }) => {
    const t = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { alertLeadDays: true, centralCrmEmail: true, taskOverdueDays: true },
    });
    return t;
  }),

  updateConfig: adminOnlyProcedure
    .input(
      z.object({
        alertLeadDays: z.array(z.number().int().min(0).max(60)).min(1).max(5),
        centralCrmEmail: zEmail.optional().nullable(),
        taskOverdueDays: z.number().int().min(0).max(30).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const before = await prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { alertLeadDays: true, centralCrmEmail: true, taskOverdueDays: true },
      });
      const updated = await prisma.tenant.update({
        where: { id: ctx.tenantId },
        data: {
          alertLeadDays: input.alertLeadDays,
          ...(input.centralCrmEmail !== undefined
            ? { centralCrmEmail: input.centralCrmEmail }
            : {}),
          ...(input.taskOverdueDays !== undefined
            ? { taskOverdueDays: input.taskOverdueDays }
            : {}),
        },
      });
      await audit({
        action: 'tenant.update_alerts',
        tableName: 'tenants',
        recordId: ctx.tenantId,
        before,
        after: updated,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return updated;
    }),

  dismiss: protectedProcedure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ input, ctx }) => {
      const alert = await prisma.alertLog.findUnique({ where: { id: input.id } });
      if (!alert || alert.recipientEmail !== ctx.user.email) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      await prisma.alertLog.update({
        where: { id: input.id },
        data: { status: AlertStatus.SENT, sentAt: alert.sentAt ?? new Date() },
      });
      return { ok: true };
    }),
});
