import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import { prisma } from '@/server/db/client';
import { setContextUserId } from '@/server/db/tenant-context';
import type { AuthState } from '@/lib/trpc/auth-markers';
import type { User, UserRole, PlatformRole } from '@prisma/client';

export interface Context {
  req: Request;
  tenantId: string | null;
  user:
    | (Pick<User, 'id' | 'email' | 'fullName' | 'role' | 'tenantId'> & {
        partnerCompanyId: string | null;
      })
    | null;
  /**
   * P-82 — estado de provisionamento do usuário tenant. `NOT_PROVISIONED`
   * quando clerkId+tenantId chegaram nos headers (sessão Clerk válida) mas
   * o lookup local retornou null. Usado por `enforceAuth` para sinalizar a
   * tela `/account-not-found` em vez de deixar o cliente recarregar em loop.
   *
   * `createContext` SEMPRE popula este campo em runtime. É opcional só na
   * interface para não exigir que mocks de Context em testes (que constroem
   * um caller autenticado) o declarem — quando ausente, `enforceAuth` trata
   * como não-provisionamento indeterminado e cai no `UNAUTHORIZED` comum.
   */
  authState?: AuthState;
  platformUser:
    | (Pick<User, 'id' | 'email' | 'fullName'> & { platformRole: PlatformRole })
    | null;
  platformRole: PlatformRole | null;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Cria o contexto tRPC a partir dos headers injetados pelo middleware.
 * O middleware Clerk já populou:
 *   - x-tenant-id, x-user-clerk-id, x-user-role (tenant users)
 *   - x-platform-user-clerk-id, x-platform-role (Platform Owner — Sprint 15A)
 *
 * Para tenant users, resolvemos o User local com partnerCompanyId
 * (Sprint 7) para visibilidade do perfil PARCEIRO. Para Platform users,
 * resolvemos o User com tenantId NULL + platformRole obrigatório.
 */
export async function createContext({ req }: FetchCreateContextFnOptions): Promise<Context> {
  const headers = req.headers;
  const tenantId = headers.get('x-tenant-id');
  const clerkId = headers.get('x-user-clerk-id');
  const platformClerkId = headers.get('x-platform-user-clerk-id');
  const platformRoleHeader = headers.get('x-platform-role') as PlatformRole | null;

  const ip =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headers.get('x-real-ip') ??
    null;
  const userAgent = headers.get('user-agent');

  let user: Context['user'] = null;
  let authState: AuthState = 'ANONYMOUS';
  if (clerkId && tenantId) {
    const rows = await prisma.$queryRaw<
      Array<
        Pick<User, 'id' | 'email' | 'fullName' | 'role' | 'tenantId'> & {
          partnerCompanyId: string | null;
        }
      >
    >`
      SELECT id, email, full_name AS "fullName", role,
             tenant_id AS "tenantId",
             partner_company_id AS "partnerCompanyId"
      FROM users
      WHERE clerk_id = ${clerkId}
        AND tenant_id = ${tenantId}::uuid
        AND deleted_at IS NULL
        AND active = true
      LIMIT 1
    `;
    user = rows[0] ?? null;
    // P-82 — clerkId+tenantId presentes mas sem row local = conta Clerk
    // autenticada porém não provisionada neste workspace (ex.: restore PITR).
    authState = user ? 'OK' : 'NOT_PROVISIONED';

    // Sprint 15G.5 (T15) — propaga o userId resolvido pro AsyncLocalStorage
    // que o route handler iniciou com userId=null. O guard de transferência
    // (db/client.ts) precisa do ator pra distinguir disparador vs dono
    // durante uma pendência. Como bônus, dá atribuição de actor ao audit()
    // (que já lê ctx.userId — antes sempre null no path tRPC).
    if (user) setContextUserId(user.id);
  }

  let platformUser: Context['platformUser'] = null;
  if (platformClerkId && platformRoleHeader) {
    const rows = await prisma.$queryRaw<
      Array<Pick<User, 'id' | 'email' | 'fullName'> & { platformRole: PlatformRole }>
    >`
      SELECT id, email, full_name AS "fullName",
             platform_role AS "platformRole"
      FROM users
      WHERE clerk_id = ${platformClerkId}
        AND tenant_id IS NULL
        AND platform_role IS NOT NULL
        AND deleted_at IS NULL
        AND active = true
      LIMIT 1
    `;
    platformUser = rows[0] ?? null;
  }

  return {
    req,
    tenantId,
    user,
    authState,
    platformUser,
    platformRole: platformUser?.platformRole ?? null,
    ip,
    userAgent,
  };
}

export type CreateContextOptions = FetchCreateContextFnOptions;

export type AuthContext = Context & {
  user: NonNullable<Context['user']>;
  tenantId: string;
};

export type PlatformContext = Context & {
  platformUser: NonNullable<Context['platformUser']>;
  platformRole: PlatformRole;
};

export type Role = UserRole;
