/**
 * Structured logger com destino Axiom.
 *
 * P-35 — Sem `AXIOM_TOKEN` + `AXIOM_DATASET`, todas as chamadas são
 * no-op (não crasham, não bufferam). Isso mantém `npm run dev` limpo
 * em ambiente local sem obrigar setup.
 *
 * Eventos vão para o dataset configurado com shape padronizado:
 *   {
 *     _time: ISO string (server-side; Axiom aceita esse formato),
 *     level: 'debug' | 'info' | 'warn' | 'error',
 *     category: string  (ex: 'audit', 'ai_usage', 'worker_job', 'trpc'),
 *     ...payload
 *   }
 *
 * Não incluir PII no payload — a política do CLAUDE.md é DataMasking
 * antes de qualquer sink externo. Cada categoria whitelista os campos.
 */

import { Axiom } from '@axiomhq/js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let axiomClient: Axiom | null = null;
let dataset: string | null = null;
let initialized = false;

function init() {
  if (initialized) return;
  initialized = true;
  const token = process.env.AXIOM_TOKEN;
  const ds = process.env.AXIOM_DATASET;
  if (!token || !ds) return;
  try {
    axiomClient = new Axiom({
      token,
      onError: (err) => {
        // Não relançar — se Axiom cair, o app não pode cair junto.
        console.warn('[axiom] falha ao enviar batch:', err.message);
      },
    });
    dataset = ds;
  } catch (err) {
    console.warn('[axiom] init falhou:', err);
    axiomClient = null;
    dataset = null;
  }
}

export function isAxiomEnabled(): boolean {
  init();
  return axiomClient !== null && dataset !== null;
}

interface LogInput {
  category: string;
  level?: LogLevel;
  message?: string;
  [key: string]: unknown;
}

export function log(input: LogInput): void {
  init();
  if (!axiomClient || !dataset) return;
  try {
    const level = input.level ?? 'info';
    axiomClient.ingest(dataset, [
      {
        _time: new Date().toISOString(),
        level,
        ...input,
      },
    ]);
  } catch (err) {
    console.warn('[axiom] log falhou:', err);
  }
}

/**
 * Força flush imediato do batch buffer — usar em workers antes de
 * `process.exit()` ou quando quiser garantir que um evento crítico
 * chegou. No path de request/response o batching normal do SDK cobre.
 */
export async function flush(): Promise<void> {
  init();
  if (!axiomClient) return;
  try {
    await axiomClient.flush();
  } catch (err) {
    console.warn('[axiom] flush falhou:', err);
  }
}

// ─── Categorias padronizadas ──────────────────────────────────────

export interface AuditLogEvent {
  action: string;
  tableName: string;
  recordId: string;
  tenantId: string | null;
  userId: string | null;
  ok: boolean;
}

export function logAudit(evt: AuditLogEvent): void {
  log({ category: 'audit', ...evt });
}

export interface AiUsageLogEvent {
  requestType: string;
  tenantId: string;
  provider: string;
  configuredProvider?: string | null;
  model: string;
  usedFallback: boolean;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  costBrl?: number;
  latencyMs?: number | null;
  success: boolean;
  errorCode?: string | null;
}

export function logAiUsage(evt: AiUsageLogEvent): void {
  log({ category: 'ai_usage', ...evt });
}

export interface WorkerJobEvent {
  jobName: string;
  jobId?: string;
  tenantId?: string | null;
  durationMs: number;
  ok: boolean;
  error?: string;
  meta?: Record<string, unknown>;
}

export function logWorkerJob(evt: WorkerJobEvent): void {
  log({
    category: 'worker_job',
    level: evt.ok ? 'info' : 'error',
    ...evt,
  });
}

export interface TrpcEvent {
  procedure: string;
  kind: 'query' | 'mutation' | 'subscription';
  tenantId: string | null;
  userId: string | null;
  durationMs: number;
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export function logTrpc(evt: TrpcEvent): void {
  log({
    category: evt.ok ? 'trpc' : 'trpc_error',
    level: evt.ok ? 'info' : 'warn',
    ...evt,
  });
}

/**
 * @internal — reset pra testes. Não usar em código de aplicação.
 */
export function __resetForTests(): void {
  axiomClient = null;
  dataset = null;
  initialized = false;
}
