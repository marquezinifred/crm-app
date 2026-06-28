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

    // Sem usuário em rota protegida → Clerk redireciona pro sign-in
    if (!auth.userId) {
      return NextResponse.next();
    }

    // Extrai tenantId do JWT — Sprint 1 configura JWT template no Clerk
    // com claim public.tenantId. Antes disso, fallback para org_id ou null.
    const sessionClaims = auth.sessionClaims as
      | (Record<string, unknown> & {
          public?: { tenantId?: string; role?: string };
          org_id?: string;
        })
      | null;

    const tenantId =
      sessionClaims?.public?.tenantId ??
      sessionClaims?.org_id ??
      null;

    if (!tenantId) {
      // Usuário autenticado mas sem tenant → mandar pro onboarding
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
