/**
 * Seed do primeiro Platform Owner — Sprint 15A.
 *
 * Uso:
 *   PLATFORM_OWNER_EMAIL=marquezinifred@gmail.com \
 *   PLATFORM_OWNER_FULL_NAME='Frederico Marquezini' \
 *   PLATFORM_OWNER_CLERK_ID=user_3FkD...   \  # opcional, pode vir depois
 *   npx tsx prisma/seed-platform.ts
 *
 * Cria um User com `tenantId = NULL` + `platformRole = PLATFORM_OWNER`
 * + `role = ADMIN` (placeholder técnico — não usado fora do tenant).
 *
 * Idempotente: re-execução com o mesmo e-mail não cria duplicata, apenas
 * atualiza `clerkId`/`fullName` se vierem mudados.
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.PLATFORM_OWNER_EMAIL?.toLowerCase().trim();
  const fullName = process.env.PLATFORM_OWNER_FULL_NAME ?? 'Platform Owner';
  const clerkId = process.env.PLATFORM_OWNER_CLERK_ID?.trim() || null;

  if (!email) {
    throw new Error('Defina PLATFORM_OWNER_EMAIL antes de rodar.');
  }

  const existing = await prisma.user.findFirst({
    where: { email, tenantId: null, deletedAt: null },
  });

  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        fullName,
        clerkId: clerkId ?? existing.clerkId,
        active: true,
      },
    });
    console.log(`✓ Platform Owner já existia. Atualizado: ${updated.email}`);
    return;
  }

  const created = await prisma.user.create({
    data: {
      tenantId: null,
      platformRole: 'PLATFORM_OWNER',
      role: 'ADMIN',
      email,
      fullName,
      clerkId,
      active: true,
    } as Prisma.UserUncheckedCreateInput,
  });
  console.log(`✓ Platform Owner criado: ${created.email} (${created.id})`);
  if (!clerkId) {
    console.log(
      '\n⚠  Sem PLATFORM_OWNER_CLERK_ID. Crie a conta Clerk com o mesmo e-mail\n' +
        '   e copie o Clerk user id, depois rode este script novamente para\n' +
        '   vincular ou atualize manualmente users.clerk_id.\n',
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
