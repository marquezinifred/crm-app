import { describe, it, expect, beforeAll } from 'vitest';

describe('field encryption AES-256-GCM', () => {
  beforeAll(() => {
    process.env.TENANT_FIELD_ENCRYPTION_KEY = 'test-key-with-at-least-32-characters!';
  });

  it('encrypt + decrypt round-trip', async () => {
    const { encryptField, decryptField } = await import('@/lib/crypto/field-encryption');
    const original = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
    const ct = encryptField(original);
    expect(ct).not.toContain(original);
    expect(decryptField(ct)).toBe(original);
  });

  it('cada encrypt gera IV diferente (ciphertexts distintos)', async () => {
    const { encryptField } = await import('@/lib/crypto/field-encryption');
    const a = encryptField('mesma-chave');
    const b = encryptField('mesma-chave');
    expect(a).not.toBe(b);
  });

  it('payload corrompido falha decrypt', async () => {
    const { encryptField, decryptField } = await import('@/lib/crypto/field-encryption');
    const ct = encryptField('teste');
    const corrupted = ct.slice(0, ct.length - 4) + 'AAAA';
    expect(() => decryptField(corrupted)).toThrow();
  });

  it('maskApiKey esconde miolo', async () => {
    const { maskApiKey } = await import('@/lib/crypto/field-encryption');
    expect(maskApiKey('sk-ant-api03-abcdefghijklmnop')).toBe('sk-ant-…mnop');
    expect(maskApiKey('curta')).toBe('****');
  });
});
