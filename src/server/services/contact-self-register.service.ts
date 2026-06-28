import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { ContactApprovalStatus, ContactRelationshipType } from '@prisma/client';
import type { ContactSelfRegisterInput } from '@/lib/validators/contact';

/**
 * Auto-cadastramento público (sem auth).
 *   - Recebe slug do tenant
 *   - Cria contato com selfRegistered=true e approvalStatus=PENDING_APPROVAL
 *   - active=false até admin aprovar
 *   - Não vincula a uma Company existente automaticamente (Admin decide na aprovação)
 *
 * Roda em runAsSystem porque a rota é pública e não tem ctx de tenant.
 */
export async function registerPublicContact(input: ContactSelfRegisterInput) {
  return runAsSystem(async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: input.tenantSlug },
      select: { id: true, deletedAt: true },
    });
    if (!tenant || tenant.deletedAt) {
      throw new Error('Tenant inválido ou desativado.');
    }

    // Deduplicação por e-mail (case-insensitive via citext)
    const existing = await prisma.contact.findFirst({
      where: { tenantId: tenant.id, email: input.email },
    });
    if (existing) {
      // Não revelamos se o contato já existe — apenas devolvemos sucesso aparente.
      return { ok: true, contactId: existing.id, status: existing.approvalStatus };
    }

    const created = await prisma.contact.create({
      data: {
        tenantId: tenant.id,
        fullName: input.fullName,
        email: input.email,
        phone: input.phone ?? null,
        notes: input.companyRazaoSocial
          ? `Empresa declarada: ${input.companyRazaoSocial}${input.notes ? `\n${input.notes}` : ''}`
          : input.notes ?? null,
        relationshipType: ContactRelationshipType.OUTRO,
        selfRegistered: true,
        approvalStatus: ContactApprovalStatus.PENDING_APPROVAL,
        active: false,
      },
    });
    return { ok: true, contactId: created.id, status: created.approvalStatus };
  });
}
