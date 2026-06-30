import { describe, it, expect } from 'vitest';
import {
  companyCreateInput,
  companyUpdateInput,
} from '@/lib/validators/company';
import { mergeCnpjAutofill } from '@/lib/cnpj/autofill';
import type { CnpjData } from '@/lib/cnpj/lookup';

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

const EMPTY_FORM = {
  razaoSocial: '',
  nomeFantasia: '',
  state: '',
  city: '',
  phone: '',
};

const CNPJ_DATA: CnpjData = {
  cnpj: '03007331000141',
  razaoSocial: 'EBAZAR.COM.BR. LTDA',
  nomeFantasia: 'MERCADO LIVRE',
  situacaoCadastral: 'ATIVA',
  cnaeCode: '4791101',
  cnaeName: 'Comércio varejista',
  state: 'SP',
  city: 'Sao Paulo',
  phone: '(11) 4222-2222',
};

describe('mergeCnpjAutofill (CompanyForm)', () => {
  it('preenche todos os campos vazios e reporta nenhum preservado', () => {
    const { next, filled, preserved } = mergeCnpjAutofill(EMPTY_FORM, CNPJ_DATA);
    expect(next.razaoSocial).toBe('EBAZAR.COM.BR. LTDA');
    expect(next.nomeFantasia).toBe('MERCADO LIVRE');
    expect(next.state).toBe('SP');
    expect(next.city).toBe('Sao Paulo');
    expect(next.phone).toBe('(11) 4222-2222');
    expect(filled.sort()).toEqual(
      ['city', 'nomeFantasia', 'phone', 'razaoSocial', 'state'].sort(),
    );
    expect(preserved).toEqual([]);
  });

  it('NÃO sobrescreve campo já digitado pelo usuário', () => {
    const current = { ...EMPTY_FORM, razaoSocial: 'Loja do João Ltda' };
    const { next, filled, preserved } = mergeCnpjAutofill(current, CNPJ_DATA);
    expect(next.razaoSocial).toBe('Loja do João Ltda');
    expect(next.city).toBe('Sao Paulo');
    expect(filled).toContain('city');
    expect(filled).not.toContain('razaoSocial');
    expect(preserved).toContain('razaoSocial');
  });

  it('trata whitespace puro como vazio (pode preencher)', () => {
    const current = { ...EMPTY_FORM, city: '   ' };
    const { next, filled } = mergeCnpjAutofill(current, CNPJ_DATA);
    expect(next.city).toBe('Sao Paulo');
    expect(filled).toContain('city');
  });

  it('ignora valores nulos vindos da API (não derruba campo do usuário)', () => {
    const current = { ...EMPTY_FORM, phone: '(11) 9 9999-0000' };
    const dataNoPhone: CnpjData = { ...CNPJ_DATA, phone: null };
    const { next, preserved } = mergeCnpjAutofill(current, dataNoPhone);
    expect(next.phone).toBe('(11) 9 9999-0000');
    expect(preserved).not.toContain('phone');
  });

  it('não conta como preservado quando valor da API bate com o atual', () => {
    const current = { ...EMPTY_FORM, state: 'SP' };
    const { preserved } = mergeCnpjAutofill(current, CNPJ_DATA);
    expect(preserved).not.toContain('state');
  });
});
