import { authMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';
import { applySecurityHeaders } from '@/lib/security/headers';

/**
 * Middleware Next.js — Sprint 11 (segurança) + fix Sprint 15A.
 *
 * Responsabilidades:
 *   1. Validar sessão Clerk (exceto rotas públicas)
 *   2. Extrair tenantId do JWT (claim public.tenantId) e injetar no header
 *   3. Aplicar security headers em todas as respostas (HSTS, CSP, etc.)
 *   4. Encaminhar x-forwarded-for / x-real-ip do dispositivo final
 *      para que UserAccessLog grave IP real (fecha débito Sprint 1)
 *
 * IMPORTANTE: chamadas para `/api/*` JAMAIS recebem redirect HTML —
 * sempre 401/403 JSON. Isso evita o bug "Unexpected token '<', '<!DOCTYPE'..."
 * no cliente tRPC quando a sessão expira no meio de uma mutation.
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

/**
 * Retorna `true` se a request alvo é uma chamada de API/tRPC que
 * NUNCA deve receber redirect HTML.
 */
export function isApiRequest(req: NextRequest): boolean {
  const path = req.nextUrl.pathname;
  return path.startsWith('/api/trpc/') || path.startsWith('/api/v1/') || path.startsWith('/api/platform/');
}

/**
 * Resposta JSON padronizada para erros de auth em chamadas de API.
 * Mantém os security headers aplicados.
 */
export function apiAuthError(
  status: 401 | 403,
  message: string,
): NextResponse {
  const res = new NextResponse(
    JSON.stringify({ error: { code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', message } }),
    { status, headers: { 'content-type': 'application/json' } },
  );
  return withHeaders(res);
}

export default authMiddleware({
  publicRoutes: PUBLIC_PATHS,
  afterAuth(auth, req) {
    // Bypass para rotas públicas
    if (auth.isPublicRoute) {
      return withHeaders(NextResponse.next());
    }

    // Sem usuário em rota protegida.
    // - API/tRPC → 401 JSON (cliente tRPC trata como TRPCClientError normal)
    // - Página → redirect /sign-in com retorno preservado
    if (!auth.userId) {
      if (isApiRequest(req)) {
        return apiAuthError(401, 'Sessão expirada ou ausente. Faça login novamente.');
      }
      const url = req.nextUrl.clone();
      url.pathname = '/sign-in';
      url.searchParams.set('redirect_url', req.nextUrl.pathname);
      return withHeaders(NextResponse.redirect(url));
    }

    const sessionClaims = auth.sessionClaims as
      | (Record<string, unknown> & {
          public?: { tenantId?: string; role?: string; platformRole?: string };
          org_id?: string;
        })
      | null;

    const rawPlatformRole = sessionClaims?.public?.platformRole;
    const platformRole =
      rawPlatformRole && !rawPlatformRole.includes('{{')
        ? rawPlatformRole
        : null;

    const path = req.nextUrl.pathname;
    const isPlatformRoute = path.startsWith('/platform') || path.startsWith('/api/platform');

    // Sprint 15A — /platform/* exige PLATFORM_OWNER (não exige tenantId)
    if (isPlatformRoute) {
      if (platformRole !== 'PLATFORM_OWNER') {
        if (isApiRequest(req)) {
          return apiAuthError(403, 'Acesso restrito a Platform Owners.');
        }
        const url = req.nextUrl.clone();
        url.pathname = '/';
        return withHeaders(NextResponse.redirect(url));
      }
      const platHeaders = new Headers(req.headers);
      platHeaders.set('x-platform-user-clerk-id', auth.userId);
      platHeaders.set('x-platform-role', platformRole);
      const xff = req.headers.get('x-forwarded-for');
      if (xff && !req.headers.get('x-real-ip')) {
        const firstIp = xff.split(',')[0]?.trim();
        if (firstIp) platHeaders.set('x-real-ip', firstIp);
      }
      return withHeaders(NextResponse.next({ request: { headers: platHeaders } }));
    }

    const rawTenantId =
      sessionClaims?.public?.tenantId ?? sessionClaims?.org_id ?? null;
    const tenantId =
      rawTenantId && rawTenantId !== '' && !rawTenantId.includes('{{')
        ? rawTenantId
        : null;

    // Platform Owner sem tenant ativo navegando para rotas não-platform:
    // redireciona para /platform/dashboard em vez de /onboarding.
    if (!tenantId && platformRole === 'PLATFORM_OWNER') {
      if (isApiRequest(req)) {
        // Em chamadas API, deixa o tRPC responder (procedure decide se
        // precisa de tenant); só não redireciona para HTML.
        const requestHeaders = new Headers(req.headers);
        requestHeaders.set('x-platform-user-clerk-id', auth.userId);
        requestHeaders.set('x-platform-role', 'PLATFORM_OWNER');
        return withHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
      }
      const url = req.nextUrl.clone();
      url.pathname = '/platform/dashboard';
      return withHeaders(NextResponse.redirect(url));
    }

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
