import { describe, it, expect } from 'vitest';
import {
  runWithTenant,
  runAsSystem,
  getTenantId,
  requireTenantId,
  SYSTEM_TENANT_SENTINEL,
} from '@/server/db/tenant-context';

describe('tenant-context', () => {
  it('isola tenants entre execuções concorrentes', async () => {
    const ids = await Promise.all([
      runWithTenant({ tenantId: 't1', userId: null, role: null }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        return getTenantId();
      }),
      runWithTenant({ tenantId: 't2', userId: null, role: null }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getTenantId();
      }),
    ]);
    expect(ids).toEqual(['t1', 't2']);
  });

  it('requireTenantId dispara fora de contexto', () => {
    expect(() => requireTenantId()).toThrow();
  });

  it('runAsSystem seta sentinela', async () => {
    const id = await runAsSystem(async () => getTenantId());
    expect(id).toBe(SYSTEM_TENANT_SENTINEL);
  });
});
