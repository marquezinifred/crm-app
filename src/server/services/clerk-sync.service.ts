import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';

/**
 * Sincroniza o User local com o estado do Clerk.
 * Chamado pelo webhook /api/clerk/webhook nos eventos user.created / user.updated.
 *
 * Estratégia:
 *   - Se já existe um User com clerkId, atualiza email/fullName/active.
 *   - Se NÃO existe e o Clerk traz public_metadata.tenantId + role, cria.
 *   - Sem public_metadata, ignora — o user precisa passar pelo onboarding
 *     antes de virar User local (cria no fluxo de /onboarding).
 */
export interface ClerkUserPayload {
  id: string;
  email_addresses: Array<{ id: string; email_address: string }>;
  primary_email_address_id: string | null;
  first_name: string | null;
  last_name: string | null;
  public_metadata?: {
    tenantId?: string;
    role?: string;
  };
}

const VALID_ROLES = new Set([
  'SUPER_ADMIN',
  'ADMIN',
  'DIRETOR_COMERCIAL',
  'DIRETOR_FINANCEIRO',
  'GESTOR',
  'ANALISTA',
  'PARCEIRO',
]);

export async function syncUserFromClerk(payload: ClerkUserPayload): Promise<void> {
  const primaryEmail =
    payload.email_addresses.find((e) => e.id === payload.primary_email_address_id)
      ?.email_address ??
    payload.email_addresses[0]?.email_address;

  if (!primaryEmail) {
    console.warn(`[clerk-sync] user ${payload.id} sem e-mail — ignorado`);
    return;
  }

  const fullName =
    [payload.first_name, payload.last_name].filter(Boolean).join(' ').trim() ||
    primaryEmail.split('@')[0]!;

  await runAsSystem(async () => {
    const existing = await prisma.user.findUnique({ where: { clerkId: payload.id } });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { email: primaryEmail, fullName, active: true },
      });
      return;
    }

    const tenantId = payload.public_metadata?.tenantId;
    const role = payload.public_metadata?.role;

    if (!tenantId || !role || !VALID_ROLES.has(role)) {
      // Sem metadata → pendente de onboarding. O fluxo /onboarding cria depois.
      return;
    }

    await prisma.user.create({
      data: {
        tenantId,
        clerkId: payload.id,
        email: primaryEmail,
        fullName,
        role: role as never,
        active: true,
      },
    });
  });
}

export async function deactivateUserFromClerk(clerkId: string): Promise<void> {
  await runAsSystem(async () => {
    const existing = await prisma.user.findUnique({ where: { clerkId } });
    if (!existing) return;
    await prisma.user.update({
      where: { id: existing.id },
      data: { active: false, deletedAt: new Date() },
    });
  });
}
