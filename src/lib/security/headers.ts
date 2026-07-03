/**
 * Security headers aplicados pelo middleware Next.js.
 * Sprint 11 — alinhado a §18 do spec (Lei 13.146 + Marco Civil).
 */

const isProd = process.env.NODE_ENV === 'production';

const CSP = [
  "default-src 'self'",
  // Clerk (sign-in/sign-up widgets) e Next.js runtime precisam de scripts inline.
  // 'unsafe-inline' cobre isso; débito de segurança rastreado pra Sprint 16 —
  // trocar por nonces per-request. Sem isso, form de sign-in fica em branco.
  `script-src 'self' 'unsafe-inline' ${isProd ? '' : "'unsafe-eval'"} https://*.clerk.accounts.dev https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: https: blob:",
  "connect-src 'self' https://*.clerk.accounts.dev https://clerk-telemetry.com https://api.openai.com https://api.anthropic.com https://api.resend.com https://brasilapi.com.br",
  "frame-src 'self' https://*.clerk.accounts.dev https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy': CSP,
  ...(isProd
    ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload' }
    : {}),
};

export function applySecurityHeaders(headers: Headers): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    headers.set(k, v);
  }
}
