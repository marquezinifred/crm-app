import { PrismaClient, Prisma } from '@prisma/client';
import {
  getTenantContext,
  SYSTEM_TENANT_SENTINEL,
  PLATFORM_TENANT_SENTINEL,
} from './tenant-context';

// Modelos que NÃO devem receber injeção automática de tenantId
// (Tenant é raiz; verificação manual fora do extension).
const TENANT_ROOT_MODELS = new Set(['Tenant']);

// Modelos cujas operações de gravação não exigem tenant no payload por estarem
// em contextos onde o tenant é inferido pelo relacionamento (ex: webhooks Clerk
// criando User). Proteção real preservada pela injeção do WHERE (linha 98-101)
// que garante que updates só afetam rows do próprio tenant.
const ALLOW_MISSING_TENANT_ON_WRITE = new Set<string>([
  // User.update: 6 call sites legítimos passam apenas campos de perfil
  // (role, active, lastLoginAt, cachedPermissions, clerkId) sem tenantId
  // no data. WHERE já injeta tenantId; data não pode mover row de tenant
  // por não conter tenantId (undefined ignora, não sobrescreve pra null).
  'User.update',
  // Task.update: sites legítimos passam só campos do form (title,
  // description, dueDate, priority, assigneeId, status) sem tenantId.
  // Mesma proteção via WHERE injection do tenant-context.
  'Task.update',
]);

function createPrismaClient(): PrismaClient {
  const log: Prisma.LogLevel[] =
    process.env.NODE_ENV === 'development'
      ? ['warn', 'error']
      : ['error'];

  const base = new PrismaClient({ log });

  return base.$extends({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ctx = getTenantContext();
          const tenantId = ctx?.tenantId;

          // Sem contexto: deixa o RLS bloquear no banco (fail-closed).
          // Em testes isso explode com erro útil em vez de vazar dados.
          if (!tenantId) {
            if (process.env.NODE_ENV === 'test') {
              throw new Error(
                `Prisma call to ${model}.${operation} outside tenant context. ` +
                  `Wrap in runWithTenant() or runAsSystem().`,
              );
            }
            return query(args);
          }

          // Sistema ou Platform Owner: bypass total de injeção de tenantId.
          // RLS continua aplicando — Platform queries cross-tenant usam
          // `findMany({ where: { tenantId: <alvo> } })` explícito ou
          // disable temporário do RLS via SET LOCAL (transações dedicadas).
          if (
            tenantId === SYSTEM_TENANT_SENTINEL ||
            tenantId === PLATFORM_TENANT_SENTINEL
          ) {
            return query(args);
          }

          // Tenant root: não injeta
          if (model && TENANT_ROOT_MODELS.has(model)) {
            return query(args);
          }

          const op = operation as string;

          const READ_OPS = new Set([
            'findUnique',
            'findUniqueOrThrow',
            'findFirst',
            'findFirstOrThrow',
            'findMany',
            'count',
            'aggregate',
            'groupBy',
          ]);

          const a = (args ?? {}) as Record<string, unknown>;

          if (READ_OPS.has(op)) {
            const where = (a.where ?? {}) as Record<string, unknown>;
            a.where = { ...where, tenantId };
          }

          if (op === 'delete' || op === 'deleteMany') {
            const where = (a.where ?? {}) as Record<string, unknown>;
            a.where = { ...where, tenantId };
          }

          if (op === 'create') {
            const data = (a.data ?? {}) as Record<string, unknown>;
            a.data = { tenantId, ...data };
          }

          if (op === 'createMany') {
            const data = a.data;
            if (Array.isArray(data)) {
              a.data = data.map((row) => ({ tenantId, ...(row as Record<string, unknown>) }));
            }
          }

          if (op === 'update' || op === 'updateMany') {
            const where = (a.where ?? {}) as Record<string, unknown>;
            a.where = { ...where, tenantId };
          }

          if (op === 'upsert') {
            const create = (a.create ?? {}) as Record<string, unknown>;
            const where = (a.where ?? {}) as Record<string, unknown>;
            a.create = { tenantId, ...create };
            a.where = { ...where, tenantId };
          }

          // Backstop: assert que tenantId está em data para writes
          if (op === 'create' || op === 'update' || op === 'upsert') {
            const isAllowed = model && ALLOW_MISSING_TENANT_ON_WRITE.has(`${model}.${op}`);
            const payload = (a.data ?? a.create) as Record<string, unknown> | undefined;
            if (!isAllowed && payload && typeof payload === 'object' && !Array.isArray(payload)) {
              if (!('tenantId' in payload) || payload.tenantId == null) {
                throw new Error(
                  `[tenant-isolation] ${model}.${op} sem tenantId no payload`,
                );
              }
            }
          }

          return query(a);
        },
      },
    },
  }) as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Executa uma função dentro de uma transação Prisma + seta o GUC `app.tenant_id`
 * via `SET LOCAL` para que o Row Level Security do Postgres filtre adequadamente.
 *
 * Use para handlers HTTP / tRPC procedures. Para queries fora de request
 * (jobs, seed) use runAsSystem() — mas saiba que RLS continua aplicando.
 */
export async function withTenantTransaction<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId.replace(/'/g, "''")}'`);
    return fn(tx);
  });
}
