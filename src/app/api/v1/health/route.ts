import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const checks = {
    app: 'ok' as const,
    db: 'unknown' as 'ok' | 'fail' | 'unknown',
    dbLatencyMs: -1,
  };

  const t0 = Date.now();
  try {
    await runAsSystem(async () => {
      await prisma.$queryRaw`SELECT 1 AS ok`;
    });
    checks.db = 'ok';
    checks.dbLatencyMs = Date.now() - t0;
  } catch (err) {
    checks.db = 'fail';
    checks.dbLatencyMs = Date.now() - t0;
    return NextResponse.json(
      {
        status: 'fail',
        checks,
        error: err instanceof Error ? err.message : 'unknown',
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ status: 'ok', checks });
}
