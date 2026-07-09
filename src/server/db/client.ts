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
// - `createMany` (P-45, 2026-07-05): itera as rows do array e assert em
//   cada uma. A extension acima já injeta tenantId em cada row, mas o
//   backstop confirma defensivamente (bypass explícito com row.tenantId
//   ≠ contexto é rejeitado por row, identificando o índice).
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
  payload: Record<string, unknown> | Record<string, unknown>[] | undefined,
): string | null {
  if (payload == null) return null;

  // createMany: `data` pode ser um array de rows ou (raro) uma row única.
  // Iteramos defensivamente cada row identificando o índice em caso de
  // bypass explícito com tenantId ≠ contexto.
  if (Array.isArray(payload)) {
    if (op !== 'createMany') {
      // Arrays só fazem sentido em createMany; outras ops não devem receber.
      return null;
    }
    for (let i = 0; i < payload.length; i++) {
      const row = payload[i];
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const declared = (row as Record<string, unknown>).tenantId;
      if (declared == null) {
        return `[tenant-isolation] ${model}.${op} row ${i} sem tenantId no payload`;
      }
      if (typeof declared === 'string' && declared !== ctxTenantId) {
        return `[tenant-isolation] ${model}.${op} row ${i} tenantId no payload difere do contexto`;
      }
    }
    return null;
  }

  if (typeof payload !== 'object') return null;

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

          // Sem contexto: fail-closed em test E dev pra pegar bugs
          // silenciosos de vazamento cross-tenant (P-79, 2026-07-08 — o
          // route handler tRPC deixava requests sem `x-tenant-id` rodar
          // cru, e o extension caía aqui bypassando o filtro. Dropdown
          // de users em /admin/commercial-structure retornava 33 users
          // de 5 tenants em vez de 1). Em prod ainda fail-open pra
          // não derrubar users legítimos por bug residual — mas log
          // ERROR pra visibilidade no Sentry.
          if (!tenantId) {
            if (
              process.env.NODE_ENV === 'test' ||
              process.env.NODE_ENV === 'development'
            ) {
              throw new Error(
                `Prisma call to ${model}.${operation} outside tenant context. ` +
                  `Wrap in runWithTenant() or runAsSystem() or runAsPlatform().`,
              );
            }
            console.error(
              `[tenant-isolation] Prisma call to ${model}.${operation} outside tenant context — potential cross-tenant leak.`,
            );
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
          // - createMany (P-45, 2026-07-05): itera rows do array; a extension
          //   acima já injeta tenantId em cada row, backstop confirma
          //   defensivamente (bypass explícito é rejeitado por índice).
          // - update / upsert.update: ausente OK (WHERE injection protege),
          //   presente ≠ contexto = throw (tentativa de mover row cross-tenant).
          if (
            model &&
            (op === 'create' || op === 'createMany' || op === 'update' || op === 'upsert')
          ) {
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
                a.data as Record<string, unknown> | Record<string, unknown>[] | undefined,
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
