/**
 * Validação e formatação de telefone brasileiro.
 * Aceita formatos: +5511912345678, (11) 91234-5678, 11912345678, 1133334444.
 *
 * Regras (ANATEL):
 *   - 10 dígitos (fixo) ou 11 dígitos (celular com 9 inicial)
 *   - DDD válido (11 a 99)
 *   - Celular: primeiro dígito após DDD deve ser 9
 */

const PHONE_DIGITS_RE = /\D/g;

const VALID_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export function stripPhone(input: string): string {
  return input.replace(PHONE_DIGITS_RE, '');
}

export function normalizeBrPhone(input: string): string {
  let digits = stripPhone(input);
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  }
  return digits;
}

export function isValidBrPhone(input: string | null | undefined): boolean {
  if (!input) return false;
  const digits = normalizeBrPhone(input);
  if (digits.length !== 10 && digits.length !== 11) return false;
  const ddd = Number(digits.slice(0, 2));
  if (!VALID_DDDS.has(ddd)) return false;
  if (digits.length === 11 && digits[2] !== '9') return false;
  return true;
}

export function formatBrPhone(input: string): string {
  const digits = normalizeBrPhone(input);
  if (digits.length === 11) {
    return `+55 (${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `+55 (${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return input;
}
