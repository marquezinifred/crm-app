// @vitest-environment node
// Env precisa estar setado antes de qualquer import que puxe env.ts
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';
process.env.TENANT_FIELD_ENCRYPTION_KEY = 'test-key-with-at-least-32-characters!';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma: cada teste seta o retorno de findUnique via mockFindUnique
const mockFindUnique = vi.fn();
vi.mock('@/server/db/client', () => ({
  prisma: { tenant: { findUnique: (...args: unknown[]) => mockFindUnique(...args) } },
}));

// runAsSystem inline (sem ALS real neste teste)
vi.mock('@/server/db/tenant-context', () => ({
  runAsSystem: <T,>(fn: () => Promise<T>) => fn(),
}));

// Stub env — os testes controlam ANTHROPIC_API_KEY via envStub
const envStub: { ANTHROPIC_API_KEY: string | undefined } = { ANTHROPIC_API_KEY: undefined };
vi.mock('@/lib/env', () => ({
  env: new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'ANTHROPIC_API_KEY') return envStub.ANTHROPIC_API_KEY;
      if (prop === 'TENANT_FIELD_ENCRYPTION_KEY') {
        return 'test-key-with-at-least-32-characters!';
      }
      if (prop === 'ANTHROPIC_MODEL_HAIKU') return 'claude-haiku-4-5';
      if (prop === 'ANTHROPIC_MODEL_SONNET') return 'claude-sonnet-4-6';
      return undefined;
    },
  }),
}));

describe('getAnthropicForTenant', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    envStub.ANTHROPIC_API_KEY = undefined;
    const { __test } = await import('@/lib/ai/claude');
    __test.clearCache();
  });

  async function encrypt(plaintext: string): Promise<string> {
    const { encryptField } = await import('@/lib/crypto/field-encryption');
    return encryptField(plaintext);
  }

  it('usa a key encriptada do tenant', async () => {
    const enc = await encrypt('sk-ant-tenant-A-key');
    mockFindUnique.mockResolvedValueOnce({ aiApiKeyEncrypted: enc });

    const { getAnthropicForTenant } = await import('@/lib/ai/claude');
    const client = await getAnthropicForTenant('tenant-A');
    expect(client).toBeDefined();
    expect((client as unknown as { apiKey: string }).apiKey).toBe('sk-ant-tenant-A-key');
  });

  it('tenants distintos recebem clientes distintos com keys próprias', async () => {
    const encA = await encrypt('sk-ant-AAA');
    const encB = await encrypt('sk-ant-BBB');
    mockFindUnique.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === 'tenant-A') return Promise.resolve({ aiApiKeyEncrypted: encA });
      if (args.where.id === 'tenant-B') return Promise.resolve({ aiApiKeyEncrypted: encB });
      return Promise.resolve(null);
    });

    const { getAnthropicForTenant } = await import('@/lib/ai/claude');
    const [a, b] = await Promise.all([
      getAnthropicForTenant('tenant-A'),
      getAnthropicForTenant('tenant-B'),
    ]);
    expect(a).not.toBe(b);
    expect((a as unknown as { apiKey: string }).apiKey).toBe('sk-ant-AAA');
    expect((b as unknown as { apiKey: string }).apiKey).toBe('sk-ant-BBB');
  });

  it('cacheia por tenantId — segundo call não re-busca no Prisma', async () => {
    const enc = await encrypt('sk-ant-cache');
    mockFindUnique.mockResolvedValue({ aiApiKeyEncrypted: enc });

    const { getAnthropicForTenant } = await import('@/lib/ai/claude');
    const first = await getAnthropicForTenant('tenant-X');
    const second = await getAnthropicForTenant('tenant-X');
    expect(first).toBe(second);
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });

  it('fallback pra ANTHROPIC_API_KEY global com warn se tenant sem key', async () => {
    envStub.ANTHROPIC_API_KEY = 'sk-ant-global-fallback';
    mockFindUnique.mockResolvedValueOnce({ aiApiKeyEncrypted: null });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { getAnthropicForTenant } = await import('@/lib/ai/claude');

    const client = await getAnthropicForTenant('tenant-no-key');
    expect((client as unknown as { apiKey: string }).apiKey).toBe('sk-ant-global-fallback');
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0]![0]).toContain('Fallback');
    warnSpy.mockRestore();
  });

  it('throw com mensagem apontando /admin/ai quando ambos estão ausentes', async () => {
    mockFindUnique.mockResolvedValueOnce({ aiApiKeyEncrypted: null });

    const { getAnthropicForTenant } = await import('@/lib/ai/claude');
    await expect(getAnthropicForTenant('tenant-orphan')).rejects.toThrow(/\/admin\/ai/);
  });

  it('invalidateTenantClient força re-busca no próximo call', async () => {
    const enc1 = await encrypt('sk-ant-v1');
    const enc2 = await encrypt('sk-ant-v2');
    mockFindUnique
      .mockResolvedValueOnce({ aiApiKeyEncrypted: enc1 })
      .mockResolvedValueOnce({ aiApiKeyEncrypted: enc2 });

    const { getAnthropicForTenant, invalidateTenantClient } = await import('@/lib/ai/claude');
    const first = await getAnthropicForTenant('tenant-rotate');
    expect((first as unknown as { apiKey: string }).apiKey).toBe('sk-ant-v1');

    invalidateTenantClient('tenant-rotate');
    const second = await getAnthropicForTenant('tenant-rotate');
    expect((second as unknown as { apiKey: string }).apiKey).toBe('sk-ant-v2');
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
  });
});
