import { NextRequest, NextResponse } from 'next/server';

/**
 * Endpoint de bypass de auth para E2E. ATIVO APENAS EM NODE_ENV=test.
 * Em qualquer outro ambiente retorna 404.
 *
 * Usado pelo Playwright fixture (tests/e2e/fixtures/auth.ts).
 */
export const runtime = 'nodejs';

export async function POST(_req: NextRequest) { // eslint-disable-line @typescript-eslint/no-unused-vars
  if (process.env.NODE_ENV !== 'test') {
    return new NextResponse('Not Found', { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
