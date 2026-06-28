import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '@/server/trpc/trpc';
import { adminOnlyProcedure } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { zUuid } from '@/lib/validators';
import { Prisma } from '@prisma/client';

const nameInput = z.object({ name: z.string().min(2).max(80) });

export const territoriesRouter = router({
  list: protectedProcedure.query(() =>
    prisma.territory.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
  ),
  create: adminOnlyProcedure
    .input(nameInput)
    .mutation(async ({ input, ctx }) => {
      return prisma.territory.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name,
          createdBy: ctx.user.id,
        } as Prisma.TerritoryUncheckedCreateInput,
      });
    }),
  update: adminOnlyProcedure
    .input(z.object({ id: zUuid, name: z.string().min(2).max(80) }))
    .mutation(async ({ input, ctx }) => {
      const updated = await prisma.territory.updateMany({
        where: { id: input.id, deletedAt: null },
        data: { name: input.name, updatedBy: ctx.user.id },
      });
      if (updated.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),
  remove: adminOnlyProcedure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ input, ctx }) => {
      const result = await prisma.territory.updateMany({
        where: { id: input.id, deletedAt: null },
        data: { deletedAt: new Date(), updatedBy: ctx.user.id },
      });
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),
});

export const segmentsRouter = router({
  list: protectedProcedure.query(() =>
    prisma.segment.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
  ),
  create: adminOnlyProcedure
    .input(nameInput)
    .mutation(async ({ input, ctx }) =>
      prisma.segment.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name,
          createdBy: ctx.user.id,
        } as Prisma.SegmentUncheckedCreateInput,
      }),
    ),
  update: adminOnlyProcedure
    .input(z.object({ id: zUuid, name: z.string().min(2).max(80) }))
    .mutation(async ({ input, ctx }) => {
      const updated = await prisma.segment.updateMany({
        where: { id: input.id, deletedAt: null },
        data: { name: input.name, updatedBy: ctx.user.id },
      });
      if (updated.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),
  remove: adminOnlyProcedure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ input, ctx }) => {
      const result = await prisma.segment.updateMany({
        where: { id: input.id, deletedAt: null },
        data: { deletedAt: new Date(), updatedBy: ctx.user.id },
      });
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),
});
