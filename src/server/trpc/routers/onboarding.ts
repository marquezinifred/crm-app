import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { router, publicProcedure } from '@/server/trpc/trpc';
import { provisionFirstTenant, findLocalUserByClerkId } from '@/server/services/onboarding.service';
import { zCnpj, zEmail, zSlug } from '@/lib/validators';

const createTenantInput = z.object({
  tenantName: z.string().min(2).max(120),
  tenantSlug: zSlug,
  razaoSocial: z.string().min(2).max(160),
  cnpj: zCnpj,
  centralCrmEmail: zEmail.optional(),
});

export const onboardingRouter = router({
  status: publicProcedure.query(async () => {
    const { userId } = auth();
    if (!userId) return { state: 'unauthenticated' as const };
    const local = await findLocalUserByClerkId(userId);
    if (!local) return { state: 'needs_onboarding' as const };
    return { state: 'ready' as const, tenantId: local.tenantId, role: local.role };
  }),

  createFirstTenant: publicProcedure
    .input(createTenantInput)
    .mutation(async ({ input }) => {
      const { userId } = auth();
      if (!userId) throw new TRPCError({ code: 'UNAUTHORIZED' });

      const existing = await findLocalUserByClerkId(userId);
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Usuário já vinculado a um tenant.',
        });
      }

      const clerkUser = await currentUser();
      if (!clerkUser) throw new TRPCError({ code: 'UNAUTHORIZED' });

      const primaryEmail =
        clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
          ?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;
      if (!primaryEmail) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Sem e-mail Clerk' });

      const fullName =
        [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ').trim() ||
        primaryEmail.split('@')[0]!;

      return provisionFirstTenant({
        clerkUserId: userId,
        email: primaryEmail,
        fullName,
        ...input,
      });
    }),
});
