// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const captureException = vi.fn();
const captureMessage = vi.fn();
const addBreadcrumb = vi.fn();
const withScope = vi.fn((cb: (s: unknown) => unknown) => cb({
  setLevel: vi.fn(),
  setTag: vi.fn(),
  setExtra: vi.fn(),
  setUser: vi.fn(),
  setFingerprint: vi.fn(),
}));
const getClient = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  captureMessage: (...args: unknown[]) => captureMessage(...args),
  addBreadcrumb: (...args: unknown[]) => addBreadcrumb(...args),
  withScope: (cb: (s: unknown) => unknown) => withScope(cb),
  getClient: () => getClient(),
}));

// Import DEPOIS do mock — reset dinâmico via require pra pegar
// diferentes estados de getClient() em cada suíte.
async function loadModule() {
  vi.resetModules();
  return await import('@/lib/monitoring/sentry');
}

describe('monitoring/sentry helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('quando Sentry NÃO está inicializado (sem DSN)', () => {
    beforeEach(() => {
      getClient.mockReturnValue(undefined);
    });

    it('captureException é no-op', async () => {
      const mod = await loadModule();
      mod.captureException(new Error('boom'));
      expect(captureException).not.toHaveBeenCalled();
    });

    it('captureMessage é no-op', async () => {
      const mod = await loadModule();
      mod.captureMessage('ping');
      expect(captureMessage).not.toHaveBeenCalled();
    });

    it('addBreadcrumb é no-op', async () => {
      const mod = await loadModule();
      mod.addBreadcrumb({ category: 'test', message: 'x' });
      expect(addBreadcrumb).not.toHaveBeenCalled();
    });

    it('withScope executa fn direto sem entrar em withScope do SDK', async () => {
      const mod = await loadModule();
      const fn = vi.fn(() => 'result');
      const result = mod.withScope({ tags: { x: 'y' } }, fn);
      expect(fn).toHaveBeenCalled();
      expect(result).toBe('result');
      expect(withScope).not.toHaveBeenCalled();
    });
  });

  describe('quando Sentry ESTÁ inicializado', () => {
    beforeEach(() => {
      getClient.mockReturnValue({ dsn: 'https://fake@sentry.io/123' });
    });

    it('captureException chama SDK com scope customizado', async () => {
      const mod = await loadModule();
      mod.captureException(new Error('boom'), {
        tags: { tenantId: 'tenant-1', route: '/api/trpc' },
        user: { id: 'user-1' },
        level: 'error',
      });
      expect(withScope).toHaveBeenCalled();
      expect(captureException).toHaveBeenCalledWith(expect.any(Error));
    });

    it('captureMessage propaga fingerprint', async () => {
      const mod = await loadModule();
      mod.captureMessage('slow-query', {
        fingerprint: ['db', 'slow'],
        extra: { queryMs: 1200 },
      });
      expect(captureMessage).toHaveBeenCalledWith('slow-query');
    });

    it('addBreadcrumb propaga category + data', async () => {
      const mod = await loadModule();
      mod.addBreadcrumb({
        category: 'audit',
        message: 'company.update',
        level: 'info',
        data: { recordId: 'co-1' },
      });
      expect(addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'audit',
          message: 'company.update',
          level: 'info',
          data: { recordId: 'co-1' },
        }),
      );
    });
  });

  describe('shouldReportTrpcError', () => {
    it('INTERNAL_SERVER_ERROR é reportado', async () => {
      const mod = await loadModule();
      expect(mod.shouldReportTrpcError('INTERNAL_SERVER_ERROR')).toBe(true);
    });

    it('FORBIDDEN / UNAUTHORIZED / PRECONDITION_FAILED NÃO são reportados', async () => {
      const mod = await loadModule();
      expect(mod.shouldReportTrpcError('FORBIDDEN')).toBe(false);
      expect(mod.shouldReportTrpcError('UNAUTHORIZED')).toBe(false);
      expect(mod.shouldReportTrpcError('PRECONDITION_FAILED')).toBe(false);
      expect(mod.shouldReportTrpcError('NOT_FOUND')).toBe(false);
      expect(mod.shouldReportTrpcError('TOO_MANY_REQUESTS')).toBe(false);
    });

    it('undefined é reportado (defesa)', async () => {
      const mod = await loadModule();
      expect(mod.shouldReportTrpcError(undefined)).toBe(true);
    });
  });
});
