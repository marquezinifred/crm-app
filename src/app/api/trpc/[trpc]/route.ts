import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/context';
import { runWithTenant } from '@/server/db/tenant-context';
import {
  captureException,
  shouldReportTrpcError,
} from '@/lib/monitoring/sentry';

const handler = async (req: Request) => {
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: async (opts) => {
      const ctx = await createContext(opts);
      return ctx;
    },
    onError({ error, path }) {
      if (error.code === 'INTERNAL_SERVER_ERROR') {
        console.error(`[tRPC] ${path}`, error);
      }
      // Defense-in-depth: o middleware `monitor` já reporta, mas se
      // uma procedure não passou por ele (public sem middleware), a
      // camada de transporte pega o erro aqui.
      if (shouldReportTrpcError(error.code)) {
        captureException(error, {
          tags: { procedure: path ?? 'unknown', errorCode: error.code },
        });
      }
    },
    responseMeta() {
      return { headers: { 'cache-control': 'no-store' } };
    },
  });
};

// Wrap em runWithTenant — toda chamada tRPC roda dentro do AsyncLocalStorage
// para que o Prisma extension veja o tenantId.
async function withTenantStorage(req: Request) {
  const tenantId = req.headers.get('x-tenant-id');
  const role = req.headers.get('x-user-role');

  if (!tenantId) {
    // Rotas tRPC públicas (health, echo) podem rodar sem tenant
    return handler(req);
  }

  return runWithTenant(
    { tenantId, userId: null, role: role ?? null },
    () => handler(req),
  );
}

export { withTenantStorage as GET, withTenantStorage as POST };
