import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/context';
import { runWithTenant, runAsPlatform } from '@/server/db/tenant-context';
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

// Wrap em runWithTenant/runAsPlatform — TODA chamada tRPC roda dentro do
// AsyncLocalStorage para que o Prisma extension veja o contexto.
//
// P-79 (2026-07-08): antes, quando `x-tenant-id` estava ausente, o handler
// rodava CRU sem AsyncLocalStorage. O extension caía no branch "sem
// contexto → deixa passar" (fail-open em dev), vazando dados cross-tenant.
// Descoberto no dropdown `/admin/commercial-structure` retornando 33 users
// de 5 tenants em vez de 1 do tenant corrente.
//
// Agora: 3 caminhos possíveis, todos SEMPRE dentro de um `runWith*`.
async function withTenantStorage(req: Request) {
  const tenantId = req.headers.get('x-tenant-id');
  const platformClerkId = req.headers.get('x-platform-user-clerk-id');
  const platformRole = req.headers.get('x-platform-role');
  const role = req.headers.get('x-user-role');

  // Caso 1: tenant user autenticado — bindingo runWithTenant.
  // Extension injeta tenantId em queries.
  if (tenantId) {
    return runWithTenant(
      { tenantId, userId: null, role: role ?? null },
      () => handler(req),
    );
  }

  // Caso 2: Platform Owner sem tenant ativo (ex.: navegando fora de
  // impersonação). Extension bypassa injeção — Platform queries são
  // intencionalmente cross-tenant. Identidade atribuível para audit.
  if (platformRole === 'PLATFORM_OWNER' && platformClerkId) {
    return runAsPlatform(platformClerkId, () => handler(req));
  }

  // Caso 3: request sem nenhum contexto — só rotas tRPC públicas
  // (health check, echo). `protectedProcedure` vai lançar UNAUTHORIZED
  // se qualquer procedure não-pública for chamada. Extension em dev
  // ainda pode fail-open, mas o auth guard barra antes da query.
  return handler(req);
}

export { withTenantStorage as GET, withTenantStorage as POST };
