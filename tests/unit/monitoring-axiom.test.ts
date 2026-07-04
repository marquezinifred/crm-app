// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ingestMock = vi.fn();
const flushMock = vi.fn(async () => undefined);

vi.mock('@axiomhq/js', () => ({
  Axiom: vi.fn().mockImplementation(() => ({
    ingest: (dataset: string, events: unknown) => ingestMock(dataset, events),
    flush: () => flushMock(),
  })),
}));

async function loadModule(envOverrides: Record<string, string | undefined> = {}) {
  const originalToken = process.env.AXIOM_TOKEN;
  const originalDataset = process.env.AXIOM_DATASET;
  if ('AXIOM_TOKEN' in envOverrides) {
    if (envOverrides.AXIOM_TOKEN === undefined) delete process.env.AXIOM_TOKEN;
    else process.env.AXIOM_TOKEN = envOverrides.AXIOM_TOKEN;
  }
  if ('AXIOM_DATASET' in envOverrides) {
    if (envOverrides.AXIOM_DATASET === undefined) delete process.env.AXIOM_DATASET;
    else process.env.AXIOM_DATASET = envOverrides.AXIOM_DATASET;
  }
  vi.resetModules();
  const mod = await import('@/lib/monitoring/axiom');
  return {
    mod,
    restore: () => {
      if (originalToken === undefined) delete process.env.AXIOM_TOKEN;
      else process.env.AXIOM_TOKEN = originalToken;
      if (originalDataset === undefined) delete process.env.AXIOM_DATASET;
      else process.env.AXIOM_DATASET = originalDataset;
    },
  };
}

describe('monitoring/axiom logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete process.env.AXIOM_TOKEN;
    delete process.env.AXIOM_DATASET;
  });

  describe('sem AXIOM_TOKEN / AXIOM_DATASET', () => {
    it('isAxiomEnabled retorna false', async () => {
      const { mod, restore } = await loadModule({
        AXIOM_TOKEN: undefined,
        AXIOM_DATASET: undefined,
      });
      expect(mod.isAxiomEnabled()).toBe(false);
      expect(ingestMock).not.toHaveBeenCalled();
      restore();
    });

    it('log() é no-op — não chama ingest', async () => {
      const { mod, restore } = await loadModule({
        AXIOM_TOKEN: undefined,
        AXIOM_DATASET: undefined,
      });
      mod.log({ category: 'test', foo: 'bar' });
      expect(ingestMock).not.toHaveBeenCalled();
      restore();
    });

    it('logAudit / logAiUsage / logWorkerJob / logTrpc não crasham', async () => {
      const { mod, restore } = await loadModule({
        AXIOM_TOKEN: undefined,
        AXIOM_DATASET: undefined,
      });
      expect(() => mod.logAudit({
        action: 'company.create',
        tableName: 'companies',
        recordId: 'c-1',
        tenantId: 't-1',
        userId: 'u-1',
        ok: true,
      })).not.toThrow();
      expect(() => mod.logAiUsage({
        requestType: 'summary',
        tenantId: 't-1',
        provider: 'ANTHROPIC',
        model: 'claude-haiku-4-5',
        usedFallback: false,
        promptTokens: 100,
        completionTokens: 50,
        costUsd: 0.001,
        success: true,
      })).not.toThrow();
      expect(() => mod.logWorkerJob({
        jobName: 'alerts-scan',
        durationMs: 123,
        ok: true,
      })).not.toThrow();
      expect(() => mod.logTrpc({
        procedure: 'companies.list',
        kind: 'query',
        tenantId: 't-1',
        userId: 'u-1',
        durationMs: 45,
        ok: true,
      })).not.toThrow();
      expect(ingestMock).not.toHaveBeenCalled();
      restore();
    });

    it('flush() no-op resolve silencioso', async () => {
      const { mod, restore } = await loadModule({
        AXIOM_TOKEN: undefined,
        AXIOM_DATASET: undefined,
      });
      await expect(mod.flush()).resolves.toBeUndefined();
      expect(flushMock).not.toHaveBeenCalled();
      restore();
    });
  });

  describe('com AXIOM_TOKEN + AXIOM_DATASET', () => {
    it('isAxiomEnabled retorna true', async () => {
      const { mod, restore } = await loadModule({
        AXIOM_TOKEN: 'xaat-fake-token',
        AXIOM_DATASET: 'venzo-test',
      });
      expect(mod.isAxiomEnabled()).toBe(true);
      restore();
    });

    it('log() faz ingest com _time + level defaults + payload', async () => {
      const { mod, restore } = await loadModule({
        AXIOM_TOKEN: 'xaat-fake-token',
        AXIOM_DATASET: 'venzo-test',
      });
      mod.log({ category: 'audit', message: 'ok' });
      expect(ingestMock).toHaveBeenCalledTimes(1);
      const [dataset, events] = ingestMock.mock.calls[0]!;
      expect(dataset).toBe('venzo-test');
      expect(Array.isArray(events)).toBe(true);
      expect(events[0]).toMatchObject({
        category: 'audit',
        message: 'ok',
        level: 'info',
      });
      expect(events[0]._time).toMatch(/\d{4}-\d{2}-\d{2}T/);
      restore();
    });

    it('logAudit shape: category=audit, ok=true, tenantId', async () => {
      const { mod, restore } = await loadModule({
        AXIOM_TOKEN: 'xaat-fake-token',
        AXIOM_DATASET: 'venzo-test',
      });
      mod.logAudit({
        action: 'company.create',
        tableName: 'companies',
        recordId: 'c-1',
        tenantId: 't-1',
        userId: 'u-1',
        ok: true,
      });
      const events = ingestMock.mock.calls[0]![1];
      expect(events[0]).toMatchObject({
        category: 'audit',
        action: 'company.create',
        tenantId: 't-1',
        userId: 'u-1',
        ok: true,
      });
      restore();
    });

    it('logAiUsage inclui costBrl derivado', async () => {
      const { mod, restore } = await loadModule({
        AXIOM_TOKEN: 'xaat-fake-token',
        AXIOM_DATASET: 'venzo-test',
      });
      mod.logAiUsage({
        requestType: 'summary',
        tenantId: 't-1',
        provider: 'ANTHROPIC',
        model: 'claude-haiku-4-5',
        usedFallback: false,
        promptTokens: 100,
        completionTokens: 50,
        costUsd: 0.001,
        costBrl: 0.0051,
        success: true,
      });
      const events = ingestMock.mock.calls[0]![1];
      expect(events[0]).toMatchObject({
        category: 'ai_usage',
        requestType: 'summary',
        provider: 'ANTHROPIC',
        usedFallback: false,
        costUsd: 0.001,
        costBrl: 0.0051,
        success: true,
      });
      restore();
    });

    it('logWorkerJob com ok=false marca level=error', async () => {
      const { mod, restore } = await loadModule({
        AXIOM_TOKEN: 'xaat-fake-token',
        AXIOM_DATASET: 'venzo-test',
      });
      mod.logWorkerJob({
        jobName: 'email-send',
        jobId: 'j-1',
        tenantId: 't-1',
        durationMs: 5000,
        ok: false,
        error: 'Resend 500',
      });
      const events = ingestMock.mock.calls[0]![1];
      expect(events[0]).toMatchObject({
        category: 'worker_job',
        level: 'error',
        ok: false,
        error: 'Resend 500',
      });
      restore();
    });

    it('logTrpc separa sucesso (category=trpc) de erro (category=trpc_error)', async () => {
      const { mod, restore } = await loadModule({
        AXIOM_TOKEN: 'xaat-fake-token',
        AXIOM_DATASET: 'venzo-test',
      });
      mod.logTrpc({
        procedure: 'companies.list',
        kind: 'query',
        tenantId: 't-1',
        userId: 'u-1',
        durationMs: 42,
        ok: true,
      });
      mod.logTrpc({
        procedure: 'companies.remove',
        kind: 'mutation',
        tenantId: 't-1',
        userId: 'u-1',
        durationMs: 200,
        ok: false,
        errorCode: 'FORBIDDEN',
      });
      const first = ingestMock.mock.calls[0]![1][0];
      const second = ingestMock.mock.calls[1]![1][0];
      expect(first.category).toBe('trpc');
      expect(first.level).toBe('info');
      expect(second.category).toBe('trpc_error');
      expect(second.level).toBe('warn');
      expect(second.errorCode).toBe('FORBIDDEN');
      restore();
    });

    it('flush() delega pro cliente Axiom', async () => {
      const { mod, restore } = await loadModule({
        AXIOM_TOKEN: 'xaat-fake-token',
        AXIOM_DATASET: 'venzo-test',
      });
      // Força init calling log()
      mod.log({ category: 'test' });
      await mod.flush();
      expect(flushMock).toHaveBeenCalledTimes(1);
      restore();
    });
  });
});
