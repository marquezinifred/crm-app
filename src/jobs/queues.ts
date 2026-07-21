import { Queue, QueueEvents, Worker, type ConnectionOptions } from 'bullmq';
import { env } from '@/lib/env';
import { logWorkerJob } from '@/lib/monitoring/axiom';
import { captureException } from '@/lib/monitoring/sentry';

let _connection: ConnectionOptions | null = null;
export function bullConnection(): ConnectionOptions {
  if (_connection) return _connection;
  const url = new URL(env.REDIS_URL);
  _connection = {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    username: url.username || undefined,
  };
  return _connection;
}

export const QUEUE_NAMES = {
  alertsScan: 'alerts-scan',
  emailSend: 'email-send',
  importRun: 'import-run',
  aiUsageRollup: 'ai-usage-rollup',
  healthScoreRollup: 'health-score-rollup',
  // Sprint 15D — captura automática de leads inbound
  inboundLeadCreate: 'inbound-lead-create',
  // Sprint 15G.5 — expira transferências de oportunidade PENDING vencidas
  opportunityTransferTimeout: 'opportunity-transfer-timeout',
} as const;

export function makeQueue<T = unknown>(name: string): Queue<T> {
  return new Queue<T>(name, { connection: bullConnection() });
}

/**
 * P-35 — Wrap todo handler de worker BullMQ com instrumentação
 * Axiom (duração + ok/erro) + Sentry (exception capture). Se o payload
 * tiver `tenantId`, ele vira tag na entry do Axiom pra facilitar
 * filtro por cliente.
 */
export function makeWorker<T>(
  name: string,
  handler: (job: { data: T }) => Promise<unknown>,
): Worker<T> {
  return new Worker<T>(
    name,
    async (job) => {
      const start = Date.now();
      const payload = job.data as unknown as { tenantId?: string | null } | null;
      const tenantId = payload && typeof payload === 'object' ? payload.tenantId ?? null : null;
      try {
        const result = await handler({ data: job.data });
        logWorkerJob({
          jobName: name,
          jobId: job.id,
          tenantId,
          durationMs: Date.now() - start,
          ok: true,
        });
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        captureException(err, {
          tags: { category: 'worker', jobName: name, tenantId: tenantId ?? undefined },
        });
        logWorkerJob({
          jobName: name,
          jobId: job.id,
          tenantId,
          durationMs: Date.now() - start,
          ok: false,
          error: msg,
        });
        throw err;
      }
    },
    {
      connection: bullConnection(),
      concurrency: 4,
    },
  );
}

export function makeEvents(name: string): QueueEvents {
  return new QueueEvents(name, { connection: bullConnection() });
}

// ----- Job payload types -----

export interface AlertsScanJobData {
  /** ISO string opcional para sobrescrever "hoje" em runs ad-hoc. */
  today?: string;
}

export interface EmailSendJobData {
  alertLogId: string;
}

export interface ImportRunJobData {
  importJobId: string;
}

// Sprint 15D — worker de criação de opp inbound (lê parser + persiste)
export interface InboundLeadCreateJobData {
  tenantId: string;
  source: 'email' | 'webhook_custom';
  raw: string | Record<string, unknown>;
  receivedAt: string; // ISO string — Bull serializa datas como string
  originIdentifier?: string;
}

// Sprint 15G.5 — worker de timeout de transferência (cross-tenant, hourly)
export interface OpportunityTransferTimeoutJobData {
  /** ISO string opcional para sobrescrever "agora" em runs ad-hoc/testes. */
  now?: string;
}
