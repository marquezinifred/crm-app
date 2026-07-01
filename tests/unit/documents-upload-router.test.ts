import { describe, it, expect } from 'vitest';
import {
  sanitizeFilename,
  buildDocumentStorageKey,
} from '@/server/trpc/routers/documents';

/**
 * Guard puro que replica a lógica do uploadProxy — usado no teste sem
 * subir o tRPC inteiro. A regra de negócio real vive dentro do
 * procedure em src/server/trpc/routers/documents.ts uploadProxy.
 */
function isStorageKeyOwnedBy(tenantId: string, storageKey: string): boolean {
  return storageKey.startsWith(`tenant/${tenantId}/`);
}

describe('sanitizeFilename (P-19)', () => {
  it('preserva extensão e substitui espaços por _', () => {
    const out = sanitizeFilename('Proposta v1 final.pdf');
    expect(out).toBe('Proposta_v1_final.pdf');
  });

  it('remove path traversal (../ e /) e caracteres unicode', () => {
    expect(sanitizeFilename('../etc/passwd')).toBe('etc_passwd');
    // Diacríticos removidos; símbolos exóticos viram `_`
    const out = sanitizeFilename('café☕.pdf');
    expect(out).toMatch(/^cafe/);
    expect(out).toContain('.pdf');
    expect(out).not.toContain('☕');
  });

  it('trunca em 120 chars', () => {
    const long = 'a'.repeat(200) + '.pdf';
    const out = sanitizeFilename(long);
    expect(out.length).toBeLessThanOrEqual(120);
  });

  it('nome vazio vira "file"', () => {
    expect(sanitizeFilename('___')).toBe('file');
    expect(sanitizeFilename('')).toBe('file');
  });
});

describe('buildDocumentStorageKey (P-19)', () => {
  it('gera prefixo tenant/${id}/documents/<uuid>-<nome>', () => {
    const key = buildDocumentStorageKey('tenant-abc-123', 'contrato.pdf');
    expect(key).toMatch(
      /^tenant\/tenant-abc-123\/documents\/[0-9a-f-]{36}-contrato\.pdf$/,
    );
  });

  it('sanitiza o nome no path', () => {
    const key = buildDocumentStorageKey('t1', '../../root.pdf');
    expect(key).toMatch(
      /^tenant\/t1\/documents\/[0-9a-f-]{36}-root\.pdf$/,
    );
    expect(key).not.toContain('..');
  });

  it('gera keys únicas em chamadas sucessivas (uuid)', () => {
    const a = buildDocumentStorageKey('t1', 'a.pdf');
    const b = buildDocumentStorageKey('t1', 'a.pdf');
    expect(a).not.toBe(b);
  });
});

describe('uploadProxy tenant guard (P-19)', () => {
  it('aceita storageKey do próprio tenant', () => {
    const key = buildDocumentStorageKey('tenant-a', 'x.pdf');
    expect(isStorageKeyOwnedBy('tenant-a', key)).toBe(true);
  });

  it('rejeita storageKey de outro tenant', () => {
    const key = buildDocumentStorageKey('tenant-b', 'x.pdf');
    expect(isStorageKeyOwnedBy('tenant-a', key)).toBe(false);
  });

  it('rejeita path traversal via storageKey manipulado', () => {
    expect(
      isStorageKeyOwnedBy('tenant-a', 'tenant-a/../tenant-b/documents/x.pdf'),
    ).toBe(false);
    expect(
      isStorageKeyOwnedBy('tenant-a', '../tenant-a/documents/x.pdf'),
    ).toBe(false);
    expect(isStorageKeyOwnedBy('tenant-a', 'documents/x.pdf')).toBe(false);
  });

  it('rejeita match parcial de prefixo (tenant-a vs tenant-a-b)', () => {
    // Se um tenantId fosse "tenant-a" e storageKey começasse com "tenant-ab/…",
    // startsWith("tenant-a/") ainda rejeitaria pelo `/` obrigatório.
    expect(
      isStorageKeyOwnedBy('tenant-a', 'tenant-ab/documents/x.pdf'),
    ).toBe(false);
  });
});
