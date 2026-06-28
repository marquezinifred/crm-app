import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '@/server/trpc/trpc';
import { adminOnlyProcedure } from '@/server/trpc/middlewares';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { zUuid } from '@/lib/validators';
import {
  productCreateInput,
  productUpdateInput,
  productListInput,
} from '@/lib/validators/product';

export const productsRouter = router({
  list: protectedProcedure.input(productListInput).query(async ({ input }) => {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(typeof input.active === 'boolean' ? { active: input.active } : {}),
      ...(input.search
        ? { name: { contains: input.search, mode: 'insensitive' } }
        : {}),
    };
    return prisma.product.findMany({ where, orderBy: { name: 'asc' } });
  }),

  byId: protectedProcedure.input(z.object({ id: zUuid })).query(async ({ input }) => {
    const p = await prisma.product.findFirst({
      where: { id: input.id, deletedAt: null },
    });
    if (!p) throw new TRPCError({ code: 'NOT_FOUND' });
    return p;
  }),

  create: adminOnlyProcedure.input(productCreateInput).mutation(async ({ input, ctx }) => {
    const p = await prisma.product.create({
      data: {
        tenantId: ctx.tenantId,
        createdBy: ctx.user.id,
        ...input,
      } as Prisma.ProductUncheckedCreateInput,
    });
    await audit({
      action: 'product.create',
      tableName: 'products',
      recordId: p.id,
      after: p,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return p;
  }),

  update: adminOnlyProcedure.input(productUpdateInput).mutation(async ({ input, ctx }) => {
    const { id, ...data } = input;
    const before = await prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
    const updated = await prisma.product.update({
      where: { id },
      data: { ...data, updatedBy: ctx.user.id } as Prisma.ProductUncheckedUpdateInput,
    });
    await audit({
      action: 'product.update',
      tableName: 'products',
      recordId: updated.id,
      before,
      after: updated,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return updated;
  }),

  remove: adminOnlyProcedure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ input, ctx }) => {
      const before = await prisma.product.findFirst({
        where: { id: input.id, deletedAt: null },
      });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
      const updated = await prisma.product.update({
        where: { id: input.id },
        data: { deletedAt: new Date(), active: false, updatedBy: ctx.user.id },
      });
      await audit({
        action: 'product.delete',
        tableName: 'products',
        recordId: updated.id,
        before,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return { ok: true };
    }),
});
