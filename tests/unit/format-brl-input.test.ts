import { describe, it, expect } from 'vitest';
import { formatBRLInput, unformatBRLInput } from '@/lib/utils/format';

describe('formatBRLInput — P-50', () => {
  it('vazio devolve vazio', () => {
    expect(formatBRLInput('')).toBe('');
  });

  it('só não-dígitos devolve vazio', () => {
    expect(formatBRLInput('abc')).toBe('');
    expect(formatBRLInput('R$ ')).toBe('');
  });

  it('insere separador de milhar a cada 3 dígitos', () => {
    expect(formatBRLInput('1')).toBe('1');
    expect(formatBRLInput('12')).toBe('12');
    expect(formatBRLInput('123')).toBe('123');
    expect(formatBRLInput('1234')).toBe('1.234');
    expect(formatBRLInput('289311')).toBe('289.311');
    expect(formatBRLInput('1000000')).toBe('1.000.000');
  });

  it('aceita vírgula como decimal digitada progressivamente', () => {
    expect(formatBRLInput('289311,')).toBe('289.311,');
    expect(formatBRLInput('289311,5')).toBe('289.311,5');
    expect(formatBRLInput('289311,50')).toBe('289.311,50');
  });

  it('normaliza ponto para vírgula como decimal (calc/EN input)', () => {
    expect(formatBRLInput('289311.50')).toBe('289.311,50');
    expect(formatBRLInput('289.5')).toBe('289,5');
  });

  it('preserva paste de valor já formatado', () => {
    expect(formatBRLInput('289.311')).toBe('289.311');
    expect(formatBRLInput('1.234.567,89')).toBe('1.234.567,89');
    expect(formatBRLInput('R$ 1.234,56')).toBe('1.234,56');
  });

  it('trunca em 12 dígitos inteiros', () => {
    expect(formatBRLInput('999999999999')).toBe('999.999.999.999');
    expect(formatBRLInput('9999999999999')).toBe('999.999.999.999');
    expect(formatBRLInput('999999999999,99')).toBe('999.999.999.999,99');
  });

  it('trunca decimal em 2 dígitos', () => {
    expect(formatBRLInput('100,999')).toBe('100.999');
    expect(formatBRLInput('100,99')).toBe('100,99');
  });

  it('remove zeros à esquerda do inteiro', () => {
    expect(formatBRLInput('00100')).toBe('100');
    expect(formatBRLInput('0')).toBe('0');
    expect(formatBRLInput('0,50')).toBe('0,50');
  });
});

describe('unformatBRLInput — P-50', () => {
  it('vazio devolve 0', () => {
    expect(unformatBRLInput('')).toBe(0);
    expect(unformatBRLInput('abc')).toBe(0);
  });

  it('extrai inteiro puro do formato pt-BR', () => {
    expect(unformatBRLInput('289.311')).toBe(289311);
    expect(unformatBRLInput('1.000.000')).toBe(1_000_000);
  });

  it('extrai decimal via vírgula', () => {
    expect(unformatBRLInput('289.311,50')).toBe(289311.5);
    expect(unformatBRLInput('1.234,56')).toBe(1234.56);
    expect(unformatBRLInput('0,99')).toBe(0.99);
  });

  it('separador trailing sem dígitos é ignorado', () => {
    expect(unformatBRLInput('289.311,')).toBe(289311);
  });

  it('round-trip com formatBRLInput preserva número', () => {
    expect(unformatBRLInput(formatBRLInput('289311'))).toBe(289311);
    expect(unformatBRLInput(formatBRLInput('289311,50'))).toBe(289311.5);
    expect(unformatBRLInput(formatBRLInput('1234567,89'))).toBe(1234567.89);
    expect(unformatBRLInput(formatBRLInput('0'))).toBe(0);
  });

  it('aceita ponto como decimal em paste (compat calculadora)', () => {
    expect(unformatBRLInput('289.5')).toBe(289.5);
    expect(unformatBRLInput('100.99')).toBe(100.99);
  });
});
