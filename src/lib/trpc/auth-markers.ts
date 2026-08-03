/**
 * P-82 — Marcadores estáveis de estado de autenticação compartilhados
 * entre o backend (`enforceAuth` em `src/server/trpc/trpc.ts`) e o
 * cliente (`sessionAwareFetch` em `src/lib/trpc/session-guard.ts`).
 *
 * Sem dependências de runtime (só strings) — pode ser importado tanto
 * no servidor quanto num módulo `'use client'`.
 */

/**
 * Estado de provisionamento do usuário resolvido no context tRPC:
 *  - `ANONYMOUS`       — sem clerkId+tenantId nos headers (não logado no
 *                        contexto tenant, ou platform user sem faceta tenant).
 *  - `NOT_PROVISIONED` — sessão Clerk válida + tenantId presente, MAS não
 *                        existe row correspondente em `users` (ex.: pós
 *                        restore Neon PITR). O cliente redireciona para
 *                        `/account-not-found` em vez de recarregar em loop.
 *  - `OK`              — user local resolvido.
 */
export type AuthState = 'ANONYMOUS' | 'NOT_PROVISIONED' | 'OK';

/**
 * Marcador embutido no `message` do `TRPCError` UNAUTHORIZED quando o
 * caller está autenticado no Clerk mas sem provisionamento local. O
 * `sessionAwareFetch` procura essa substring no corpo do 401 para
 * distinguir do 401 "sessão expirada" comum. Não contém PII.
 */
export const USER_NOT_PROVISIONED_MARKER = 'USER_NOT_PROVISIONED';

/**
 * Rota da tela dedicada exibida quando o usuário está autenticado no
 * Clerk mas não tem row local. Não faz chamadas tRPC autenticadas.
 */
export const ACCOUNT_NOT_FOUND_PATH = '/account-not-found';
