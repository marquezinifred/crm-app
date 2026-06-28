import { prisma } from '@/server/db/client';
import { getTenantContext, runAsSystem, SYSTEM_TENANT_SENTINEL } from '@/server/db/tenant-context';

export interface AuditEntry {
  action: string;
  tableName: string;
  recordId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  // Para chamadas fora de runWithTenant — opcional, raro
  tenantIdOverride?: string;
}

/**
 * Registra entrada em audit_logs. Tolerante a falha: erros são logados
 * mas não propagados — auditoria não pode quebrar a operação principal.
 *
 * Caminho normal: chamada dentro de runWithTenant() — tenantId vem do
 * AsyncLocalStorage e o Prisma extension injeta no payload.
 *
 * Caminho sistêmico: chamada dentro de runAsSystem() — usar
 * tenantIdOverride para indicar qual tenant é o sujeito do log.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  const ctx = getTenantContext();
  const effectiveTenantId =
    entry.tenantIdOverride ??
    (ctx && ctx.tenantId !== SYSTEM_TENANT_SENTINEL ? ctx.tenantId : null);

  if (!effectiveTenantId) {
    console.warn('[audit] chamado sem tenant — entrada descartada:', entry.action);
    return;
  }

  try {
    if (ctx?.tenantId && ctx.tenantId !== SYSTEM_TENANT_SENTINEL) {
      // Caminho normal: extension injeta tenantId
      await prisma.auditLog.create({
        data: {
          userId: ctx.userId,
          action: entry.action,
          tableName: entry.tableName,
          recordId: entry.recordId,
          before: (entry.before ?? null) as never,
          after: (entry.after ?? null) as never,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
        } as never,
      });
    } else {
      // Caminho sistêmico: injetar tenantId explicitamente via runAsSystem
      await runAsSystem(() =>
        prisma.auditLog.create({
          data: {
            tenantId: effectiveTenantId,
            userId: ctx?.userId ?? null,
            action: entry.action,
            tableName: entry.tableName,
            recordId: entry.recordId,
            before: (entry.before ?? null) as never,
            after: (entry.after ?? null) as never,
            ip: entry.ip ?? null,
            userAgent: entry.userAgent ?? null,
          },
        }),
      );
    }
  } catch (err) {
    console.error('[audit] falha ao gravar log:', err);
  }
}
