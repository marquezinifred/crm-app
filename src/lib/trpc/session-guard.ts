'use client';

/**
 * P-13 / P-82 — Session guard fetch para o cliente tRPC.
 *
 * Contexto: `src/middleware.ts` retorna JSON custom
 * `{ error: { code, message } }` com HTTP 401 quando a sessão Clerk
 * expira em `/api/trpc/*`. Esse envelope não bate com o formato que
 * o `@trpc/react-query` + superjson esperam, e o cliente lança
 * `TRPCClientError('Unable to transform response from server')` —
 * mensagem que não indica ao usuário que a solução é recarregar.
 *
 * Este fetch intercepta a response e trata 401 em dois casos:
 *
 *  1. **Sessão expirada (P-13)** — dispara reload automático em ~800ms
 *     (tempo pro console.warn ficar visível). Response é retornada
 *     intocada — o cliente tRPC ainda lança o erro genérico, mas o
 *     reload acontece antes do usuário ler.
 *
 *  2. **Conta autenticada sem provisionamento (P-82)** — quando o corpo
 *     do 401 carrega o marcador `USER_NOT_PROVISIONED` (sessão Clerk
 *     válida + tenantId, mas sem row local em `users`), recarregar não
 *     resolve nada: o estado não muda e vira loop infinito. Aqui
 *     redirecionamos para `/account-not-found` (uma vez) em vez de
 *     recarregar. A tela oferece "Sair" pra trocar de conta.
 *
 * Idempotente por página: `handling401` bloqueia N ações num batch
 * tRPC de N procedures (batch = N 401s ao mesmo tempo). A flag reseta
 * naturalmente porque o reload/redirect recria o módulo.
 *
 * Silencioso em rotas públicas (`/sign-in`, `/sign-up`, `/`, etc.) e na
 * própria `/account-not-found` — já estamos numa tela sem sessão útil,
 * não faz sentido recarregar nem redirecionar em loop.
 */

import { ACCOUNT_NOT_FOUND_PATH, USER_NOT_PROVISIONED_MARKER } from './auth-markers';

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

  const pathname = window.location.pathname;
  if (isPublicPath(pathname)) return response;
  // P-82 — já na tela dedicada: não redirecionar/recarregar em loop.
  if (pathname === ACCOUNT_NOT_FOUND_PATH) return response;

  // Parse defensivo do corpo do 401 — pode ser o JSON custom do
  // middleware (`{ error: { message } }`) OU o envelope tRPC (batch:
  // array de `{ error: { json: { message } } }`). Serializamos e
  // procuramos o marcador estável, robusto a ambos os formatos.
  let body: unknown = null;
  try {
    body = await response.clone().json();
  } catch {
    // body não é JSON válido — trata como 401 comum (sessão expirada)
  }
  const serialized = safeStringify(body);

  handling401 = true;

  // P-82 — conta autenticada mas sem row local: redireciona (não recarrega).
  if (serialized.includes(USER_NOT_PROVISIONED_MARKER)) {
    console.warn(
      '[session-guard]',
      'Conta autenticada sem provisionamento neste workspace. Redirecionando…',
    );
    window.location.assign(ACCOUNT_NOT_FOUND_PATH);
    return response;
  }

  // P-13 — sessão expirada: reload em ~800ms.
  let message = 'Sua sessão expirou. Recarregando…';
  const errorMessage = (body as { error?: { message?: unknown } } | null)?.error?.message;
  if (typeof errorMessage === 'string') {
    message = `${errorMessage} Recarregando…`;
  }

  console.warn('[session-guard]', message);

  setTimeout(() => {
    window.location.reload();
  }, 800);

  return response;
};

function safeStringify(value: unknown): string {
  if (value == null) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}
