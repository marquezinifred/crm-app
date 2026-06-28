import { authMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

/**
 * Middleware Next.js — Sprint 0
 *
 * Responsabilidades:
 *   1. Validar sessão Clerk (exceto rotas públicas)
 *   2. Extrair tenantId do JWT (claim public.tenantId — setado no Sprint 1
 *      via Clerk JWT template) e injetar no header x-tenant-id
 *   3. Bloquear requisições sem tenant em rotas autenticadas
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
  '/p/(.*)', // links públicos (auto-cadastro de contatos, partner_links)
  '/api/v1/health',
  '/api/clerk/webhook',
  '/api/stripe/webhook',
];

export default authMiddleware({
  publicRoutes: PUBLIC_PATHS,
  afterAuth(auth, req) {
    // Bypass para rotas públicas
    if (auth.isPublicRoute) {
      return NextResponse.next();
    }

    // Sem usuário em rota protegida → manda pro sign-in local
    if (!auth.userId) {
      const url = req.nextUrl.clone();
      url.pathname = '/sign-in';
      url.searchParams.set('redirect_url', req.nextUrl.pathname);
      return NextResponse.redirect(url);
    }

    // Extrai tenantId do JWT — Sprint 1 configura JWT template no Clerk
    // com claim public.tenantId. Antes disso, fallback para org_id ou null.
    const sessionClaims = auth.sessionClaims as
      | (Record<string, unknown> & {
          public?: { tenantId?: string; role?: string };
          org_id?: string;
        })
      | null;

    const rawTenantId =
      sessionClaims?.public?.tenantId ??
      sessionClaims?.org_id ??
      null;
    // Trata string vazia e o literal não-substituído do template
    const tenantId =
      rawTenantId && rawTenantId !== '' && !rawTenantId.includes('{{')
        ? rawTenantId
        : null;

    if (!tenantId) {
      // Sem tenant: rotas tRPC e API seguem (a procedure responsável,
      // ex: onboarding.createFirstTenant, é quem cria o tenant — e
      // outras procedures retornam UNAUTHORIZED em JSON, não HTML).
      // Página de UI redireciona pro onboarding.
      if (req.nextUrl.pathname.startsWith('/api/')) {
        const requestHeaders = new Headers(req.headers);
        requestHeaders.set('x-user-clerk-id', auth.userId);
        return NextResponse.next({ request: { headers: requestHeaders } });
      }
      const url = req.nextUrl.clone();
      url.pathname = '/onboarding';
      return NextResponse.redirect(url);
    }

    // Propaga tenant via header (server components / route handlers leem daí)
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-tenant-id', tenantId);
    requestHeaders.set('x-user-clerk-id', auth.userId);
    if (sessionClaims?.public?.role) {
      requestHeaders.set('x-user-role', sessionClaims.public.role);
    }

    return NextResponse.next({ request: { headers: requestHeaders } });
  },
});

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
