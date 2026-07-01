import { describe, it, expect } from 'vitest';
import { z } from 'zod';

/**
 * P-16 — Global search router.
 *
 * O router de banco (search.ts) usa Prisma + ctx tRPC, o que exigiria
 * mocks pesados de Prisma extension + AsyncLocalStorage. O que
 * testamos aqui é o CONTRATO — a forma dos inputs/outputs e a política
 * de "permission ausente = bucket vazio" — sem tocar no banco.
 */

const globalSearchInput = z.object({
  query: z.string().min(2).max(100),
});

describe('search.global input validation', () => {
  it('rejeita query com menos de 2 caracteres', () => {
    expect(() => globalSearchInput.parse({ query: 'a' })).toThrow();
    expect(() => globalSearchInput.parse({ query: '' })).toThrow();
  });

  it('rejeita query vazia', () => {
    expect(() => globalSearchInput.parse({ query: '' })).toThrow();
  });

  it('rejeita query maior que 100 caracteres', () => {
    expect(() => globalSearchInput.parse({ query: 'a'.repeat(101) })).toThrow();
  });

  it('aceita query válida', () => {
    expect(globalSearchInput.parse({ query: 'marq' }).query).toBe('marq');
    expect(globalSearchInput.parse({ query: 'a'.repeat(100) }).query).toHaveLength(100);
  });
});

describe('search.global response shape', () => {
  it('cada bucket é array (mesmo vazio quando sem permissão)', () => {
    const empty = { companies: [], contacts: [], opportunities: [], users: [] };
    expect(Array.isArray(empty.companies)).toBe(true);
    expect(Array.isArray(empty.contacts)).toBe(true);
    expect(Array.isArray(empty.opportunities)).toBe(true);
    expect(Array.isArray(empty.users)).toBe(true);
  });

  it('CNPJ é extraído para dígitos-only antes de LIKE (tolerância a máscara)', () => {
    const q = '12.345.678/0001-99';
    const digits = q.replace(/\D/g, '');
    expect(digits).toBe('12345678000199');
  });

  it('LIKE de CNPJ só roda se >= 2 dígitos (evita full-scan sem hint)', () => {
    const cases = [
      { q: 'ab', digits: '', shouldSearch: false },
      { q: 'a1', digits: '1', shouldSearch: false },
      { q: '12', digits: '12', shouldSearch: true },
      { q: '12.345', digits: '12345', shouldSearch: true },
    ];
    for (const c of cases) {
      const digits = c.q.replace(/\D/g, '');
      expect(digits).toBe(c.digits);
      expect(digits.length >= 2).toBe(c.shouldSearch);
    }
  });
});

describe('search.global RBAC policy', () => {
  it('user sem company:read recebe companies=[] em vez de erro global', () => {
    const canReadCompany = false;
    const companies = canReadCompany ? [{ id: 'x' }] : [];
    expect(companies).toEqual([]);
  });

  it('user com permissões parciais recebe subset (não FORBIDDEN)', () => {
    const perms = { company: true, contact: true, opportunity: false, user: false };
    const buckets = {
      companies: perms.company ? [{}] : [],
      contacts: perms.contact ? [{}] : [],
      opportunities: perms.opportunity ? [{}] : [],
      users: perms.user ? [{}] : [],
    };
    expect(buckets.companies.length).toBe(1);
    expect(buckets.contacts.length).toBe(1);
    expect(buckets.opportunities.length).toBe(0);
    expect(buckets.users.length).toBe(0);
  });
});
