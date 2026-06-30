import { describe, it, expect } from 'vitest';
import {
  companyCreateInput,
  companyUpdateInput,
} from '@/lib/validators/company';

/**
 * Validação do CompanyForm — fix /companies.
 *
 * O form usa companyCreateInput/Update tRPC com Zod. Testamos os
 * casos críticos: CNPJ válido/invalido, campos opcionais, type enum.
 */

const BASE = {
  type: 'CLIENT' as const,
  razaoSocial: 'Acme Corporation Ltda',
  country: 'BR',
};

describe('companyCreateInput', () => {
  it('aceita payload mínimo válido', () => {
    const r = companyCreateInput.safeParse(BASE);
    expect(r.success).toBe(true);
  });

  it('rejeita razão social muito curta', () => {
    const r = companyCreateInput.safeParse({ ...BASE, razaoSocial: 'A' });
    expect(r.success).toBe(false);
  });

  it('rejeita CNPJ inválido (apenas zeros)', () => {
    const r = companyCreateInput.safeParse({ ...BASE, cnpj: '00000000000000' });
    expect(r.success).toBe(false);
  });

  it('aceita CNPJ válido normalizado', () => {
    // 11.222.333/0001-81 — CNPJ válido conhecido
    const r = companyCreateInput.safeParse({ ...BASE, cnpj: '11.222.333/0001-81' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.cnpj).toBe('11222333000181');
  });

  it('rejeita type inexistente', () => {
    const r = companyCreateInput.safeParse({ ...BASE, type: 'INVALID' as never });
    expect(r.success).toBe(false);
  });

  it('country default BR', () => {
    const { country: _ignored, ...rest } = BASE;
    void _ignored;
    const r = companyCreateInput.safeParse(rest);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.country).toBe('BR');
  });

  it('website precisa ser URL válida', () => {
    const ok = companyCreateInput.safeParse({ ...BASE, website: 'https://acme.com.br' });
    const bad = companyCreateInput.safeParse({ ...BASE, website: 'acme.com.br' });
    expect(ok.success).toBe(true);
    expect(bad.success).toBe(false);
  });
});

describe('companyUpdateInput', () => {
  it('aceita patch parcial com id', () => {
    const r = companyUpdateInput.safeParse({
      id: '11111111-1111-1111-1111-111111111111',
      nomeFantasia: 'Acme',
    });
    expect(r.success).toBe(true);
  });

  it('rejeita id mal formado', () => {
    const r = companyUpdateInput.safeParse({ id: 'not-a-uuid' });
    expect(r.success).toBe(false);
  });
});
