import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenantId: string;
  userId: string | null;
  role: string | null;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(context: TenantContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

export function runWithTenantSync<T>(context: TenantContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

export function getTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}

export function requireTenantId(): string {
  const ctx = storage.getStore();
  if (!ctx?.tenantId) {
    throw new Error(
      'Tenant context not set. Wrap your code in runWithTenant() or use the trpc/REST middleware.',
    );
  }
  return ctx.tenantId;
}

/**
 * Escape hatch sistêmico — usar apenas em seed, cron jobs, webhooks
 * autenticados ou jobs internos sem identidade humana.
 */
export const SYSTEM_TENANT_SENTINEL = '__system__';

export function runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run(
    { tenantId: SYSTEM_TENANT_SENTINEL, userId: null, role: 'PLATFORM_OWNER' },
    fn,
  );
}

/**
 * Sprint 15A — contexto Platform Owner.
 *
 * Comporta-se como `runAsSystem` (bypassa filtro tenant da Prisma
 * extension) mas mantém identidade atribuível: queries que gravam
 * audit_logs com `user_id` recebem o ID do Platform Owner que está
 * executando. Toda mutação durante impersonação grava esse ID em
 * `metadata.impersonated_by` (responsabilidade do caller, não do helper).
 */
export const PLATFORM_TENANT_SENTINEL = '__platform__';

export function runAsPlatform<T>(
  platformUserId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(
    { tenantId: PLATFORM_TENANT_SENTINEL, userId: platformUserId, role: 'PLATFORM_OWNER' },
    fn,
  );
}

/**
 * Helper para identificar se o contexto atual é sistêmico ou de plataforma
 * (Prisma extension bypassa injeção de tenant para os dois).
 */
export function isPrivilegedContext(tenantId: string | undefined): boolean {
  return tenantId === SYSTEM_TENANT_SENTINEL || tenantId === PLATFORM_TENANT_SENTINEL;
}
