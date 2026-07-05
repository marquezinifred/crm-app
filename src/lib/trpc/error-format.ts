import type { TRPCClientErrorLike } from '@trpc/client';
import type { AppRouter } from '@/server/trpc/routers/_app';
import type { TenantIsolationInfo } from '@/lib/trpc/tenant-isolation-error';

type ZodShape = {
  fieldErrors?: Record<string, string[] | undefined>;
  formErrors?: string[];
};

type ErrorLike =
  | TRPCClientErrorLike<AppRouter>
  | {
      message: string;
      data?:
        | {
            zodError?: ZodShape | null;
            tenantIsolation?: TenantIsolationInfo | null;
          }
        | null;
    };

/**
 * Extrai mensagem amigável de um TRPCClientError.
 *
 * O errorFormatter do servidor (src/server/trpc/trpc.ts) expõe
 * `data.zodError` como `zodError.flatten()` quando o `cause` é ZodError.
 * O `err.message` do cliente vem como JSON.stringify desse flatten,
 * o que renderiza `[{code,message,path}]` cru pro usuário. Este helper
 * pega a primeira mensagem legível (fieldError → formError → message).
 *
 * P-46 — reconhece também `data.tenantIsolation` (injetado pelo
 * errorFormatter quando o backstop de tenant-isolation dispara) e
 * renderiza mensagem sanitizada com metadata do modelo/operação.
 */
export function friendlyTrpcError(err: ErrorLike): string {
  const tenantIsolation = err.data?.tenantIsolation ?? null;
  if (tenantIsolation) {
    return `Erro de isolamento de dados. Reporte à equipe (modelo: ${tenantIsolation.model}, operação: ${tenantIsolation.op}).`;
  }
  const zod = err.data?.zodError ?? null;
  if (zod) {
    for (const messages of Object.values(zod.fieldErrors ?? {})) {
      const first = messages?.find((m) => typeof m === 'string' && m.length > 0);
      if (first) return first;
    }
    const firstForm = (zod.formErrors ?? []).find(
      (m) => typeof m === 'string' && m.length > 0,
    );
    if (firstForm) return firstForm;
  }
  return err.message;
}
