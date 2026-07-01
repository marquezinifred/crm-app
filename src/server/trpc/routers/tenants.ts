import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '@/server/trpc/trpc';
import { prisma } from '@/server/db/client';

/**
 * P-22 — Router `tenants`.
 *
 * `current` devolve os metadados do tenant ativo na sessão pra alimentar
 * UIs que precisam confirmar visualmente o destino de uma ação (ex.: modal
 * de convite em `/admin/users`).
 *
 * Impersonação: hoje o Context tRPC ainda não expõe `impersonatedFrom`
 * (Sprint 15A cobriu apenas audit trail). Enquanto o tracking não sobe pra
 * ctx, `impersonating` sempre retorna null. Ver P-23 no backlog.
 */
export const tenantsRouter = router({
  current: protectedProcedure.query(async ({ ctx }) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { id: true, name: true, slug: true, plan: true },
    });
    if (!tenant) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Tenant não encontrado.',
      });
    }

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
      impersonating: null as null | {
        platformUserId: string;
        startedAt: string;
      },
    };
  }),
});
