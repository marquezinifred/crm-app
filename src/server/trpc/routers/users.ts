import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { clerkClient } from '@clerk/nextjs/server';
import { router, protectedProcedure } from '@/server/trpc/trpc';
import { adminOnlyProcedure } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { zEmail, zUuid } from '@/lib/validators';
import type { UserRole } from '@prisma/client';
import { Prisma } from '@prisma/client';

/**
 * Roles atribuíveis dentro de um tenant — Sprint 15A.
 *
 * SUPER_ADMIN foi removido do enum: gestão cross-tenant agora vive em
 * `users.platformRole = PLATFORM_OWNER` (tenantId NULL) e usa o
 * router `platform` + middleware dedicado. Tenant admins não podem
 * criar Platform Owners pela UI.
 */
const ASSIGNABLE_ROLES = [
  'ADMIN',
  'DIRETOR_COMERCIAL',
  'DIRETOR_OPERACOES',
  'DIRETOR_FINANCEIRO',
  'GESTOR',
  'ANALISTA',
  'PARCEIRO',
] as const satisfies readonly UserRole[];
// GESTOR_INBOUND removido no Sprint 15E — Admin agora concede permissions
// individuais (inbound:view_queue + inbound:assign_prospects) via
// override em `permissions.grant`. Migration 0030 backfilla users antigos.

const inviteInput = z.object({
  email: zEmail,
  fullName: z.string().min(2).max(160),
  role: z.enum(ASSIGNABLE_ROLES),
});

const updateRoleInput = z.object({
  id: zUuid,
  role: z.enum(ASSIGNABLE_ROLES),
  active: z.boolean().optional(),
});

export const usersRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          role: z.enum(ASSIGNABLE_ROLES).optional(),
          active: z.boolean().optional(),
          search: z.string().max(80).optional(),
        })
        .default({}),
    )
    .query(async ({ input }) => {
      const where: Prisma.UserWhereInput = {
        deletedAt: null,
        ...(input.role ? { role: input.role } : {}),
        ...(typeof input.active === 'boolean' ? { active: input.active } : {}),
        ...(input.search
          ? {
              OR: [
                { fullName: { contains: input.search, mode: 'insensitive' } },
                { email: { contains: input.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      return prisma.user.findMany({
        where,
        orderBy: { fullName: 'asc' },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          active: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });
    }),

  me: protectedProcedure.query(({ ctx }) => ({
    id: ctx.user.id,
    email: ctx.user.email,
    fullName: ctx.user.fullName,
    role: ctx.user.role,
    tenantId: ctx.tenantId,
  })),

  // Admin convida via Clerk. O usuário receberá magic link.
  // Quando aceitar, o webhook user.created já vai sincronizar.
  invite: adminOnlyProcedure.input(inviteInput).mutation(async ({ input, ctx }) => {
    // Cria o User local de antemão, ainda sem clerkId, para reservar a role
    const existing = await prisma.user.findFirst({
      where: { email: input.email, deletedAt: null },
    });
    if (existing) throw new TRPCError({ code: 'CONFLICT', message: 'E-mail já existe' });

    const local = await prisma.user.create({
      data: {
        tenantId: ctx.tenantId,
        email: input.email,
        fullName: input.fullName,
        role: input.role,
        active: false,
      } as Prisma.UserUncheckedCreateInput,
    });

    try {
      await clerkClient().invitations.createInvitation({
        emailAddress: input.email,
        publicMetadata: {
          tenantId: ctx.tenantId,
          role: input.role,
          localUserId: local.id,
        },
        redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/`,
      });
    } catch (err) {
      // Rollback do User local se o convite Clerk falhar
      await prisma.user.delete({ where: { id: local.id } });
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Falha ao enviar convite Clerk',
        cause: err,
      });
    }

    await audit({
      action: 'user.invite',
      tableName: 'users',
      recordId: local.id,
      after: local,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      tenantIdOverride: ctx.tenantId,
    });
    return { id: local.id, email: local.email };
  }),

  updateRole: adminOnlyProcedure.input(updateRoleInput).mutation(async ({ input, ctx }) => {
    if (input.id === ctx.user.id && input.role !== ctx.user.role) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Não é possível alterar a própria role.' });
    }
    const before = await prisma.user.findFirst({
      where: { id: input.id, deletedAt: null },
    });
    if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
    const updated = await prisma.user.update({
      where: { id: input.id },
      data: {
        role: input.role,
        ...(typeof input.active === 'boolean' ? { active: input.active } : {}),
      },
    });
    // Propaga para Clerk caso o user já esteja vinculado
    if (updated.clerkId) {
      await clerkClient().users.updateUserMetadata(updated.clerkId, {
        publicMetadata: { tenantId: ctx.tenantId, role: input.role },
      });
    }
    await audit({
      action: 'user.update_role',
      tableName: 'users',
      recordId: updated.id,
      before,
      after: updated,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      tenantIdOverride: ctx.tenantId,
    });
    return updated;
  }),

  deactivate: adminOnlyProcedure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ input, ctx }) => {
      if (input.id === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Não é possível desativar a si mesmo.' });
      }
      const before = await prisma.user.findFirst({
        where: { id: input.id, deletedAt: null },
      });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
      const updated = await prisma.user.update({
        where: { id: input.id },
        data: { active: false, deletedAt: new Date() },
      });
      await audit({
        action: 'user.deactivate',
        tableName: 'users',
        recordId: updated.id,
        before,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return { ok: true };
    }),
});
