import { Queue, QueueEvents, Worker, type ConnectionOptions } from 'bullmq';
import { env } from '@/lib/env';

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
} as const;

export function makeQueue<T = unknown>(name: string): Queue<T> {
  return new Queue<T>(name, { connection: bullConnection() });
}

export function makeWorker<T>(
  name: string,
  handler: (job: { data: T }) => Promise<unknown>,
): Worker<T> {
  return new Worker<T>(name, async (job) => handler({ data: job.data }), {
    connection: bullConnection(),
    concurrency: 4,
  });
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
