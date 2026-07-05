import { PrismaClient, Prisma } from '@prisma/client';
import {
  getTenantContext,
  SYSTEM_TENANT_SENTINEL,
  PLATFORM_TENANT_SENTINEL,
} from './tenant-context';

// Modelos que NÃO devem receber injeção automática de tenantId
// (Tenant é raiz; verificação manual fora do extension).
const TENANT_ROOT_MODELS = new Set(['Tenant']);

// P-42: TenantWriteOp descreve o backstop do payload de gravação após a
// injeção de WHERE. Semântica reformada em 2026-07-05:
//
// - `create` continua exigindo tenantId no data (a extension já injeta,
//   então o assert protege contra bypass explícito com data.tenantId
//   diferente do contexto).
// - `update`/`upsert.update` NÃO exigem mais tenantId no data. A defesa
//   primária é o WHERE injection acima (linhas ~109-118), que só permite
//   afetar rows do tenant corrente. Rejeitamos apenas quando o caller
//   passa `tenantId` diferente do contexto (tentativa deliberada de mover
//   row cross-tenant).
//
// Retorna null em caso OK, ou uma mensagem de erro pra throw no caller.
export type TenantWriteOp = 'create' | 'createMany' | 'update' | 'upsert';

export function assertTenantWritePayload(
  model: string,
  op: TenantWriteOp,
  ctxTenantId: string,
  payload: Record<string, unknown> | undefined,
): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const declared = payload.tenantId;
  const isCreate = op === 'create' || op === 'createMany';

  if (isCreate) {
    if (declared == null) {
      return `[tenant-isolation] ${model}.${op} sem tenantId no payload`;
    }
    if (typeof declared === 'string' && declared !== ctxTenantId) {
      return `[tenant-isolation] ${model}.${op} tenantId no payload difere do contexto`;
    }
    return null;
  }

  // update / upsert.update: ausente OK (WHERE injection protege);
  // presente OK só se bater com o contexto.
  if (declared == null) return null;
  if (typeof declared === 'string' && declared !== ctxTenantId) {
    return `[tenant-isolation] ${model}.${op} tenantId no payload difere do contexto`;
  }
  return null;
}

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

          // P-42: backstop refeito. Semântica em `assertTenantWritePayload`.
          // - create: exige tenantId (a extension injeta acima, mas assertamos
          //   em profundidade contra bypass explícito com tenantId ≠ contexto).
          // - update / upsert.update: ausente OK (WHERE injection protege),
          //   presente ≠ contexto = throw (tentativa de mover row cross-tenant).
          if (model && (op === 'create' || op === 'update' || op === 'upsert')) {
            if (op === 'upsert') {
              // upsert usa `create` + `update`, não `data`.
              const createErr = assertTenantWritePayload(
                model,
                'create',
                tenantId,
                a.create as Record<string, unknown> | undefined,
              );
              if (createErr) throw new Error(createErr);
              const updateErr = assertTenantWritePayload(
                model,
                'update',
                tenantId,
                a.update as Record<string, unknown> | undefined,
              );
              if (updateErr) throw new Error(updateErr);
            } else {
              const err = assertTenantWritePayload(
                model,
                op as TenantWriteOp,
                tenantId,
                a.data as Record<string, unknown> | undefined,
              );
              if (err) throw new Error(err);
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
