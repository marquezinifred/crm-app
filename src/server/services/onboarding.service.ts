import { clerkClient } from '@clerk/nextjs/server';
import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { CompanyType, TenantPlan, UserRole } from '@prisma/client';

export interface OnboardingInput {
  clerkUserId: string;
  email: string;
  fullName: string;
  tenantSlug: string;
  tenantName: string;
  razaoSocial: string;
  cnpj: string;
  centralCrmEmail?: string;
}

export interface OnboardingResult {
  tenantId: string;
  userId: string;
}

/**
 * Cria o primeiro tenant (Empresa Vendedora):
 *   - Tenant
 *   - Company OWN (representa a própria Empresa Vendedora)
 *   - User local linkado ao Clerk com role ADMIN
 *   - Atualiza public_metadata do Clerk com tenantId + role
 *     (para que o JWT seguinte carregue a sessão completa)
 */
export async function provisionFirstTenant(input: OnboardingInput): Promise<OnboardingResult> {
  return runAsSystem(async () => {
    const existing = await prisma.tenant.findUnique({
      where: { slug: input.tenantSlug },
    });
    if (existing) {
      throw new Error(`Slug "${input.tenantSlug}" já está em uso.`);
    }

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug: input.tenantSlug,
          name: input.tenantName,
          plan: TenantPlan.TRIAL,
          centralCrmEmail: input.centralCrmEmail ?? null,
        },
      });

      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenant.id}'`);

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          clerkId: input.clerkUserId,
          email: input.email,
          fullName: input.fullName,
          role: UserRole.ADMIN,
        },
      });

      await tx.company.create({
        data: {
          tenantId: tenant.id,
          type: CompanyType.OWN,
          razaoSocial: input.razaoSocial,
          nomeFantasia: input.tenantName,
          cnpj: input.cnpj,
          email: input.centralCrmEmail ?? input.email,
          createdBy: user.id,
        },
      });

      return { tenantId: tenant.id, userId: user.id };
    });

    // Atualiza Clerk para o middleware encontrar tenantId no JWT seguinte
    await clerkClient().users.updateUserMetadata(input.clerkUserId, {
      publicMetadata: {
        tenantId: result.tenantId,
        role: UserRole.ADMIN,
      },
    });

    return result;
  });
}

/**
 * Verifica se o usuário Clerk já tem um User local — usado pelo /onboarding
 * para decidir se mostra o formulário ou redireciona para o app.
 */
export async function findLocalUserByClerkId(clerkId: string) {
  return runAsSystem(() =>
    prisma.user.findUnique({
      where: { clerkId },
      select: { id: true, tenantId: true, role: true, active: true },
    }),
  );
}
