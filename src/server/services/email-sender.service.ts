import { Resend } from 'resend';
import { env } from '@/lib/env';

let _client: Resend | null = null;
function client(): Resend | null {
  if (_client) return _client;
  if (!env.RESEND_API_KEY) return null;
  _client = new Resend(env.RESEND_API_KEY);
  return _client;
}

/**
 * Circuit breaker simples: após 3 falhas em 60s, abre por 5min.
 */
const breaker = {
  failures: [] as number[],
  openUntil: 0,
};

function trackFailure() {
  const now = Date.now();
  breaker.failures = breaker.failures.filter((t) => now - t < 60_000);
  breaker.failures.push(now);
  if (breaker.failures.length >= 3) {
    breaker.openUntil = now + 5 * 60_000;
    console.warn('[email-sender] circuit aberto por 5 minutos');
  }
}

function trackSuccess() {
  breaker.failures = [];
  breaker.openUntil = 0;
}

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
}

export type SendEmailResult =
  | { ok: true; providerId: string }
  | { ok: false; error: string; circuitOpen?: boolean };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (Date.now() < breaker.openUntil) {
    return { ok: false, error: 'circuit breaker aberto', circuitOpen: true };
  }
  const c = client();
  if (!c) {
    // Em dev sem RESEND_API_KEY apenas loga
    console.info('[email-sender] DRY RUN', {
      to: input.to,
      subject: input.subject,
    });
    return { ok: true, providerId: 'dry-run' };
  }
  try {
    const result = await c.emails.send({
      from: input.from ?? env.RESEND_FROM,
      to: Array.isArray(input.to) ? input.to : [input.to],
      subject: input.subject,
      html: input.html,
    });
    if (result.error) {
      trackFailure();
      return { ok: false, error: result.error.message };
    }
    trackSuccess();
    return { ok: true, providerId: result.data?.id ?? 'unknown' };
  } catch (err) {
    trackFailure();
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

export const __test = { breaker };
