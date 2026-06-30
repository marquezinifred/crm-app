import { TRPCError } from '@trpc/server';
import { protectedProcedure } from './trpc';
import { hasPermission } from '@/lib/auth/rbac';
import type { UserRole } from '@prisma/client';

type Resource = Parameters<typeof hasPermission>[1];
type ActionOf<R extends Resource> = Parameters<typeof hasPermission<R>>[2];

/**
 * Restringe procedure a uma lista de UserRoles.
 * Retorna um procedure já refinado (ctx.user e ctx.tenantId não-null).
 */
export function withRoles(...allowed: UserRole[]) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!allowed.includes(ctx.user.role)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Perfil ${ctx.user.role} não tem acesso (requer um de: ${allowed.join(', ')})`,
      });
    }
    return next({ ctx });
  });
}

/**
 * Restringe procedure a uma capability (resource:action).
 */
export function withCapability<R extends Resource>(resource: R, action: ActionOf<R>) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!hasPermission(ctx.user.role, resource, action)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Sem permissão ${resource}:${action}`,
      });
    }
    return next({ ctx });
  });
}

export const adminOnlyProcedure = withRoles('ADMIN');
