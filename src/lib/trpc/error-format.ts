import type { TRPCClientErrorLike } from '@trpc/client';
import type { AppRouter } from '@/server/trpc/routers/_app';

type ZodShape = {
  fieldErrors?: Record<string, string[] | undefined>;
  formErrors?: string[];
};

type ErrorLike =
  | TRPCClientErrorLike<AppRouter>
  | { message: string; data?: { zodError?: ZodShape | null } | null };

/**
 * Extrai mensagem amigável de um TRPCClientError.
 *
 * O errorFormatter do servidor (src/server/trpc/trpc.ts) expõe
 * `data.zodError` como `zodError.flatten()` quando o `cause` é ZodError.
 * O `err.message` do cliente vem como JSON.stringify desse flatten,
 * o que renderiza `[{code,message,path}]` cru pro usuário. Este helper
 * pega a primeira mensagem legível (fieldError → formError → message).
 */
export function friendlyTrpcError(err: ErrorLike): string {
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
