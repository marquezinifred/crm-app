import type { AIProvider } from '@prisma/client';
import { CircuitBreaker } from '@/server/services/ai-circuit-breaker';

/**
 * Sprint 15F — Circuit breaker por (provider, tenant).
 *
 * Isolamento: falha em (Anthropic, tenantA) NÃO afeta (Anthropic, tenantB).
 * Estado é in-memory (Map) — em ambiente serverless com múltiplos pods
 * o threshold acumula por pod, não globalmente. Trade-off aceitável no
 * MVP; migrar pra Redis quando fizer diferença.
 *
 * TTL: breakers ociosos > 1h são coletados pra evitar memory leak em
 * long-running workers.
 */

const IDLE_TTL_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

interface Entry {
  breaker: CircuitBreaker;
  lastAccess: number;
}

const store = new Map<string, Entry>();
let lastCleanup = 0;

function key(provider: AIProvider, tenantId: string): string {
  return `${provider}:${tenantId}`;
}

export function getBreaker(
  provider: AIProvider,
  tenantId: string,
): CircuitBreaker {
  maybeCleanup();
  const k = key(provider, tenantId);
  const existing = store.get(k);
  if (existing) {
    existing.lastAccess = Date.now();
    return existing.breaker;
  }
  const breaker = new CircuitBreaker({ name: k });
  store.set(k, { breaker, lastAccess: Date.now() });
  return breaker;
}

/**
 * Limpa manualmente (usado por `platform.ai.clearCircuitBreaker`).
 * Retorna quantos breakers foram limpos.
 */
export function clearBreakers(filter: {
  provider?: AIProvider;
  tenantId?: string;
}): number {
  let cleared = 0;
  for (const [k, entry] of store.entries()) {
    const [provider, tenantId] = k.split(':') as [AIProvider, string];
    if (filter.provider && provider !== filter.provider) continue;
    if (filter.tenantId && tenantId !== filter.tenantId) continue;
    entry.breaker.recordSuccess();
    store.delete(k);
    cleared += 1;
  }
  return cleared;
}

/**
 * Snapshot pra observabilidade (Card D em /admin/ai).
 */
export function snapshotBreakers(): Array<{
  provider: AIProvider;
  tenantId: string;
  open: boolean;
  lastAccess: number;
}> {
  const now = Date.now();
  const out: Array<{
    provider: AIProvider;
    tenantId: string;
    open: boolean;
    lastAccess: number;
  }> = [];
  for (const [k, entry] of store.entries()) {
    const [provider, tenantId] = k.split(':') as [AIProvider, string];
    out.push({
      provider,
      tenantId,
      open: entry.breaker.isOpen(),
      lastAccess: now - entry.lastAccess,
    });
  }
  return out;
}

function maybeCleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [k, entry] of store.entries()) {
    if (now - entry.lastAccess > IDLE_TTL_MS) {
      store.delete(k);
    }
  }
}

/** Reset pra testes. */
export function __resetBreakersForTests() {
  store.clear();
  lastCleanup = 0;
}
