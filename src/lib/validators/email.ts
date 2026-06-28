/**
 * Validação de e-mail RFC 5322-lite + normalização (lowercase, trim).
 * Não fazemos validação MX — fica para fluxo de confirmação assíncrono.
 */

const EMAIL_RE =
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z]{2,})+$/;

export function isValidEmail(input: string | null | undefined): boolean {
  if (!input) return false;
  const trimmed = input.trim();
  if (trimmed.length > 254) return false;
  return EMAIL_RE.test(trimmed);
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}
