import { describe, it, expect } from 'vitest';
import {
  formatCNPJ,
  unformatCNPJ,
  formatCEP,
  unformatCEP,
} from '@/lib/utils/format';

describe('CNPJ mask — Sprint 15C', () => {
  it('aplica máscara progressiva', () => {
    expect(formatCNPJ('')).toBe('');
    expect(formatCNPJ('12')).toBe('12');
    expect(formatCNPJ('123')).toBe('12.3');
    expect(formatCNPJ('12345')).toBe('12.345');
    expect(formatCNPJ('123456')).toBe('12.345.6');
    expect(formatCNPJ('12345678')).toBe('12.345.678');
    expect(formatCNPJ('123456780001')).toBe('12.345.678/0001');
    expect(formatCNPJ('12345678000199')).toBe('12.345.678/0001-99');
  });

  it('limita a 14 dígitos', () => {
    expect(formatCNPJ('12345678000199999')).toBe('12.345.678/0001-99');
  });

  it('ignora não-dígitos na entrada', () => {
    expect(formatCNPJ('12.345.678/0001-99')).toBe('12.345.678/0001-99');
    expect(formatCNPJ('abc12345xyz678999')).toBe('12.345.678/999');
  });

  it('unformat retorna só dígitos', () => {
    expect(unformatCNPJ('12.345.678/0001-99')).toBe('12345678000199');
    expect(unformatCNPJ('  ')).toBe('');
  });
});

describe('CEP mask — Sprint 15C', () => {
  it('aplica máscara após 5 dígitos', () => {
    expect(formatCEP('')).toBe('');
    expect(formatCEP('1234')).toBe('1234');
    expect(formatCEP('12345')).toBe('12345');
    expect(formatCEP('123456')).toBe('12345-6');
    expect(formatCEP('12345678')).toBe('12345-678');
  });

  it('limita a 8 dígitos', () => {
    expect(formatCEP('123456789')).toBe('12345-678');
  });

  it('unformat retorna só dígitos', () => {
    expect(unformatCEP('12345-678')).toBe('12345678');
    expect(unformatCEP('abc12345xyz678')).toBe('12345678');
  });
});
