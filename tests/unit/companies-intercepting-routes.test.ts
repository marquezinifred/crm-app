import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Smoke das intercepting routes — Sprint fix /companies e /contacts.
 *
 * Garante que os arquivos esperados existem para o padrão funcionar:
 *  - layout.tsx com slot {modal}
 *  - @modal/default.tsx (null)
 *  - @modal/(.)[id]/page.tsx (Sheet)
 *  - [id]/page.tsx (full-page fallback)
 *
 * Se algum sair do lugar, Next.js falha a build silenciosamente
 * (slot vazio, 404 no deep link) — esse teste pega na hora.
 */

function exists(rel: string): boolean {
  return fs.existsSync(path.resolve(rel));
}

describe('intercepting routes — /companies', () => {
  it('layout com slot modal existe', () => {
    expect(exists('src/app/companies/layout.tsx')).toBe(true);
  });
  it('@modal/default.tsx existe', () => {
    expect(exists('src/app/companies/@modal/default.tsx')).toBe(true);
  });
  it('@modal/(.)[id]/page.tsx existe (intercepting)', () => {
    expect(exists('src/app/companies/@modal/(.)[id]/page.tsx')).toBe(true);
  });
  it('[id]/page.tsx full-page fallback existe', () => {
    expect(exists('src/app/companies/[id]/page.tsx')).toBe(true);
  });
});

describe('intercepting routes — /contacts', () => {
  it('layout com slot modal existe', () => {
    expect(exists('src/app/contacts/layout.tsx')).toBe(true);
  });
  it('@modal/default.tsx existe', () => {
    expect(exists('src/app/contacts/@modal/default.tsx')).toBe(true);
  });
  it('@modal/(.)[id]/page.tsx existe (intercepting)', () => {
    expect(exists('src/app/contacts/@modal/(.)[id]/page.tsx')).toBe(true);
  });
  it('[id]/page.tsx full-page fallback existe', () => {
    expect(exists('src/app/contacts/[id]/page.tsx')).toBe(true);
  });
});

describe('layouts referenciam slot {modal}', () => {
  it('companies/layout.tsx tem modal no children', () => {
    const code = fs.readFileSync('src/app/companies/layout.tsx', 'utf-8');
    expect(code).toMatch(/modal/);
  });
  it('contacts/layout.tsx tem modal no children', () => {
    const code = fs.readFileSync('src/app/contacts/layout.tsx', 'utf-8');
    expect(code).toMatch(/modal/);
  });
});
