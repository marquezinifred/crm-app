import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { runWithTenant } from '@/server/db/tenant-context';
import { prisma } from '@/server/db/client';
import {
  computeFunnel,
  performanceByOwner,
  projectRevenue,
  type OpportunitySnap,
} from '@/server/services/analytics.service';
import { buildExcelReport } from '@/server/services/excel-export.service';
import { audit } from '@/server/services/audit.service';
import type { OpportunityStage, UserRole } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { userId, sessionClaims } = auth();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const claims = sessionClaims as
    | (Record<string, unknown> & { public?: { tenantId?: string; role?: string } })
    | null;
  const tenantId = claims?.public?.tenantId ?? null;
  const role = (claims?.public?.role ?? 'ANALISTA') as UserRole;
  if (!tenantId) return NextResponse.json({ error: 'tenant não definido' }, { status: 403 });

  return runWithTenant({ tenantId, userId, role }, async () => {
    const me = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true, role: true },
    });
    if (!me) return NextResponse.json({ error: 'user não encontrado' }, { status: 404 });

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, conversionRates: true },
    });
    if (!tenant) return NextResponse.json({ error: 'tenant não encontrado' }, { status: 404 });

    const oppsRaw = await prisma.opportunity.findMany({
      where: { deletedAt: null },
      include: { owner: { select: { fullName: true } } },
    });

    const opps: OpportunitySnap[] = oppsRaw.map((o) => ({
      id: o.id,
      stage: o.stage,
      status: o.status,
      estimatedValue: Number(o.estimatedValue ?? 0),
      closedValue: o.closedValue ? Number(o.closedValue) : null,
      ownerId: o.ownerId,
      ownerName: o.owner?.fullName ?? '—',
      lossReason: o.lossReason,
      createdAt: o.createdAt,
      currentStageEnteredAt: o.currentStageEnteredAt,
      actualCloseDate: o.actualCloseDate,
    }));

    const funnel = computeFunnel(opps);
    const perf = performanceByOwner(opps);
    const rates = (tenant.conversionRates as Partial<Record<OpportunityStage, number>>) ?? {};
    const proj = projectRevenue(opps, rates);

    const buf = await buildExcelReport({
      tenantName: tenant.name,
      generatedAt: new Date(),
      funnel,
      performance: perf,
      projection: proj,
    });

    await audit({
      action: 'report.export_xlsx',
      tableName: 'tenants',
      recordId: tenantId,
      after: { rows: opps.length },
      ip:
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        req.headers.get('x-real-ip') ??
        null,
      userAgent: req.headers.get('user-agent'),
    });

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="crm-report-${Date.now()}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  });
}
