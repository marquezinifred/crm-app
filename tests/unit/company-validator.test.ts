import { describe, it, expect } from 'vitest';
import { companyCreateInput } from '@/lib/validators/company';
import { CompanyType } from '@prisma/client';

describe('companyCreateInput', () => {
  const base = {
    type: CompanyType.CLIENT,
    razaoSocial: 'Empresa Teste Ltda',
  };

  it('aceita mínimo válido', () => {
    const r = companyCreateInput.safeParse(base);
    expect(r.success).toBe(true);
  });

  it('valida CNPJ', () => {
    const ok = companyCreateInput.safeParse({ ...base, cnpj: '11.222.333/0001-81' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.cnpj).toBe('11222333000181');

    const bad = companyCreateInput.safeParse({ ...base, cnpj: '11.111.111/1111-11' });
    expect(bad.success).toBe(false);
  });

  it('valida URL do website', () => {
    const bad = companyCreateInput.safeParse({ ...base, website: 'not-a-url' });
    expect(bad.success).toBe(false);
  });

  it('valida e-mail', () => {
    const bad = companyCreateInput.safeParse({ ...base, email: 'sem-arroba' });
    expect(bad.success).toBe(false);
  });

  it('aceita até 20 datas importantes', () => {
    const dates = Array.from({ length: 20 }, () => ({
      dateType: 'FUNDACAO' as const,
      dateValue: new Date(2026, 0, 1),
      alertActive: true,
    }));
    const r = companyCreateInput.safeParse({ ...base, importantDates: dates });
    expect(r.success).toBe(true);
  });

  it('rejeita 21+ datas importantes', () => {
    const dates = Array.from({ length: 21 }, () => ({
      dateType: 'FUNDACAO' as const,
      dateValue: new Date(2026, 0, 1),
      alertActive: true,
    }));
    const r = companyCreateInput.safeParse({ ...base, importantDates: dates });
    expect(r.success).toBe(false);
  });
});
