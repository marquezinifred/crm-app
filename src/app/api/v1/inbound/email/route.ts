import { NextRequest, NextResponse } from 'next/server';
import {
  ingestInboundEmail,
  fromPostmark,
  fromResend,
  type InboundPayload,
} from '@/server/services/inbound-email.service';
import { tryAutoLink } from '@/server/services/email-link.service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Webhook inbound de e-mail. Aceita Postmark, Resend ou payload genérico.
 * Detecção do formato:
 *   - `FromFull` presente → Postmark
 *   - `from.email` ou `from` string → Resend
 *   - resto: tenta formato genérico (from/to/subject/text)
 *
 * NOTA: Sprint 11 adiciona verificação de assinatura (HMAC do provider).
 * Por enquanto, segurança é via segredo no path (?secret=...) configurado
 * no provider — definida em INBOUND_WEBHOOK_SECRET (opcional).
 */

function detectAndNormalize(body: Record<string, unknown>): InboundPayload | null {
  if (body.FromFull || body.From) return fromPostmark(body);
  if ((body.from && typeof body.from === 'object') || body.created_at) return fromResend(body);
  if (body.from && body.to) {
    return {
      from: String(body.from),
      to: Array.isArray(body.to) ? body.to.map(String) : [String(body.to)],
      cc: Array.isArray(body.cc) ? body.cc.map(String) : [],
      subject: body.subject ? String(body.subject) : null,
      textBody: body.text ? String(body.text) : null,
      htmlBody: body.html ? String(body.html) : null,
      receivedAt: new Date(),
      rawPayload: body,
    };
  }
  return null;
}

export async function POST(req: NextRequest) {
  const expected = process.env.INBOUND_WEBHOOK_SECRET;
  if (expected) {
    const provided = req.nextUrl.searchParams.get('secret');
    if (provided !== expected) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const normalized = detectAndNormalize(body);
  if (!normalized) {
    return NextResponse.json({ error: 'formato não reconhecido' }, { status: 400 });
  }

  const result = await ingestInboundEmail(normalized);
  if (!result.ok || !result.incomingEmailId || !result.tenantId) {
    return NextResponse.json({ error: result.reason }, { status: 422 });
  }

  // Tentativa de vinculação imediata (não bloqueia falha)
  try {
    await tryAutoLink(result.incomingEmailId, result.tenantId);
  } catch (err) {
    console.error('[inbound-email] tryAutoLink falhou', err);
  }

  return NextResponse.json({
    ok: true,
    incomingEmailId: result.incomingEmailId,
  });
}
