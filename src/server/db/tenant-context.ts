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

/**
 * Sprint 15G.5 (T15/T19) — popula o `userId` do `TenantContext` já ativo.
 *
 * Necessário porque o route handler tRPC (`app/api/trpc/[trpc]/route.ts`)
 * inicia `runWithTenant({ tenantId, userId: null, role })` — o User do
 * banco só é resolvido depois, em `createContext`. O guard de transferência
 * em `db/client.ts` lê `getTenantContext().userId` pra distinguir o
 * disparador da transferência (pode escrever durante a pendência) do dono /
 * terceiros (read-only). Sem popular aqui, `userId` ficaria `null` no path
 * tRPC e o guard bypassaria TODA escrita humana (worker/sistema legítimo).
 *
 * No-op se não há store ativo. Não altera `tenantId` nem `role` — só o
 * `userId`, e apenas quando `createContext` resolve um tenant user real
 * (contexto de sistema/plataforma não passa por aqui).
 */
export function setContextUserId(userId: string | null): void {
  const store = storage.getStore();
  if (store) store.userId = userId;
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
