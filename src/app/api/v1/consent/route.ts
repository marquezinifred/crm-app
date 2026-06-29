import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { ConsentCategory, Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  policyVersion: z.string().min(1).max(40),
  categories: z.array(
    z.object({
      category: z.nativeEnum(ConsentCategory),
      accepted: z.boolean(),
    }),
  ).min(1).max(4),
  subjectEmail: z.string().email().optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }
  const input = parsed.data;

  const ip =
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null;
  const userAgent = req.headers.get('user-agent');
  const tenantId = req.headers.get('x-tenant-id');

  await runAsSystem(async () => {
    for (const c of input.categories) {
      await prisma.consentLog.create({
        data: {
          tenantId: tenantId ?? null,
          subjectEmail: input.subjectEmail ?? null,
          category: c.category,
          accepted: c.accepted,
          policyVersion: input.policyVersion,
          ip,
          userAgent,
        } as Prisma.ConsentLogUncheckedCreateInput,
      });
    }
  });

  return NextResponse.json({ ok: true });
}
