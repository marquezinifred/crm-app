import { describe, it, expect } from 'vitest';
import {
  runAsPlatform,
  runAsSystem,
  getTenantContext,
  PLATFORM_TENANT_SENTINEL,
  SYSTEM_TENANT_SENTINEL,
  isPrivilegedContext,
} from '@/server/db/tenant-context';

describe('runAsPlatform', () => {
  it('seta sentinel + userId no contexto', async () => {
    await runAsPlatform('p_user_123', async () => {
      const ctx = getTenantContext();
      expect(ctx?.tenantId).toBe(PLATFORM_TENANT_SENTINEL);
      expect(ctx?.userId).toBe('p_user_123');
      expect(ctx?.role).toBe('PLATFORM_OWNER');
    });
  });

  it('PLATFORM_TENANT_SENTINEL é privilegiado', () => {
    expect(isPrivilegedContext(PLATFORM_TENANT_SENTINEL)).toBe(true);
  });

  it('SYSTEM_TENANT_SENTINEL também é privilegiado', () => {
    expect(isPrivilegedContext(SYSTEM_TENANT_SENTINEL)).toBe(true);
  });

  it('UUID normal NÃO é privilegiado', () => {
    expect(isPrivilegedContext('11111111-1111-1111-1111-111111111111')).toBe(false);
  });

  it('runAsSystem mantém comportamento legado', async () => {
    await runAsSystem(async () => {
      const ctx = getTenantContext();
      expect(ctx?.tenantId).toBe(SYSTEM_TENANT_SENTINEL);
      expect(ctx?.userId).toBeNull();
    });
  });
});
