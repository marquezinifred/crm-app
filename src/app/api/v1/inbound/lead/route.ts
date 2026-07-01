import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { makeQueue, QUEUE_NAMES, type InboundLeadCreateJobData } from '@/jobs/queues';
import { checkRate, PUBLIC_FORM_LIMIT } from '@/server/services/rate-limiter.service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Sprint 15D — Endpoint público de captura de leads via webhook.
 *
 * Aceita:
 *   POST /api/v1/inbound/lead?secret=<webhook_secret>
 *   ou header X-Webhook-Secret: <webhook_secret>
 *
 * Fluxo:
 *   1. Rate limit por IP (10 req/min — reusa PUBLIC_FORM_LIMIT da Sprint 11)
 *   2. Lookup do secret em inbound_capture_config → identifica tenant
 *   3. Enfileira no worker inbound-lead-create (parser + criação de opp)
 *   4. Retorna 202 { status: 'queued' }
 *
 * Segurança:
 *   - Secret rotacionável via UI /admin/email-inbound (Fase 5)
 *   - webhookEnabled=false no config bloqueia mesmo com secret válido
 *   - Rate limit por IP evita abuso público
 *
 * O worker consulta blacklist_domains do config, roda parser, dedup
 * company/contact e cria opp em PROSPECT sem owner.
 */
export async function POST(req: NextRequest) {
  // 1. Rate limit — se Redis down, PUBLIC_FORM_LIMIT falha open (Sprint 11)
  const ip =
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  const rl = await checkRate(
    `inbound-lead:${ip}`,
    PUBLIC_FORM_LIMIT.limit,
    PUBLIC_FORM_LIMIT.windowSeconds,
  );
  if (!rl.allowed) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000),
    );
    return NextResponse.json(
      { error: 'rate_limited', retryAfterSeconds },
      { status: 429, headers: { 'retry-after': String(retryAfterSeconds) } },
    );
  }

  // 2. Secret via query string ou header
  const secret =
    req.nextUrl.searchParams.get('secret') ??
    req.headers.get('x-webhook-secret');
  if (!secret) {
    return NextResponse.json({ error: 'missing_secret' }, { status: 401 });
  }

  // 3. Lookup config pelo secret (partial UNIQUE index cobre)
  const config = await runAsSystem(() =>
    prisma.inboundCaptureConfig.findFirst({
      where: { webhookSecret: secret },
      select: { tenantId: true, webhookEnabled: true },
    }),
  );
  if (!config) {
    return NextResponse.json({ error: 'invalid_secret' }, { status: 401 });
  }
  if (!config.webhookEnabled) {
    return NextResponse.json({ error: 'webhook_disabled' }, { status: 403 });
  }

  // 4. Body — aceita JSON. Sem JSON, 400.
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // 5. Enfileira. receivedAt do body se veio ISO válido; senão now().
  let receivedAt = new Date();
  if (typeof body.received_at === 'string') {
    const parsed = new Date(body.received_at);
    if (Number.isFinite(parsed.getTime())) receivedAt = parsed;
  }

  const source =
    typeof body.source === 'string' && body.source.trim().length > 0
      ? (body.source as InboundLeadCreateJobData['source'])
      : 'webhook_custom';

  const queue = makeQueue<InboundLeadCreateJobData>(QUEUE_NAMES.inboundLeadCreate);
  await queue.add('process', {
    tenantId: config.tenantId,
    source,
    raw: body,
    receivedAt: receivedAt.toISOString(),
    originIdentifier: `webhook:${secret.slice(0, 6)}…`,
  });

  return NextResponse.json({ status: 'queued' }, { status: 202 });
}
