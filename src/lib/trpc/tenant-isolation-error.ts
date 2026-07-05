/**
 * P-46 — Reconhecimento de `Error("[tenant-isolation] ...")` disparado
 * pelo backstop de `src/server/db/client.ts::assertTenantWritePayload`.
 *
 * Fluxo:
 *  1. `mapErrors` middleware (server-side) captura a Error crua, extrai
 *     metadata via `parseTenantIsolationMessage`, e converte em TRPCError
 *     com `code=INTERNAL_SERVER_ERROR` + `message=TENANT_ISOLATION_PUBLIC_MESSAGE`
 *     + `cause` preservado pra Sentry/audit.
 *  2. `errorFormatter` (server-side) detecta o cause e injeta
 *     `shape.data.tenantIsolation = { model, op, reason }` — payload
 *     estruturado consumido pelo cliente.
 *  3. `friendlyTrpcError` (client-side) reconhece `data.tenantIsolation`
 *     e renderiza mensagem legível ao invés do JSON cru do payload.
 *
 * Não expõe `payload` do backstop — só metadados sanitizados (nome do
 * modelo Prisma e nome da operação Prisma).
 */

export type TenantIsolationReason =
  | 'missing_tenant_id'
  | 'tenant_id_mismatch';

export type TenantIsolationInfo = {
  model: string;
  op: string;
  reason: TenantIsolationReason;
};

export const TENANT_ISOLATION_PUBLIC_MESSAGE =
  'Erro de isolamento de dados. Reporte à equipe.';

const PREFIX = '[tenant-isolation]';

// Captura `Model.op` e o resto da mensagem pra deduzir a razão.
const MESSAGE_RE = /^\[tenant-isolation\] (\w+)\.(\w+) (.+)$/;

export function isTenantIsolationMessage(message: unknown): message is string {
  return typeof message === 'string' && message.startsWith(PREFIX);
}

export function parseTenantIsolationMessage(
  message: unknown,
): TenantIsolationInfo | null {
  if (!isTenantIsolationMessage(message)) return null;
  const match = MESSAGE_RE.exec(message);
  if (!match) return null;
  const [, model, op, tail] = match;
  if (!model || !op || !tail) return null;

  let reason: TenantIsolationReason;
  if (tail.startsWith('sem tenantId')) {
    reason = 'missing_tenant_id';
  } else if (tail.startsWith('tenantId no payload difere do contexto')) {
    reason = 'tenant_id_mismatch';
  } else {
    return null;
  }

  return { model, op, reason };
}
