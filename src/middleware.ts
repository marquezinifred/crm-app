import { authMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { applySecurityHeaders } from '@/lib/security/headers';

/**
 * Middleware Next.js — Sprint 11 (segurança).
 *
 * Responsabilidades:
 *   1. Validar sessão Clerk (exceto rotas públicas)
 *   2. Extrair tenantId do JWT (claim public.tenantId) e injetar no header
 *   3. Aplicar security headers em todas as respostas (HSTS, CSP, etc.)
 *   4. Encaminhar x-forwarded-for / x-real-ip do dispositivo final
 *      para que UserAccessLog grave IP real (fecha débito Sprint 1)
 *
 * IMPORTANTE: A propagação de tenant para o AsyncLocalStorage do Prisma
 * acontece no entry-point de cada handler (tRPC context, route.ts), NÃO aqui.
 * Esse middleware roda no edge runtime e não tem acesso ao Prisma client.
 */

const PUBLIC_PATHS = [
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/onboarding(.*)',
  '/privacy(.*)',
  '/terms(.*)',
  '/privacy-request(.*)',
  '/p/(.*)', // links públicos (auto-cadastro de contatos, partner_links)
  '/api/v1/health',
  '/api/v1/privacy-request',
  '/api/v1/consent',
  '/api/clerk/webhook',
  '/api/stripe/webhook',
];

function withHeaders(res: NextResponse): NextResponse {
  applySecurityHeaders(res.headers);
  return res;
}

export default authMiddleware({
  publicRoutes: PUBLIC_PATHS,
  afterAuth(auth, req) {
    // Bypass para rotas públicas
    if (auth.isPublicRoute) {
      return withHeaders(NextResponse.next());
    }

    // Sem usuário em rota protegida → manda pro sign-in local
    if (!auth.userId) {
      const url = req.nextUrl.clone();
      url.pathname = '/sign-in';
      url.searchParams.set('redirect_url', req.nextUrl.pathname);
      return withHeaders(NextResponse.redirect(url));
    }

    const sessionClaims = auth.sessionClaims as
      | (Record<string, unknown> & {
          public?: { tenantId?: string; role?: string };
          org_id?: string;
        })
      | null;

    const rawTenantId =
      sessionClaims?.public?.tenantId ?? sessionClaims?.org_id ?? null;
    const tenantId =
      rawTenantId && rawTenantId !== '' && !rawTenantId.includes('{{')
        ? rawTenantId
        : null;

    if (!tenantId) {
      if (req.nextUrl.pathname.startsWith('/api/')) {
        const requestHeaders = new Headers(req.headers);
        requestHeaders.set('x-user-clerk-id', auth.userId);
        return withHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
      }
      const url = req.nextUrl.clone();
      url.pathname = '/onboarding';
      return withHeaders(NextResponse.redirect(url));
    }

    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-tenant-id', tenantId);
    requestHeaders.set('x-user-clerk-id', auth.userId);
    if (sessionClaims?.public?.role) {
      requestHeaders.set('x-user-role', sessionClaims.public.role);
    }

    // Propaga IP real do dispositivo (Sprint 1 débito): mantém
    // x-forwarded-for original (que pode vir de Cloudflare WAF) e
    // garante x-real-ip para handlers downstream.
    const xff = req.headers.get('x-forwarded-for');
    if (xff && !req.headers.get('x-real-ip')) {
      const firstIp = xff.split(',')[0]?.trim();
      if (firstIp) requestHeaders.set('x-real-ip', firstIp);
    }

    return withHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
  },
});

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
