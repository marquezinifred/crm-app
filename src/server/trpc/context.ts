import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import { prisma } from '@/server/db/client';
import type { User, UserRole } from '@prisma/client';

export interface Context {
  req: Request;
  tenantId: string | null;
  user:
    | (Pick<User, 'id' | 'email' | 'fullName' | 'role' | 'tenantId'> & {
        partnerCompanyId: string | null;
      })
    | null;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Cria o contexto tRPC a partir dos headers injetados pelo middleware.
 * O middleware Clerk já populou:
 *   - x-tenant-id
 *   - x-user-clerk-id
 *   - x-user-role
 *
 * Aqui resolvemos o User local correspondente ao clerkId, incluindo o
 * partnerCompanyId (Sprint 7) para resolver visibilidade do perfil PARCEIRO.
 */
export async function createContext({ req }: FetchCreateContextFnOptions): Promise<Context> {
  const headers = req.headers;
  const tenantId = headers.get('x-tenant-id');
  const clerkId = headers.get('x-user-clerk-id');

  const ip =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headers.get('x-real-ip') ??
    null;
  const userAgent = headers.get('user-agent');

  let user: Context['user'] = null;
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
  }

  return {
    req,
    tenantId,
    user,
    ip,
    userAgent,
  };
}

export type CreateContextOptions = FetchCreateContextFnOptions;

export type AuthContext = Context & {
  user: NonNullable<Context['user']>;
  tenantId: string;
};

export type Role = UserRole;
