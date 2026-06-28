import { describe, it, expect } from 'vitest';
import { DataMaskingService } from '@/lib/ai/masking';

const m = new DataMaskingService();

describe('masking PII completo (Sprint 4)', () => {
  it('mascara EMPRESA com sufixo societário', () => {
    const { masked, map } = m.mask('Conversei com Acme Tech Ltda hoje.');
    expect(masked).toContain('[EMPRESA_1]');
    expect(masked).not.toContain('Acme Tech Ltda');
    expect(map['[EMPRESA_1]']).toBe('Acme Tech Ltda');
  });

  it('mascara EMPRESA com S/A', () => {
    const { masked } = m.mask('Beta Holdings S/A apresentou contraproposta.');
    expect(masked).toContain('[EMPRESA_1]');
  });

  it('mascara PESSOA — nome composto PT-BR', () => {
    const { masked, map } = m.mask('João Silva enviou o material para Maria da Costa.');
    expect(masked).toContain('[PESSOA_1]');
    expect(masked).toContain('[PESSOA_2]');
    expect(map['[PESSOA_1]']).toBe('João Silva');
    expect(map['[PESSOA_2]']).toBe('Maria da Costa');
  });

  it('blacklist evita falso positivo "São Paulo"', () => {
    const { masked } = m.mask('Reunião em São Paulo amanhã.');
    expect(masked).toContain('São Paulo');
  });

  it('mascara VALOR monetário', () => {
    const { masked, map } = m.mask('Proposta de R$ 150.000,00 para 6 meses.');
    expect(masked).toContain('[VALOR_1]');
    expect(map['[VALOR_1]']).toBe('R$ 150.000,00');
  });

  it('mascara VALOR em "milhões de reais"', () => {
    const { masked } = m.mask('Contrato vale 2 milhões de reais por ano.');
    expect(masked).toContain('[VALOR_1]');
  });

  it('mascara ENDERECO simples', () => {
    const { masked, map } = m.mask('Visita na Rua das Flores 123 com cliente.');
    expect(masked).toContain('[ENDERECO_1]');
    expect(map['[ENDERECO_1]']).toBe('Rua das Flores 123');
  });

  it('audit() conta tipos sem mutar texto', () => {
    const text = 'João Silva (joao@x.com) da Acme Ltda fechou R$ 50.000.';
    const counts = m.audit(text);
    expect(counts.PESSOA).toBeGreaterThanOrEqual(1);
    expect(counts.EMAIL).toBe(1);
    expect(counts.EMPRESA).toBeGreaterThanOrEqual(1);
    expect(counts.VALOR).toBe(1);
  });

  it('unmask restaura todos os tipos juntos', () => {
    const text =
      'João Silva (joao@example.com / +55 11 91234-5678) da Acme Tech Ltda — proposta R$ 50.000';
    const { masked, map } = m.mask(text);
    expect(masked).not.toContain('João Silva');
    expect(masked).not.toContain('joao@example.com');
    expect(m.unmask(masked, map)).toBe(text);
  });

  it('PESSOA não pega palavra única (evita ruído)', () => {
    const { masked } = m.mask('Conforme combinado anteriormente.');
    expect(masked).not.toMatch(/\[PESSOA_/);
  });
});
