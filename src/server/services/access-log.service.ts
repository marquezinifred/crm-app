import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';

export interface AccessLogEntry {
  clerkUserId: string;
  ip: string | null;
  userAgent: string | null;
  authMethod: string | null;
}

/**
 * Registra UM acesso de usuário. Tolerante a falha — auditoria não pode
 * derrubar o webhook do Clerk.
 *
 * Disparado por session.created (Clerk webhook). O IP é o do request do
 * próprio Clerk Edge, não do dispositivo final — para capturar o IP do
 * dispositivo, o middleware Next.js também grava em paralelo via header
 * x-forwarded-for (Sprint posterior consolida ambas as fontes).
 */
export async function recordUserAccess(entry: AccessLogEntry): Promise<void> {
  await runAsSystem(async () => {
    // Sprint 15A débito (migration 0026): mesma pessoa pode ter facetas
    // tenant + Platform. UserAccessLog é por-tenant, então buscamos
    // a faceta com tenantId não-null. Sem faceta tenant → não loga
    // (Platform-only mantém o comportamento original de não gerar log).
    const user = await prisma.user.findFirst({
      where: { clerkId: entry.clerkUserId, tenantId: { not: null } },
      select: { id: true, tenantId: true },
    });
    if (!user) return;
    if (!user.tenantId) return;

    try {
      await prisma.userAccessLog.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          ip: entry.ip,
          userAgent: entry.userAgent,
          authMethod: entry.authMethod,
        },
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
    } catch (err) {
      console.error('[access-log] falha', err);
    }
  });
}
