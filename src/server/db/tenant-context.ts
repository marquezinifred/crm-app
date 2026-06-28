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
 * Escape hatch — usar apenas em contextos sistêmicos seguros
 * (seed, cron jobs sistêmicos, webhooks autenticados).
 * Toda chamada deve ser justificada por comentário.
 */
export function runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run(
    { tenantId: '__system__', userId: null, role: 'SUPER_ADMIN' },
    fn,
  );
}

export const SYSTEM_TENANT_SENTINEL = '__system__';
