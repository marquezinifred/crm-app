import { prisma } from '@/server/db/client';
import { runAsPlatform } from '@/server/db/tenant-context';
import { Prisma } from '@prisma/client';

/**
 * Audit log para ações de Platform Owner — Sprint 15A.
 *
 * Diferente do `audit()` regular (que assume tenant ativo), esse helper
 * registra ações cross-tenant com `tenant_id` setado ao tenant alvo
 * (ou NULL para ações globais como criar tenant) e marca o ator no
 * payload em `metadata.platform_user_id` + opcionalmente
 * `metadata.impersonation_session_id`.
 */
export async function platformAudit(input: {
  platformUserId: string;
  action: string;
  tableName: string;
  recordId: string;
  tenantIdOverride?: string | null;
  before?: unknown;
  after?: unknown;
  impersonationSessionId?: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  const metadata = {
    platform_user_id: input.platformUserId,
    ...(input.impersonationSessionId
      ? { impersonation_session_id: input.impersonationSessionId, impersonated_by: input.platformUserId }
      : {}),
  };
  await runAsPlatform(input.platformUserId, async () => {
    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantIdOverride ?? null,
        userId: null,
        action: input.action,
        tableName: input.tableName,
        recordId: input.recordId,
        before: (input.before ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        after: (input.after ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        metadata: metadata as Prisma.InputJsonValue,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      } as Prisma.AuditLogUncheckedCreateInput,
    });
  });
}
