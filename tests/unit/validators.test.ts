import { describe, it, expect } from 'vitest';
import { isValidCnpj, formatCnpj, stripCnpj } from '@/lib/validators/cnpj';
import { isValidCpf, formatCpf } from '@/lib/validators/cpf';
import { isValidBrPhone, formatBrPhone, normalizeBrPhone } from '@/lib/validators/phone';
import { isValidEmail, normalizeEmail } from '@/lib/validators/email';
import { parseBrDate, formatBrDate, isRecurringDate } from '@/lib/validators/dates';
import { zCnpj, zEmail, zBrPhone } from '@/lib/validators';

describe('CNPJ', () => {
  it.each([
    ['11.222.333/0001-81', true],
    ['11222333000181', true],
    ['00.000.000/0001-91', true],
    ['12.345.678/0001-90', false], // dígito errado
    ['11111111111111', false], // todos iguais
    ['11.222.333/0001', false], // tamanho errado
    ['', false],
  ])('isValidCnpj(%s) → %s', (input, expected) => {
    expect(isValidCnpj(input)).toBe(expected);
  });

  it('formatCnpj formata e stripCnpj remove pontuação', () => {
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(stripCnpj('11.222.333/0001-81')).toBe('11222333000181');
  });

  it('zCnpj transforma e rejeita inválidos', () => {
    expect(zCnpj.parse('11.222.333/0001-81')).toBe('11222333000181');
    expect(() => zCnpj.parse('11.111.111/1111-11')).toThrow();
  });
});

describe('CPF', () => {
  it.each([
    ['529.982.247-25', true],
    ['52998224725', true],
    ['111.111.111-11', false],
    ['529.982.247-26', false],
    ['', false],
  ])('isValidCpf(%s) → %s', (input, expected) => {
    expect(isValidCpf(input)).toBe(expected);
  });

  it('formatCpf', () => {
    expect(formatCpf('52998224725')).toBe('529.982.247-25');
  });
});

describe('Phone BR', () => {
  it.each([
    ['+55 11 91234-5678', true],
    ['11912345678', true],
    ['(11) 9 1234-5678', true],
    ['1133334444', true], // fixo
    ['+55 99 91234-5678', true],
    ['11812345678', false], // sem 9 em celular
    ['00912345678', false], // DDD inválido
    ['912345678', false], // sem DDD
  ])('isValidBrPhone(%s) → %s', (input, expected) => {
    expect(isValidBrPhone(input)).toBe(expected);
  });

  it('formatBrPhone para celular e fixo', () => {
    expect(formatBrPhone('11912345678')).toBe('+55 (11) 91234-5678');
    expect(formatBrPhone('1133334444')).toBe('+55 (11) 3333-4444');
  });

  it('normalizeBrPhone remove código de país duplicado', () => {
    expect(normalizeBrPhone('+5511912345678')).toBe('11912345678');
  });

  it('zBrPhone parseia e rejeita', () => {
    expect(zBrPhone.parse('+55 11 91234-5678')).toBe('11912345678');
    expect(() => zBrPhone.parse('123')).toThrow();
  });
});

describe('Email', () => {
  it.each([
    ['user@example.com', true],
    ['fred.marquezini@yahoo.com.br', true],
    ['user+tag@example.co', true],
    ['user@example', false],
    ['user', false],
    ['@example.com', false],
    ['', false],
  ])('isValidEmail(%s) → %s', (input, expected) => {
    expect(isValidEmail(input)).toBe(expected);
  });

  it('normalizeEmail lowercase + trim', () => {
    expect(normalizeEmail('  Fred@Example.COM ')).toBe('fred@example.com');
  });

  it('zEmail normaliza e rejeita', () => {
    expect(zEmail.parse(' Foo@BAR.com ')).toBe('foo@bar.com');
    expect(() => zEmail.parse('not-email')).toThrow();
  });
});

describe('Datas PT-BR', () => {
  it('parseBrDate DD/MM/AAAA', () => {
    const d = parseBrDate('27/06/2026');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(5);
    expect(d?.getDate()).toBe(27);
  });

  it('parseBrDate DD/MM (recorrente)', () => {
    const d = parseBrDate('15/03');
    expect(d).not.toBeNull();
    expect(isRecurringDate(d!)).toBe(true);
  });

  it('parseBrDate rejeita 30/02', () => {
    expect(parseBrDate('30/02/2026')).toBeNull();
  });

  it('formatBrDate', () => {
    expect(formatBrDate(new Date(2026, 5, 27))).toBe('27/06/2026');
    const recurring = parseBrDate('15/03')!;
    expect(formatBrDate(recurring)).toBe('15/03');
  });
});
