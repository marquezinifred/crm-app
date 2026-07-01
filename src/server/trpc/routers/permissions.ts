import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '@/server/trpc/trpc';
import { withPermission } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import {
  hasPermission,
  computeAndCacheUserPermissions,
  invalidateUserPermissionsCache,
  defaultsForRole,
} from '@/server/services/permissions.service';
import { ROLE_DEFAULT_PERMISSIONS } from '@/lib/auth/rbac';
import {
  PERMISSIONS_CATALOG,
  PERMISSION_KEYS,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  isValidPermission,
  type Permission,
} from '@/lib/auth/permissions-catalog';
import { zUuid } from '@/lib/validators';

/**
 * Sprint 15E — router de permissions granulares.
 *
 * Procedures:
 *   - listCatalog: catálogo estático (todos users autenticados)
 *   - forUser: effective permissions de um user (defaults + overrides)
 *   - grant/revoke/restore: mutations de override, com guard anti-escalada
 *   - whoHas: lista users com permission (útil pra notificações)
 *
 * Guard anti-escalada §6.5 spec: caller (que não é Platform Owner)
 * só pode alterar permission que ele próprio tem. Bloqueia o cenário
 * "co-admin temporário com user:grant_permissions concede audit:read
 * a si mesmo".
 */

const canReadUsers = withPermission('user:read');
const canGrantPermissions = withPermission('user:grant_permissions');

const permissionInput = z.object({
  userId: zUuid,
  permission: z.string().refine(isValidPermission, {
    message: 'Permission fora do catálogo',
  }),
  reason: z.string().max(500).optional(),
});

/**
 * Guard anti-escalada de privilégio (§6.5 spec).
 * Platform Owner bypass — mantém legitimidade pra debug/recovery.
 */
async function assertCallerCanDelegate(
  callerId: string,
  callerPlatformRole: 'PLATFORM_OWNER' | 'PLATFORM_SUPPORT' | null,
  permission: Permission,
): Promise<void> {
  if (callerPlatformRole === 'PLATFORM_OWNER') return;
  const callerHas = await hasPermission(callerId, permission);
  if (!callerHas) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Você não tem "${permission}" e não pode alterá-la a outros.`,
    });
  }
}

/**
 * Confirma que o user alvo pertence ao mesmo tenant do caller.
 * Necessário porque overrides são per-tenant e não queremos que
 * co-admin de tenant A altere permission de user do tenant B via
 * uuid vazado.
 */
async function assertSameTenant(userId: string, tenantId: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!user) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuário não encontrado neste tenant.' });
  }
}

export const permissionsRouter = router({
  // ================================================================
  // Read
  // ================================================================

  /**
   * Catálogo completo — inclui labels PT-BR + categorias. Consumido
   * pela UI /admin/users/[id]/permissions. Sem guard porque qualquer
   * user autenticado consegue enumerar as keys por engenharia reversa
   * dos erros — melhor expor formalmente.
   */
  listCatalog: protectedProcedure.query(() => ({
    permissions: PERMISSIONS_CATALOG,
    categoryOrder: CATEGORY_ORDER,
    categoryLabels: CATEGORY_LABELS,
  })),

  /**
   * Effective permissions de um user com detalhes: defaults do role,
   * overrides individuais (com quem concedeu + motivo), e o array
   * efetivo final. Popula cache no lado se ainda não foi computado.
   */
  forUser: canReadUsers
    .input(z.object({ userId: zUuid }))
    .query(async ({ input, ctx }) => {
      const user = await prisma.user.findFirst({
        where: { id: input.userId, tenantId: ctx.tenantId, deletedAt: null },
        include: {
          permissionOverrides: {
            include: {
              grantedByUser: { select: { id: true, fullName: true, email: true } },
            },
            orderBy: { grantedAt: 'desc' },
          },
        },
      });
      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuário não encontrado.' });
      }

      const defaults = defaultsForRole(user.role);
      const effectiveSet =
        user.cachedPermissionsAt !== null
          ? new Set(user.cachedPermissions)
          : await computeAndCacheUserPermissions(user.id);

      return {
        userId: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        defaults,
        overrides: user.permissionOverrides.map((o) => ({
          id: o.id,
          permission: o.permission,
          action: o.action as 'granted' | 'revoked',
          grantedAt: o.grantedAt,
          reason: o.reason,
          grantedBy: o.grantedByUser
            ? {
                id: o.grantedByUser.id,
                fullName: o.grantedByUser.fullName,
                email: o.grantedByUser.email,
              }
            : null,
        })),
        effective: Array.from(effectiveSet),
        counts: {
          defaults: defaults.length,
          granted: user.permissionOverrides.filter((o) => o.action === 'granted').length,
          revoked: user.permissionOverrides.filter((o) => o.action === 'revoked').length,
          effective: effectiveSet.size,
        },
      };
    }),

  /**
   * Lista users do tenant com uma permission efetiva. Útil pra:
   *   - Notificações ("quem receber?")
   *   - UI de aprovação (approver_permission em approval_rules — Sprint 15E Fase 4)
   *
   * ⚠️ Depende de `cachedPermissions` populado. Se algum user tá com
   * cache NULL (nunca logou pós-migration), NÃO aparece aqui. Rodar
   * `npm run rbac:backfill-cache` pré-rollout resolve.
   */
  whoHas: canReadUsers
    .input(
      z.object({
        permission: z.string().refine(isValidPermission, {
          message: 'Permission fora do catálogo',
        }),
      }),
    )
    .query(async ({ input, ctx }) => {
      const users = await prisma.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          deletedAt: null,
          active: true,
          cachedPermissions: { has: input.permission },
        },
        select: { id: true, fullName: true, email: true, role: true },
        orderBy: { fullName: 'asc' },
      });
      return users;
    }),

  // ================================================================
  // Mutations
  // ================================================================

  grant: canGrantPermissions
    .input(permissionInput)
    .mutation(async ({ input, ctx }) => {
      await assertSameTenant(input.userId, ctx.tenantId);
      await assertCallerCanDelegate(
        ctx.user.id,
        ctx.platformRole,
        input.permission as Permission,
      );

      await prisma.userPermissionOverride.upsert({
        where: {
          user_permission_unique: {
            userId: input.userId,
            permission: input.permission,
          },
        },
        create: {
          userId: input.userId,
          tenantId: ctx.tenantId,
          permission: input.permission,
          action: 'granted',
          grantedBy: ctx.user.id,
          reason: input.reason ?? null,
        },
        update: {
          action: 'granted',
          grantedBy: ctx.user.id,
          grantedAt: new Date(),
          reason: input.reason ?? null,
        },
      });

      await invalidateUserPermissionsCache(input.userId);

      await audit({
        action: 'user.permission_granted',
        tableName: 'user_permission_overrides',
        recordId: input.userId,
        tenantIdOverride: ctx.tenantId,
        after: { permission: input.permission, reason: input.reason ?? null },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { ok: true as const };
    }),

  revoke: canGrantPermissions
    .input(permissionInput)
    .mutation(async ({ input, ctx }) => {
      await assertSameTenant(input.userId, ctx.tenantId);
      // Guard aplica também a revoke: só quem tem a permission pode
      // "tirá-la" via override. Bloqueia admin lateral revogando
      // audit:read de DIRETOR sem ele ter audit:read.
      await assertCallerCanDelegate(
        ctx.user.id,
        ctx.platformRole,
        input.permission as Permission,
      );

      await prisma.userPermissionOverride.upsert({
        where: {
          user_permission_unique: {
            userId: input.userId,
            permission: input.permission,
          },
        },
        create: {
          userId: input.userId,
          tenantId: ctx.tenantId,
          permission: input.permission,
          action: 'revoked',
          grantedBy: ctx.user.id,
          reason: input.reason ?? null,
        },
        update: {
          action: 'revoked',
          grantedBy: ctx.user.id,
          grantedAt: new Date(),
          reason: input.reason ?? null,
        },
      });

      await invalidateUserPermissionsCache(input.userId);

      await audit({
        action: 'user.permission_revoked',
        tableName: 'user_permission_overrides',
        recordId: input.userId,
        tenantIdOverride: ctx.tenantId,
        after: { permission: input.permission, reason: input.reason ?? null },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { ok: true as const };
    }),

  /**
   * Deleta override — volta a usar o default do role.
   * Aplica mesmo guard anti-escalada.
   */
  restore: canGrantPermissions
    .input(z.object({ userId: zUuid, permission: z.string().refine(isValidPermission) }))
    .mutation(async ({ input, ctx }) => {
      await assertSameTenant(input.userId, ctx.tenantId);
      await assertCallerCanDelegate(
        ctx.user.id,
        ctx.platformRole,
        input.permission as Permission,
      );

      const deleted = await prisma.userPermissionOverride.deleteMany({
        where: {
          userId: input.userId,
          permission: input.permission,
          tenantId: ctx.tenantId,
        },
      });

      await invalidateUserPermissionsCache(input.userId);

      await audit({
        action: 'user.permission_restored',
        tableName: 'user_permission_overrides',
        recordId: input.userId,
        tenantIdOverride: ctx.tenantId,
        after: { permission: input.permission, count: deleted.count },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { ok: true as const, count: deleted.count };
    }),
});

// Helpers exportados pra testes unit
export const __testExports = {
  assertCallerCanDelegate,
  assertSameTenant,
  ROLE_DEFAULT_PERMISSIONS,
  PERMISSION_KEYS,
};
