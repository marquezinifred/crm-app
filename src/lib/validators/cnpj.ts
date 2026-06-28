/**
 * Validação de CNPJ — algoritmo oficial da Receita Federal (dígitos verificadores).
 *
 * Aceita CNPJ formatado (00.000.000/0000-00) ou só dígitos (14 caracteres).
 * Rejeita CNPJs com todos os dígitos iguais (00000000000000, 11111111111111…)
 * e sequências reconhecidamente inválidas.
 */

const CNPJ_DIGITS_RE = /\D/g;

export function stripCnpj(input: string): string {
  return input.replace(CNPJ_DIGITS_RE, '');
}

export function formatCnpj(input: string): string {
  const digits = stripCnpj(input);
  if (digits.length !== 14) return input;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
}

export function isValidCnpj(input: string | null | undefined): boolean {
  if (!input) return false;
  const digits = stripCnpj(input);
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const calcDigit = (slice: string, weights: number[]): number => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      sum += Number(slice[i]) * weights[i]!;
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const weightsD1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weightsD2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calcDigit(digits.slice(0, 12), weightsD1);
  if (d1 !== Number(digits[12])) return false;

  const d2 = calcDigit(digits.slice(0, 13), weightsD2);
  if (d2 !== Number(digits[13])) return false;

  return true;
}
