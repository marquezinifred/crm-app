import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/server/db/client';
import { runWithTenant } from '@/server/db/tenant-context';
import { parseFile } from '@/lib/import/parser';
import { audit } from '@/server/services/audit.service';
import { ImportEntity, ImportStatus, Prisma, UserRole } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest) {
  const { userId, sessionClaims } = auth();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const claims = sessionClaims as
    | (Record<string, unknown> & { public?: { tenantId?: string; role?: string } })
    | null;
  const tenantId = claims?.public?.tenantId ?? null;
  const role = (claims?.public?.role ?? 'ANALISTA') as UserRole;
  if (!tenantId) return NextResponse.json({ error: 'sem tenant' }, { status: 403 });

  const form = await req.formData();
  const file = form.get('file');
  const entityRaw = form.get('entity');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'campo "file" obrigatório' }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'arquivo maior que 10 MB' }, { status: 413 });
  }
  if (typeof entityRaw !== 'string') {
    return NextResponse.json({ error: 'campo "entity" obrigatório' }, { status: 400 });
  }
  const entity = entityRaw.toUpperCase() as ImportEntity;
  if (!['COMPANY', 'CONTACT', 'OPPORTUNITY', 'USER'].includes(entity)) {
    return NextResponse.json({ error: 'entity inválida' }, { status: 400 });
  }

  return runWithTenant({ tenantId, userId, role }, async () => {
    const me = await prisma.user.findFirst({
      where: { clerkId: userId, deletedAt: null },
      select: { id: true },
    });
    if (!me) return NextResponse.json({ error: 'user local não encontrado' }, { status: 404 });

    const bytes = new Uint8Array(await file.arrayBuffer());

    let preview;
    try {
      preview = await parseFile(file.name, bytes, { previewOnly: true, previewLimit: 10 });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'falha ao ler arquivo' },
        { status: 400 },
      );
    }

    const job = await prisma.importJob.create({
      data: {
        tenantId,
        entity,
        status: ImportStatus.PENDING,
        fileName: file.name,
        fileBytes: Buffer.from(bytes),
        headersJson: preview.headers as unknown as Prisma.InputJsonValue,
        previewJson: preview.rows as unknown as Prisma.InputJsonValue,
        totalRows: preview.totalRows,
        createdBy: me.id,
      } as Prisma.ImportJobUncheckedCreateInput,
    });

    await audit({
      action: 'import.upload',
      tableName: 'import_jobs',
      recordId: job.id,
      after: { entity, fileName: file.name, totalRows: preview.totalRows },
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
    });

    return NextResponse.json({
      id: job.id,
      headers: preview.headers,
      preview: preview.rows,
      totalRows: preview.totalRows,
    });
  });
}
