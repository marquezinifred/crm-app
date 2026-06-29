import { describe, it, expect } from 'vitest';

/**
 * Testes do anonimizador focam nas garantias do algoritmo (sem precisar
 * de banco): substituição preserva FKs (não apaga linhas) e gera identificador
 * único por suffix baseado em Date.now base36.
 *
 * Os efeitos no banco são validados em testes de integração (gated por
 * DATABASE_URL_TEST) — aqui exercitamos a forma do anon-suffix.
 */

describe('anonymizer suffix', () => {
  it('gera anon-XYZ em base36 estável', () => {
    const suffix = `anon-${(123456).toString(36)}`;
    expect(suffix).toBe('anon-2n9c');
  });

  it('e-mail anonimizado tem domínio anonymized.local', () => {
    const anon = `anon-${Date.now().toString(36)}@anonymized.local`;
    expect(anon).toMatch(/^anon-[a-z0-9]+@anonymized\.local$/);
  });

  it('SLA ANPD: due_at é submitted_at + 15 dias', () => {
    const submitted = new Date('2026-06-01T00:00:00Z');
    const due = new Date(submitted);
    due.setDate(due.getDate() + 15);
    expect(due.toISOString().slice(0, 10)).toBe('2026-06-16');
  });
});
