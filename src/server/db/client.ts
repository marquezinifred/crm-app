import { PrismaClient, Prisma } from '@prisma/client';
import {
  getTenantContext,
  SYSTEM_TENANT_SENTINEL,
  PLATFORM_TENANT_SENTINEL,
} from './tenant-context';
import { ForbiddenError } from '@/lib/auth/rbac';

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

// ======================================================================
// Sprint 15G.5 (T2/T15/T19) — Guard de transferência de oportunidade.
//
// Choke point ADITIVO na Prisma extension (name-independent, sem denylist
// mantida à mão): qualquer write nos 5 modelos que referenciam uma
// opportunity é bloqueado enquanto a opp tem uma transferência PENDING e o
// ator atual NÃO é o disparador da transferência. Cobre mutation nova
// automaticamente (o P-42 backstop segue intocado — este guard convive com
// ele, não substitui).
//
// Regra (regra 5 §2): durante a pendência a opp fica sob gestão do
// disparador; dono original e terceiros ficam read-only.
//
// Condição de bloqueio (lê o valor COMMITADO de current_transfer_id no
// banco via `base`, NÃO o payload):
//   currentTransferId != null && ctxUserId != <disparador da transfer ativa>
//
// Carve-outs OBRIGATÓRIAS (T19 — sem elas o guard quebra o próprio fluxo):
//   (a) máquina de estado: um write em Opportunity cujo payload transiciona
//       currentTransferId para `null` (approve/reject/cancel) é a própria
//       resolução → LIBERA. Isso é o que deixa o `approve` (feito pelo
//       destinatário, userId != disparador, com current_transfer_id ainda
//       setado no banco no instante do write) passar.
//   (b) contexto de sistema/plataforma: userId ausente (worker runAsSystem)
//       → bypass (confiável). Também coberto pelo early-return de privilégio
//       da extension (SYSTEM/PLATFORM sentinel) ANTES deste guard.
//   (c) kill-switch OFF (T3/T16): guard inerte, zero lookup.
// ======================================================================

/** Espelha FORBIDDEN_MESSAGE de src/server/trpc/middlewares.ts. NÃO
 * importamos de lá pra evitar ciclo (middlewares → trpc →
 * permissions.service → db/client). O `mapErrors` (trpc.ts) converte
 * ForbiddenError → TRPCError FORBIDDEN com esta mensagem genérica; o
 * detalhe técnico vai no `cause` string (padrão P-98). */
const TRANSFER_GUARD_FORBIDDEN_MESSAGE = 'Seu perfil não tem acesso a esta operação.';

/**
 * Kill-switch (T3/T16) lido em RUNTIME direto de `process.env`, com a MESMA
 * semântica literal de `envBoolean` (src/lib/env.ts): só "true|1|yes|on"
 * ligam; ausente/qualquer-outro → false (default `envBoolean(false)` da flag
 * OPPORTUNITY_TRANSFER_ENABLED). NUNCA `Boolean("false")` (P-60).
 *
 * De propósito NÃO importamos `@/lib/env` aqui: `db/client.ts` é o módulo
 * mais crítico (choke point P-42) e importar env.ts dispararia a validação
 * Zod de TODAS as env vars no import DESTE módulo — acoplando o DB layer à
 * presença de vars não relacionadas (Clerk etc.) e quebrando testes unitários
 * isolados que hoje importam client.ts sem env. O resultado é idêntico ao de
 * `env.OPPORTUNITY_TRANSFER_ENABLED` (env.ts parseia o mesmo process.env no
 * import; process.env não muda em runtime na app).
 */
function isTransferGuardEnabled(): boolean {
  const raw = process.env.OPPORTUNITY_TRANSFER_ENABLED;
  if (raw == null) return false;
  const s = raw.trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

const TRANSFER_GUARDED_MODELS = new Set([
  'Opportunity',
  'Proposal',
  'Activity',
  'Task',
  'Document',
]);

const TRANSFER_WRITE_OPS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

function isTransferCreateOp(op: string): boolean {
  return op === 'create' || op === 'createMany' || op === 'createManyAndReturn';
}

/** Estado de transferência lido da opp-alvo. `base.opportunity.findMany`
 * com este select retorna exatamente esta forma. */
type OppTransferRow = {
  id: string;
  currentTransferId: string | null;
  currentTransfer: { requestedById: string } | null;
};

/** Interface mínima do client usada pelo guard — injetável nos testes.
 * Em runtime recebe o `base` (client NÃO-estendido → sem recursão). */
export interface TransferGuardDb {
  opportunity: { findMany(args: unknown): Promise<OppTransferRow[]> };
  proposal: { findMany(args: unknown): Promise<Array<{ opportunityId: string | null }>> };
  activity: { findMany(args: unknown): Promise<Array<{ opportunityId: string | null }>> };
  task: { findMany(args: unknown): Promise<Array<{ opportunityId: string | null }>> };
  document: {
    findMany(
      args: unknown,
    ): Promise<Array<{ relatedEntityType: string; relatedEntityId: string }>>;
  };
}

export interface TransferGuardFacts {
  /** Valor COMMITADO de current_transfer_id na opp (pré-write). */
  currentTransferId: string | null;
  /** requestedById da transferência ativa (null se não há). */
  activeTransferRequestedById: string | null;
  /** Ator atual (getTenantContext().userId). */
  ctxUserId: string | null;
  /** Payload zera currentTransferId (só faz sentido pra Opportunity). */
  payloadClearsTransfer: boolean;
  model?: string;
  opportunityId?: string;
}

/**
 * Núcleo puro da decisão do guard (testável sem DB). Retorna `null` quando
 * o write é permitido, ou uma string técnica (vira o `cause`) quando deve
 * ser bloqueado.
 */
export function assertTransferWriteAllowed(f: TransferGuardFacts): string | null {
  // T19(b) — contexto de sistema/worker (sem userId atribuível) → confiável.
  if (!f.ctxUserId) return null;
  // Sem transferência ativa → comportamento pré-15G.5 (ninguém bloqueado).
  if (f.currentTransferId == null) return null;
  // T19(a) — a própria máquina de estado resolvendo a transferência
  // (approve/reject/cancel setam currentTransferId=null) → libera.
  if (f.payloadClearsTransfer) return null;
  // Durante a pendência só o disparador escreve; dono/terceiros read-only.
  if (f.ctxUserId === f.activeTransferRequestedById) return null;
  return (
    `[transfer-guard] ${f.model ?? 'write'} bloqueado em opp ${f.opportunityId ?? '?'}: ` +
    `transferência PENDING (disparador=${f.activeTransferRequestedById}), ator=${f.ctxUserId}`
  );
}

/**
 * True quando o payload de um write em Opportunity transiciona
 * currentTransferId para `null` (a resolução da transferência — T19a).
 * Aceita tanto `{ currentTransferId: null }` quanto `{ currentTransferId:
 * { set: null } }`. Ancorada estreitamente em "seta para null" (não em
 * "toca") — o `request` seta para não-null e NÃO é liberado por aqui (nem
 * precisa: o valor commitado pré-request é null).
 */
export function payloadClearsCurrentTransfer(
  op: string,
  args: Record<string, unknown>,
): boolean {
  const data = op === 'upsert' ? args.update : args.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const v = (data as Record<string, unknown>).currentTransferId;
  if (v === null) return true;
  if (
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    (v as Record<string, unknown>).set === null
  ) {
    return true;
  }
  return false;
}

/** Extrai ids do `where` de forma segura: `id: 'x'`, `id: { equals: 'x' }`,
 * `id: { in: [...] }`. where complexo sem `id` (filtros de updateMany/
 * deleteMany) → [] (decisão permissiva documentada; ver evaluateTransferGuard). */
function idsFromWhere(where: Record<string, unknown> | undefined): string[] {
  if (!where) return [];
  const id = where.id;
  if (typeof id === 'string') return [id];
  if (id && typeof id === 'object' && !Array.isArray(id)) {
    const o = id as Record<string, unknown>;
    if (typeof o.equals === 'string') return [o.equals];
    if (Array.isArray(o.in)) {
      return o.in.filter((x): x is string => typeof x === 'string');
    }
  }
  return [];
}

/** opportunityId(s) direto do `data` de create/createMany (Proposal/Activity/Task). */
function opportunityIdsFromCreateData(data: unknown): string[] {
  const rows = Array.isArray(data) ? data : data == null ? [] : [data];
  const ids: string[] = [];
  for (const row of rows) {
    if (row && typeof row === 'object') {
      const oid = (row as Record<string, unknown>).opportunityId;
      if (typeof oid === 'string') ids.push(oid);
    }
  }
  return ids;
}

/** opp id(s) do `data` de create/createMany de Document (polimórfico:
 * relatedEntityType='opportunity' + relatedEntityId). */
function documentOppIdsFromCreateData(data: unknown): string[] {
  const rows = Array.isArray(data) ? data : data == null ? [] : [data];
  const ids: string[] = [];
  for (const row of rows) {
    if (row && typeof row === 'object') {
      const r = row as Record<string, unknown>;
      if (r.relatedEntityType === 'opportunity' && typeof r.relatedEntityId === 'string') {
        ids.push(r.relatedEntityId);
      }
    }
  }
  return ids;
}

/**
 * Resolve a(s) opp-alvo de um write. Casos não resolvíveis com segurança
 * (updateMany/deleteMany com filtro complexo sem `id`, upsert por unique
 * não-id) → [] (permissivo): esses caminhos não são usados pelos fluxos
 * legítimos de edição da opp em pendência; o worker que zera a flag roda
 * como sistema (bypassed antes deste guard). O custo do +1 lookup (T15)
 * vive aqui.
 */
async function collectTransferOppIds(
  db: TransferGuardDb,
  model: string,
  op: string,
  args: Record<string, unknown>,
  tenantId: string,
): Promise<string[]> {
  const where = (args.where ?? undefined) as Record<string, unknown> | undefined;
  const data = args.data;

  if (model === 'Opportunity') {
    // create/createMany: opp nova, sem transferência ativa possível → skip.
    if (isTransferCreateOp(op)) return [];
    return idsFromWhere(where);
  }

  if (model === 'Proposal' || model === 'Activity' || model === 'Task') {
    if (isTransferCreateOp(op)) return opportunityIdsFromCreateData(data);
    // update/delete/... → resolve o filho pelo id pra obter opportunityId.
    const childIds = idsFromWhere(where);
    if (childIds.length === 0) return [];
    const delegate =
      model === 'Proposal' ? db.proposal : model === 'Activity' ? db.activity : db.task;
    const rows = await delegate.findMany({
      where: { id: { in: childIds }, tenantId },
      select: { opportunityId: true },
    });
    return rows.map((r) => r.opportunityId).filter((x): x is string => typeof x === 'string');
  }

  if (model === 'Document') {
    if (isTransferCreateOp(op)) return documentOppIdsFromCreateData(data);
    const docIds = idsFromWhere(where);
    if (docIds.length === 0) return [];
    const rows = await db.document.findMany({
      where: { id: { in: docIds }, tenantId },
      select: { relatedEntityType: true, relatedEntityId: true },
    });
    return rows
      .filter((r) => r.relatedEntityType === 'opportunity')
      .map((r) => r.relatedEntityId)
      .filter((x): x is string => typeof x === 'string');
  }

  return [];
}

/**
 * Avalia o guard para um write. Resolve a(s) opp-alvo, lê o estado COMMITADO
 * de transferência via `db` (o `base` não-estendido) filtrando por tenantId
 * (isolamento cross-tenant — memória feedback_cross_tenant_leak), e delega a
 * decisão à função pura `assertTransferWriteAllowed`. Retorna a string do
 * bloqueio (vira `cause`) ou `null`.
 */
export async function evaluateTransferGuard(
  db: TransferGuardDb,
  model: string,
  op: string,
  args: Record<string, unknown>,
  tenantId: string,
  ctxUserId: string | null,
): Promise<string | null> {
  const oppIds = await collectTransferOppIds(db, model, op, args, tenantId);
  if (oppIds.length === 0) return null;

  const opps = await db.opportunity.findMany({
    where: { id: { in: oppIds }, tenantId },
    select: {
      id: true,
      currentTransferId: true,
      currentTransfer: { select: { requestedById: true } },
    },
  });

  const payloadClearsTransfer =
    model === 'Opportunity' && payloadClearsCurrentTransfer(op, args);

  for (const opp of opps) {
    const detail = assertTransferWriteAllowed({
      model,
      opportunityId: opp.id,
      currentTransferId: opp.currentTransferId,
      activeTransferRequestedById: opp.currentTransfer?.requestedById ?? null,
      ctxUserId,
      payloadClearsTransfer,
    });
    if (detail) return detail;
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

          // Sprint 15G.5 (T2/T15/T19) — guard de transferência (ADITIVO ao
          // P-42 acima). Lê o valor commitado de current_transfer_id via
          // `base` (NÃO-estendido → sem recursão; filtra tenantId). Inerte
          // com flag OFF (zero lookup). userId null (worker/sistema — o
          // privileged já saiu antes) → bypass. Payload que zera a flag
          // (approve/reject/cancel) → libera (carve-out da máquina de estado).
          const actorUserId = ctx?.userId ?? null;
          if (
            actorUserId != null &&
            model &&
            TRANSFER_GUARDED_MODELS.has(model) &&
            TRANSFER_WRITE_OPS.has(op) &&
            isTransferGuardEnabled()
          ) {
            const detail = await evaluateTransferGuard(
              base as unknown as TransferGuardDb,
              model,
              op,
              a,
              tenantId,
              actorUserId,
            );
            if (detail) {
              const forbidden = new ForbiddenError(TRANSFER_GUARD_FORBIDDEN_MESSAGE);
              (forbidden as { cause?: unknown }).cause = detail;
              throw forbidden;
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
