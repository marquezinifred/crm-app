'use client';

/**
 * P-13 — Session guard fetch para o cliente tRPC.
 *
 * Contexto: `src/middleware.ts` retorna JSON custom
 * `{ error: { code, message } }` com HTTP 401 quando a sessão Clerk
 * expira em `/api/trpc/*`. Esse envelope não bate com o formato que
 * o `@trpc/react-query` + superjson esperam, e o cliente lança
 * `TRPCClientError('Unable to transform response from server')` —
 * mensagem que não indica ao usuário que a solução é recarregar.
 *
 * Este fetch intercepta a response, e num 401 dispara reload
 * automático em ~800ms (tempo pra o console.warn ficar visível).
 * Response é retornada intocada — o cliente tRPC ainda lança o erro
 * genérico, mas o reload acontece antes do usuário ler.
 *
 * Idempotente por página: `handling401` bloqueia N reloads num
 * batch tRPC de N procedures (batch = N 401s ao mesmo tempo).
 * A flag reseta naturalmente porque o reload recria o módulo.
 *
 * Silencioso em rotas públicas (`/sign-in`, `/sign-up`, `/`, etc.) —
 * já estamos no login, não faz sentido recarregar em loop.
 */

let handling401 = false;

/**
 * Rotas onde a interceptação é no-op. Precisam bater com
 * `PUBLIC_PATHS` do middleware. Comparação por prefixo — cobre
 * `/sign-in`, `/sign-in/factor-two`, `/p/xxx/contact`, etc.
 */
const PUBLIC_PREFIXES = [
  '/sign-in',
  '/sign-up',
  '/onboarding',
  '/privacy',
  '/terms',
  '/privacy-request',
  '/p/',
];

export function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(p));
}

/**
 * Exposto pra testes reiniciarem a flag entre casos.
 */
export function __resetSessionGuardForTests(): void {
  handling401 = false;
}

export const sessionAwareFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);

  if (response.status !== 401) return response;
  if (handling401) return response;
  if (typeof window === 'undefined') return response;
  if (isPublicPath(window.location.pathname)) return response;

  handling401 = true;

  let message = 'Sua sessão expirou. Recarregando…';
  try {
    const body = await response.clone().json();
    if (body?.error?.message && typeof body.error.message === 'string') {
      message = `${body.error.message} Recarregando…`;
    }
  } catch {
    // body não é JSON válido — mantém mensagem padrão
  }

  console.warn('[session-guard]', message);

  setTimeout(() => {
    window.location.reload();
  }, 800);

  return response;
};
