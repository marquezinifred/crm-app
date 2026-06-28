/**
 * Validação de CPF — algoritmo oficial (módulo 11).
 * Aceita CPF formatado (000.000.000-00) ou só dígitos (11 caracteres).
 */

const CPF_DIGITS_RE = /\D/g;

export function stripCpf(input: string): string {
  return input.replace(CPF_DIGITS_RE, '');
}

export function formatCpf(input: string): string {
  const digits = stripCpf(input);
  if (digits.length !== 11) return input;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

export function isValidCpf(input: string | null | undefined): boolean {
  if (!input) return false;
  const digits = stripCpf(input);
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const calc = (length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += Number(digits[i]) * (length + 1 - i);
    }
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  if (calc(9) !== Number(digits[9])) return false;
  if (calc(10) !== Number(digits[10])) return false;
  return true;
}
