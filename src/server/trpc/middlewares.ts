import { TRPCError } from '@trpc/server';
import { protectedProcedure } from './trpc';
import { hasCapability } from '@/lib/auth/rbac';
import { hasPermission } from '@/server/services/permissions.service';
import type { Permission } from '@/lib/auth/permissions-catalog';
import type { UserRole } from '@prisma/client';

type Resource = Parameters<typeof hasCapability>[1];
type ActionOf<R extends Resource> = Parameters<typeof hasCapability<R>>[2];

/**
 * P-98 — Mensagem única e genérica pra todo FORBIDDEN de RBAC.
 *
 * Fred (2026-07-17) pediu que a UI não exponha o role do usuário nem o
 * requisito técnico (allowed roles / resource:action / permission) — as
 * mensagens antigas variavam entre si e vazavam detalhe. Esta é a única
 * string visível ao usuário; o detalhe técnico vai pro `cause` do
 * TRPCError (server-side, não serializado pro cliente — o errorFormatter
 * em `trpc.ts` não inclui `cause` no shape).
 */
export const FORBIDDEN_MESSAGE = 'Seu perfil não tem acesso a esta operação.';

/**
 * Restringe procedure a uma lista de UserRoles.
 * Retorna um procedure já refinado (ctx.user e ctx.tenantId não-null).
 *
 * @deprecated Sprint 15E — use `withPermission('resource:action')` em
 * novos procedures. Este helper segue funcionando pra compat gradual.
 */
export function withRoles(...allowed: UserRole[]) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!allowed.includes(ctx.user.role)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: FORBIDDEN_MESSAGE,
        cause: `withRoles: role=${ctx.user.role} requer=[${allowed.join(',')}]`,
      });
    }
    return next({ ctx });
  });
}

/**
 * Restringe procedure a uma capability (resource:action) — API legada.
 *
 * @deprecated Sprint 15E — use `withPermission('resource:action')` que
 * considera overrides individuais. Este helper continua checando apenas
 * o role default (via ROLE_CAPABILITIES).
 */
export function withCapability<R extends Resource>(resource: R, action: ActionOf<R>) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!hasCapability(ctx.user.role, resource, action)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: FORBIDDEN_MESSAGE,
        cause: `withCapability: role=${ctx.user.role} requer=${resource}:${action}`,
      });
    }
    return next({ ctx });
  });
}

/**
 * Sprint 15E — middleware granular. Checa permission efetiva do user
 * considerando role default + overrides individuais + cache.
 *
 * Assíncrono — cada procedure faz 1 query (com cache hit) pra
 * `cachedPermissions`. Fallback a `computeAndCacheUserPermissions`
 * quando cache está NULL.
 */
export function withPermission(permission: Permission) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    const ok = await hasPermission(ctx.user.id, permission);
    if (!ok) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: FORBIDDEN_MESSAGE,
        cause: `withPermission: role=${ctx.user.role} requer=${permission}`,
      });
    }
    return next({ ctx });
  });
}

/**
 * @deprecated Sprint 15E — substituir por `withPermission('user:update')`
 * ou a permission apropriada. Helper mantido pra retrocompatibilidade
 * das ~74 procedures marcadas como "admin only". ADMIN default tem todas
 * as permissions do catálogo (exceto `audit:read_platform` que é Platform
 * Owner only), então behavior permanece idêntico até cada callsite migrar.
 */
export const adminOnlyProcedure = withRoles('ADMIN');
