import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { createDataSubjectRequest } from '@/server/services/privacy-workflow.service';
import { checkRate, publicFormKey, PUBLIC_FORM_LIMIT } from '@/server/services/rate-limiter.service';
import { DataSubjectRequestType } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const payloadSchema = z.object({
  tenantSlug: z.string().min(2).max(60),
  requestType: z.nativeEnum(DataSubjectRequestType),
  subjectEmail: z.string().email(),
  subjectName: z.string().max(160).optional(),
  description: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  const rl = await checkRate(publicFormKey(ip, 'privacy'), PUBLIC_FORM_LIMIT.limit, PUBLIC_FORM_LIMIT.windowSeconds);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Muitas solicitações. Tente novamente em alguns minutos.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }
  const input = parsed.data;

  const tenant = await runAsSystem(() =>
    prisma.tenant.findUnique({ where: { slug: input.tenantSlug }, select: { id: true } }),
  );
  if (!tenant) return NextResponse.json({ error: 'Tenant não encontrado' }, { status: 404 });

  const request = await createDataSubjectRequest({
    tenantId: tenant.id,
    requestType: input.requestType,
    subjectEmail: input.subjectEmail,
    subjectName: input.subjectName,
    description: input.description,
    ip,
    userAgent: req.headers.get('user-agent'),
  });

  return NextResponse.json({ ok: true, requestId: request.id, dueAt: request.dueAt });
}
