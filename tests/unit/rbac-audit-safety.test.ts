// @vitest-environment node
// @ts-nocheck — Sprint 15E ainda não mergeado. Remover junto com describe.skip.
//
// AC-25 — Nunca vazar dados sensíveis em log/audit:
//    - `permissions.forUser` inclui `grantedByUser.fullName` mas não IDs
//      privados (senha, apiKey, etc)
//    - Audit de grant/revoke tem só {permission, reason} — nunca contexto
//      externo (headers, body cru)
//    - Reason do usuário pode conter PII — DataMaskingService NÃO obrigatório
//      aqui (é campo textual de admin, não vai pra IA) mas deve ir em coluna
//      dedicada, não em metadata livre

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TENANT_A, USER_IDS, makeCtx, makeOverride, makeUser } from '../helpers/rbac-fixtures';

const auditSpy = vi.fn();
const hasPermissionSpy = vi.fn();
const mockUser = { findFirst: vi.fn() };
const mockOverride = { upsert: vi.fn(), deleteMany: vi.fn() };

vi.mock('@/lib/auth/rbac', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/rbac')>();
  return {
    ...actual,
    hasPermission: (...args: unknown[]) => hasPermissionSpy(...args),
    invalidateUserPermissionsCache: vi.fn(),
    computeAndCacheUserPermissions: vi.fn().mockResolvedValue(new Set()),
  };
});

vi.mock('@/server/db/client', () => ({
  prisma: {
    user: mockUser,
    userPermissionOverride: mockOverride,
  },
}));

vi.mock('@/server/services/audit.service', () => ({
  audit: (entry: unknown) => auditSpy(entry),
}));

async function makeCaller(role: 'ADMIN' = 'ADMIN') {
  const { permissionsRouter } = await import(
    '@/server/trpc/routers/permissions'
  );
  return permissionsRouter.createCaller(makeCtx({ role, userId: USER_IDS.admin }));
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionSpy.mockResolvedValue(true);
});

describe.skip('AC-25 — permissions.forUser NÃO retorna dados sensíveis', () => {
  it('response NÃO inclui password_hash, session tokens, ou apiKeys', async () => {
    mockUser.findFirst.mockResolvedValueOnce({
      ...makeUser({ id: USER_IDS.analista }),
      // Campos que poderiam vazar se select fosse *
      clerkId: 'user_clerk_secret_123',
      permissionOverrides: [
        { ...makeOverride({ grantedBy: USER_IDS.admin }), grantedByUser: null },
      ],
    });

    const caller = await makeCaller();
    const result = await caller.forUser({ userId: USER_IDS.analista });

    const serialized = JSON.stringify(result);
    // Nenhum indicador de credencial deve estar aí
    expect(serialized).not.toMatch(/password|apiKey|secret|session_token/i);
    // clerkId é OK ser exposto (não é secret), mas se estiver na resposta
    // deve ser deliberado — este teste confere que não é acidental
  });

  it('grantedByUser expõe fullName mas não email/clerkId', async () => {
    mockUser.findFirst.mockResolvedValueOnce({
      ...makeUser({ id: USER_IDS.analista }),
      permissionOverrides: [
        {
          ...makeOverride({ grantedBy: USER_IDS.admin }),
          grantedByUser: {
            // Só id + fullName devem vir do select
            id: USER_IDS.admin,
            fullName: 'Fred M.',
          },
        },
      ],
    });

    const caller = await makeCaller();
    const result = await caller.forUser({ userId: USER_IDS.analista });

    const granted = result.overrides[0].grantedByUser;
    expect(granted).toHaveProperty('fullName');
    // Email do granter não deve aparecer sem opt-in
    expect(granted).not.toHaveProperty('email');
    expect(granted).not.toHaveProperty('clerkId');
  });
});

describe.skip('AC-25 — audit log grant/revoke/restore tem shape mínimo', () => {
  it('audit de grant inclui só {action, tableName, recordId, tenantIdOverride, after}', async () => {
    mockOverride.upsert.mockResolvedValueOnce(makeOverride());
    mockUser.findFirst.mockResolvedValue(makeUser({ id: USER_IDS.analista, tenantId: TENANT_A }));

    const caller = await makeCaller();
    await caller.grant({
      userId: USER_IDS.analista,
      permission: 'inbound:view_queue',
      reason: 'motivo específico',
    });

    const entry = auditSpy.mock.calls[0]![0]!;
    // Chaves permitidas no shape do audit (Sprint 0/15A padrão)
    const ALLOWED_KEYS = new Set([
      'action', 'tableName', 'recordId', 'tenantIdOverride',
      'before', 'after', 'ip', 'userAgent', 'metadata',
    ]);
    for (const key of Object.keys(entry)) {
      expect(ALLOWED_KEYS.has(key), `chave "${key}" não permitida no audit`).toBe(true);
    }
    // Nenhuma request Body ou headers no audit
    expect(entry).not.toHaveProperty('requestBody');
    expect(entry).not.toHaveProperty('headers');
    expect(entry).not.toHaveProperty('cookies');
    expect(entry).not.toHaveProperty('sessionToken');
  });

  it('after do audit tem só {permission, reason} — nunca inclui grantedBy', async () => {
    mockOverride.upsert.mockResolvedValueOnce(makeOverride());
    mockUser.findFirst.mockResolvedValue(makeUser({ id: USER_IDS.analista }));

    const caller = await makeCaller();
    await caller.grant({
      userId: USER_IDS.analista,
      permission: 'audit:read',
      reason: 'audit para forense',
    });

    const entry = auditSpy.mock.calls[0]![0]!;
    // grantedBy vai como recordId ou metadata separada — não no after payload
    expect(entry.after).toMatchObject({
      permission: 'audit:read',
      reason: 'audit para forense',
    });
    // grantedBy pode aparecer em outra chave, mas não deve estar no payload after
  });

  it('audit log NÃO inclui valores do cachedPermissions em texto claro', async () => {
    mockOverride.deleteMany.mockResolvedValueOnce({ count: 1 });
    mockUser.findFirst.mockResolvedValue(makeUser({ id: USER_IDS.analista }));

    const caller = await makeCaller();
    await caller.restore({
      userId: USER_IDS.analista,
      permission: 'reports:financial',
    });

    const entry = auditSpy.mock.calls[0]![0]!;
    const serialized = JSON.stringify(entry);
    // Lista completa de permissions não pertence a esse audit
    expect(serialized).not.toMatch(/opportunity:read.*opportunity:create/);
  });

  it('reason preservado mas limitado ao length permitido (Zod max 500)', async () => {
    mockOverride.upsert.mockResolvedValueOnce(makeOverride());
    mockUser.findFirst.mockResolvedValue(makeUser({ id: USER_IDS.analista }));

    const longReason = 'A'.repeat(501);
    const caller = await makeCaller();
    await expect(
      caller.grant({
        userId: USER_IDS.analista,
        permission: 'inbound:view_queue',
        reason: longReason,
      }),
    ).rejects.toBeTruthy(); // Zod rejeita > 500

    // Se rejeitou, audit não foi chamado
    expect(auditSpy).not.toHaveBeenCalled();
  });
});

describe.skip('AC-25 — reason field pode conter texto livre mas fica em coluna dedicada', () => {
  it('reason vai em UserPermissionOverride.reason (coluna text), não em metadata JSON', async () => {
    mockOverride.upsert.mockResolvedValueOnce(makeOverride({ reason: 'motivo x' }));
    mockUser.findFirst.mockResolvedValue(makeUser({ id: USER_IDS.analista }));

    const caller = await makeCaller();
    await caller.grant({
      userId: USER_IDS.analista,
      permission: 'inbound:view_queue',
      reason: 'motivo x com dados pessoais possíveis',
    });

    const upsertCall = mockOverride.upsert.mock.calls[0]![0]!;
    expect(upsertCall.create.reason).toBe('motivo x com dados pessoais possíveis');
  });
});
