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

// ─── Sprint 15C — Listas configuráveis ────────────────────────────
// lead_sources, industries, contact_roles: mesmo padrão de Territory/
// Segment + position (drag-to-reorder), isActive (toggle ativo/inativo),
// e remove protegido se em uso.

const cfgNameInput = z.object({
  name: z.string().min(2).max(80),
  position: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

const reorderInput = z.object({ ids: z.array(zUuid).min(1) });

export const leadSourcesRouter = router({
  list: protectedProcedure
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(({ input }) =>
      prisma.leadSource.findMany({
        where: {
          deletedAt: null,
          ...(input?.includeInactive ? {} : { isActive: true }),
        },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      }),
    ),
  create: adminOnlyProcedure
    .input(cfgNameInput)
    .mutation(async ({ input, ctx }) =>
      prisma.leadSource.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name,
          position: input.position ?? 0,
          isActive: input.isActive ?? true,
          createdBy: ctx.user.id,
        } as Prisma.LeadSourceUncheckedCreateInput,
      }),
    ),
  update: adminOnlyProcedure
    .input(
      z.object({
        id: zUuid,
        name: z.string().min(2).max(80).optional(),
        position: z.number().int().min(0).optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...rest } = input;
      const updated = await prisma.leadSource.updateMany({
        where: { id, deletedAt: null },
        data: { ...rest, updatedBy: ctx.user.id },
      });
      if (updated.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),
  remove: adminOnlyProcedure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ input, ctx }) => {
      const inUse = await prisma.opportunity.count({
        where: { leadSourceId: input.id, deletedAt: null },
      });
      if (inUse > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Esta origem está em uso em ${inUse} oportunidade${inUse === 1 ? '' : 's'}. Desative em vez de excluir.`,
        });
      }
      const result = await prisma.leadSource.updateMany({
        where: { id: input.id, deletedAt: null },
        data: { deletedAt: new Date(), isActive: false, updatedBy: ctx.user.id },
      });
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),
  reorder: adminOnlyProcedure
    .input(reorderInput)
    .mutation(async ({ input, ctx }) => {
      await prisma.$transaction(
        input.ids.map((id, idx) =>
          prisma.leadSource.updateMany({
            where: { id, deletedAt: null },
            data: { position: idx, updatedBy: ctx.user.id },
          }),
        ),
      );
      return { ok: true };
    }),
});

const industryInput = z.object({
  name: z.string().min(2).max(80),
  cnaePrefix: z.string().max(20).nullable().optional(),
  position: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const industriesRouter = router({
  list: protectedProcedure
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(({ input }) =>
      prisma.industry.findMany({
        where: {
          deletedAt: null,
          ...(input?.includeInactive ? {} : { isActive: true }),
        },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      }),
    ),
  create: adminOnlyProcedure
    .input(industryInput)
    .mutation(async ({ input, ctx }) =>
      prisma.industry.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name,
          cnaePrefix: input.cnaePrefix ?? null,
          position: input.position ?? 0,
          isActive: input.isActive ?? true,
          createdBy: ctx.user.id,
        } as Prisma.IndustryUncheckedCreateInput,
      }),
    ),
  update: adminOnlyProcedure
    .input(
      z.object({
        id: zUuid,
        name: z.string().min(2).max(80).optional(),
        cnaePrefix: z.string().max(20).nullable().optional(),
        position: z.number().int().min(0).optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...rest } = input;
      const updated = await prisma.industry.updateMany({
        where: { id, deletedAt: null },
        data: { ...rest, updatedBy: ctx.user.id },
      });
      if (updated.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),
  remove: adminOnlyProcedure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ input, ctx }) => {
      const inUse = await prisma.company.count({
        where: { industryId: input.id, deletedAt: null },
      });
      if (inUse > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Este setor está em uso em ${inUse} empresa${inUse === 1 ? '' : 's'}. Desative em vez de excluir.`,
        });
      }
      const result = await prisma.industry.updateMany({
        where: { id: input.id, deletedAt: null },
        data: { deletedAt: new Date(), isActive: false, updatedBy: ctx.user.id },
      });
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),
  reorder: adminOnlyProcedure
    .input(reorderInput)
    .mutation(async ({ input, ctx }) => {
      await prisma.$transaction(
        input.ids.map((id, idx) =>
          prisma.industry.updateMany({
            where: { id, deletedAt: null },
            data: { position: idx, updatedBy: ctx.user.id },
          }),
        ),
      );
      return { ok: true };
    }),
});

const contactRoleInput = z.object({
  name: z.string().min(2).max(80),
  weight: z.number().int().min(1).max(5).optional(),
  position: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const contactRolesRouter = router({
  list: protectedProcedure
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(({ input }) =>
      prisma.contactRole.findMany({
        where: {
          deletedAt: null,
          ...(input?.includeInactive ? {} : { isActive: true }),
        },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      }),
    ),
  create: adminOnlyProcedure
    .input(contactRoleInput)
    .mutation(async ({ input, ctx }) =>
      prisma.contactRole.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name,
          weight: input.weight ?? 1,
          position: input.position ?? 0,
          isActive: input.isActive ?? true,
          createdBy: ctx.user.id,
        } as Prisma.ContactRoleUncheckedCreateInput,
      }),
    ),
  update: adminOnlyProcedure
    .input(
      z.object({
        id: zUuid,
        name: z.string().min(2).max(80).optional(),
        weight: z.number().int().min(1).max(5).optional(),
        position: z.number().int().min(0).optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...rest } = input;
      const updated = await prisma.contactRole.updateMany({
        where: { id, deletedAt: null },
        data: { ...rest, updatedBy: ctx.user.id },
      });
      if (updated.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),
  remove: adminOnlyProcedure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ input, ctx }) => {
      const inUse = await prisma.contact.count({
        where: { contactRoleId: input.id, deletedAt: null },
      });
      if (inUse > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Este cargo está em uso em ${inUse} contato${inUse === 1 ? '' : 's'}. Desative em vez de excluir.`,
        });
      }
      const result = await prisma.contactRole.updateMany({
        where: { id: input.id, deletedAt: null },
        data: { deletedAt: new Date(), isActive: false, updatedBy: ctx.user.id },
      });
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),
  reorder: adminOnlyProcedure
    .input(reorderInput)
    .mutation(async ({ input, ctx }) => {
      await prisma.$transaction(
        input.ids.map((id, idx) =>
          prisma.contactRole.updateMany({
            where: { id, deletedAt: null },
            data: { position: idx, updatedBy: ctx.user.id },
          }),
        ),
      );
      return { ok: true };
    }),
});
