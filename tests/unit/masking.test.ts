import { describe, it, expect } from 'vitest';
import { DataMaskingService } from '@/lib/ai/masking';

describe('DataMaskingService', () => {
  const masking = new DataMaskingService();

  it('mascara e-mails e restaura', () => {
    const text = 'Contato: fred@example.com e ana@empresa.com.br';
    const { masked, map } = masking.mask(text);
    expect(masked).not.toContain('fred@example.com');
    expect(masked).not.toContain('ana@empresa.com.br');
    expect(masked).toContain('[EMAIL_1]');
    expect(masked).toContain('[EMAIL_2]');
    expect(masking.unmask(masked, map)).toBe(text);
  });

  it('deduplica valores repetidos no mesmo token', () => {
    const text = 'Email principal: fred@example.com. Confirme em fred@example.com';
    const { masked, map } = masking.mask(text);
    const emailTokens = Object.keys(map).filter((k) => k.startsWith('[EMAIL_'));
    expect(emailTokens).toHaveLength(1);
    expect(masked.match(/\[EMAIL_1\]/g)?.length).toBe(2);
  });

  it('mascara CNPJ e CPF', () => {
    const text = 'CNPJ 12.345.678/0001-90 — CPF 123.456.789-00';
    const { masked, map } = masking.mask(text);
    expect(masked).toContain('[CNPJ_1]');
    expect(masked).toContain('[CPF_1]');
    expect(map['[CNPJ_1]']).toBe('12.345.678/0001-90');
    expect(map['[CPF_1]']).toBe('123.456.789-00');
  });

  it('mascara telefones BR comuns', () => {
    const text = 'WhatsApp +55 11 91234-5678';
    const { masked } = masking.mask(text);
    expect(masked).toContain('[PHONE_1]');
  });

  it('unmask preserva tokens não mapeados', () => {
    const text = 'Olá [EMAIL_99] — token desconhecido';
    expect(masking.unmask(text, {})).toBe(text);
  });
});
