import { Prisma } from '@prisma/client';

/**
 * P-110 — Retry/backoff transparente para o cold-start do Neon serverless.
 *
 * O compute do Neon `production-live` auto-suspende após ~5min de
 * inatividade. A PRIMEIRA request depois da suspensão pega o compute
 * acordando e o Prisma falha com `P1001` (Can't reach database server) /
 * `P1002` (timeout na conexão) — a mensagem crua CONTÉM o host do banco
 * (`ep-rapid-fog-...-pooler...`). O Neon auto-resume na 1ª conexão
 * (medido ~1.2s), então um retry curto atravessa o cold-start.
 *
 * Este módulo NÃO reescreve a Prisma extension (choke point P-42): ele é
 * um WRAPPER externo puro, testável isoladamente e injetável nos testes.
 */

/**
 * Mensagem sanitizada exposta ao cliente quando o retry se esgota. NUNCA
 * contém host / connection string.
 *
 * Integração com o pipeline de erro do tRPC (sem tocar `trpc.ts`):
 *  • `runMapErrors` re-lança Error desconhecida INTACTA (não é
 *    `ForbiddenError`, não casa `[tenant-isolation]`) → tRPC serializa
 *    `shape.message` = esta string → `friendlyTrpcError` cai no
 *    `err.message`. Cliente vê a mensagem limpa, sem host.
 *  • NÃO usa o prefixo `[tenant-isolation]` → não colide com o mapper
 *    P-46. NÃO é `ForbiddenError` → não colide com o wrap P-105.
 */
export const DB_UNAVAILABLE_PUBLIC_MESSAGE =
  'Serviço temporariamente indisponível. Tente novamente em instantes.';

/**
 * Erro sanitizado lançado quando o cold-start não é atravessado dentro do
 * orçamento de retries. `message` é limpa (sem host). O erro original de
 * conexão (que contém o host) fica preservado em `cause` — SÓ para
 * Sentry/observabilidade server-side; o `errorFormatter` do tRPC não copia
 * `cause` para o shape enviado ao cliente.
 */
export class DatabaseUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(DB_UNAVAILABLE_PUBLIC_MESSAGE);
    this.name = 'DatabaseUnavailableError';
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Códigos Prisma de falha de CONEXÃO pré-execução — a conexão NÃO foi
 * estabelecida, então NADA foi executado nem commitado → re-tentar a
 * operação inteira é seguro (inclusive dentro de `$transaction`: a
 * transação falhou antes de abrir).
 *   P1001 — Can't reach database server
 *   P1002 — Database server timeout na conexão
 *
 * NUNCA inclui P2xxx (query/constraint/validação — podem ter executado
 * parcialmente), nem `ForbiddenError`, nem tenant-isolation.
 */
const TRANSIENT_CONNECTION_CODES = new Set(['P1001', 'P1002']);

/**
 * `true` SÓ para erros de conexão pré-execução (P1001/P1002).
 *
 * Ordem defensiva:
 *  1. Exclui explicitamente `ForbiddenError`/`TRPCError` e erros com
 *     prefixo `[tenant-isolation]`/`[transfer-guard]` — nunca transientes
 *     (o guard de transferência 15G.5 e o backstop P-42 lançam esses de
 *     DENTRO da extension, e o retry os envolve; re-tentá-los seria
 *     incorreto).
 *  2. Casa `err.code` de `PrismaClientKnownRequestError` e `errorCode` de
 *     `PrismaClientInitializationError`.
 *  3. Fallback DEFENSIVO por mensagem ("Can't reach database server"),
 *     restrito a instâncias Prisma de conexão/init — cobre o caso raro de
 *     erro sem `code` estruturado, sem nunca ampliar para P2xxx.
 */
export function isTransientConnectionError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;

  const name = (err as { name?: unknown }).name;
  if (name === 'ForbiddenError' || name === 'TRPCError') return false;

  const message =
    typeof (err as { message?: unknown }).message === 'string'
      ? (err as { message: string }).message
      : '';
  if (
    message.startsWith('[tenant-isolation]') ||
    message.startsWith('[transfer-guard]')
  ) {
    return false;
  }

  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && TRANSIENT_CONNECTION_CODES.has(code)) {
    return true;
  }
  const errorCode = (err as { errorCode?: unknown }).errorCode;
  if (typeof errorCode === 'string' && TRANSIENT_CONNECTION_CODES.has(errorCode)) {
    return true;
  }

  // Fallback defensivo: só instâncias Prisma de conexão/init, só o padrão
  // de "servidor inalcançável". Nunca casa P2xxx (constraint/validação).
  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientKnownRequestError
  ) {
    return /can'?t reach database server/i.test(message);
  }
  return false;
}

export interface ConnectionRetryOptions {
  /** Tentativas totais (default 3: inicial + 2 retries). */
  maxAttempts?: number;
  /**
   * Delays (ms) ANTES de cada retry. Com 3 tentativas usa os 2 primeiros
   * (300ms após a 1ª falha, 1000ms após a 2ª) → 3ª tentativa em ~1.3s,
   * cruzando o wake de ~1.2s do Neon. Terceiro valor (2000ms) reservado
   * caso `maxAttempts` seja elevado. Máx de espera acumulada com o default:
   * ~1.3s — mantém baixo o blast-radius numa indisponibilidade real.
   */
  backoffMs?: number[];
  /** Injetável nos testes (fake timers). Default: setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = [300, 1000, 2000];
const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executa `fn`, re-tentando SÓ em erros de conexão pré-execução
 * (`isTransientConnectionError`). Qualquer outro erro propaga IMEDIATO
 * (zero retry). Ao esgotar as tentativas, lança `DatabaseUnavailableError`
 * (mensagem sanitizada, sem host; erro original em `cause`).
 *
 * IMPORTANTE (ALS): `fn` é re-invocada DENTRO da mesma cadeia async — o
 * `await sleep()` preserva o `AsyncLocalStorage` do tenant/userId
 * (`runWithTenant`/`runAsSystem`). Não capturamos thunk lazy fora do
 * escopo (ver memory `als-lazy-thunk-fail-closed`): quem chama passa
 * `() => query(args)`, avaliado a cada tentativa no mesmo contexto.
 */
export async function withConnectionRetry<T>(
  fn: () => Promise<T>,
  opts: ConnectionRetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleep = opts.sleep ?? defaultSleep;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientConnectionError(err)) throw err;
      lastErr = err;
      if (attempt >= maxAttempts) break;
      const delay = backoff[attempt - 1] ?? backoff[backoff.length - 1] ?? 0;
      await sleep(delay);
    }
  }
  throw new DatabaseUnavailableError(lastErr);
}
