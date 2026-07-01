// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';

/**
 * P-24 — form "Adicionar feature" no /platform/ai-marketplace.
 *
 * Exercita a mutation `createFeature` do router platform-ai-marketplace:
 *  - validação Zod (kebab-case, min lengths, enum providers)
 *  - CONFLICT quando code já existe
 *  - audit chamado com after populado
 *  - feature criada aparece em list subsequente
 *  - platformProcedure bloqueia caller sem role PLATFORM_OWNER
 */

// Prisma mock — cada teste seta os retornos dos métodos usados
const mockAiFeature = {
  findUnique: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
};

vi.mock('@/server/db/client', () => ({
  prisma: { aiFeature: mockAiFeature },
}));

vi.mock('@/server/db/tenant-context', () => ({
  runAsPlatform: <T,>(_userId: string, fn: () => Promise<T>) => fn(),
  PLATFORM_TENANT_SENTINEL: '__platform__',
}));

const auditSpy = vi.fn();
vi.mock('@/server/services/audit-platform.service', () => ({
  platformAudit: (entry: unknown) => auditSpy(entry),
}));

// platformRole aceita string genérica no teste — o context tRPC tipa como
// `PlatformRole | null`, mas passamos strings quaisquer pra exercitar o
// middleware `enforcePlatform` (que rejeita !== 'PLATFORM_OWNER').
type CallerCtx = {
  platformUser: { id: string; email: string; fullName: string; platformRole: 'PLATFORM_OWNER' } | null;
  platformRole: string | null;
};

// `??` short-circuits em undefined E null — usar chave explícita `in overrides`
// permite testes que passem `null` como valor real (não fallback pro default).
async function makeCaller(overrides: Partial<CallerCtx> = {}) {
  const { platformAiMarketplaceRouter } = await import(
    '@/server/trpc/routers/platform-ai-marketplace'
  );
  const platformUser =
    'platformUser' in overrides
      ? overrides.platformUser!
      : {
          id: 'plat-user-1',
          email: 'owner@venzo.com',
          fullName: 'Fred Marquezini',
          platformRole: 'PLATFORM_OWNER' as const,
        };
  const platformRole =
    'platformRole' in overrides ? overrides.platformRole! : 'PLATFORM_OWNER';
  return platformAiMarketplaceRouter.createCaller({
    req: new Request('http://localhost/test'),
    tenantId: null,
    user: null,
    platformUser,
    // Cast pra any porque o teste passa strings arbitrárias pra exercitar
    // o guard `!== 'PLATFORM_OWNER'` do middleware `enforcePlatform`.
    platformRole: platformRole as never,
    ip: '127.0.0.1',
    userAgent: 'test-agent',
  });
}

const validInput = {
  code: 'email-classify',
  name: 'Classificação de e-mails',
  description: 'IA classifica e-mails inbound como suporte, vendas ou spam.',
  category: 'CLASSIFICATION' as const,
  defaultProvider: 'ANTHROPIC' as const,
  defaultModel: 'claude-haiku-4-5-20251001',
  defaultInclusion: {
    TRIAL: 'included' as const,
    STARTER: 'disabled' as const,
    PRO: 'included' as const,
    ENTERPRISE: 'included' as const,
  },
  addonPriceBrlMonthly: 89,
  addonPriceBrlPerUse: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('platform.aiMarketplace.createFeature validation', () => {
  it('rejeita code fora do padrão kebab-case (ex: "Foo Bar")', async () => {
    const caller = await makeCaller();
    await expect(
      caller.createFeature({ ...validInput, code: 'Foo Bar' }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(mockAiFeature.findUnique).not.toHaveBeenCalled();
    expect(mockAiFeature.create).not.toHaveBeenCalled();
  });

  it('rejeita code com maiúsculas ("EmailClassify")', async () => {
    const caller = await makeCaller();
    await expect(
      caller.createFeature({ ...validInput, code: 'EmailClassify' }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('rejeita code com underscore ("email_classify")', async () => {
    const caller = await makeCaller();
    await expect(
      caller.createFeature({ ...validInput, code: 'email_classify' }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('aceita code kebab-case ("email-classify") e passa pra create', async () => {
    mockAiFeature.findUnique.mockResolvedValueOnce(null);
    mockAiFeature.create.mockResolvedValueOnce({
      id: 'feat-1',
      code: 'email-classify',
      name: validInput.name,
    });
    const caller = await makeCaller();

    await expect(caller.createFeature(validInput)).resolves.toBeDefined();

    expect(mockAiFeature.create).toHaveBeenCalledTimes(1);
    const call = mockAiFeature.create.mock.calls[0]![0]!;
    expect(call.data.code).toBe('email-classify');
    expect(call.data.active).toBe(true);
  });

  it('rejeita descrição curta (<10 chars)', async () => {
    const caller = await makeCaller();
    await expect(
      caller.createFeature({ ...validInput, description: 'curta' }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('rejeita provider inválido ("MISTRAL")', async () => {
    const caller = await makeCaller();
    await expect(
      caller.createFeature({
        ...validInput,
        // @ts-expect-error — testando runtime rejection de enum
        defaultProvider: 'MISTRAL',
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('rejeita defaultInclusion faltando um plano (sem ENTERPRISE)', async () => {
    const caller = await makeCaller();
    await expect(
      caller.createFeature({
        ...validInput,
        // @ts-expect-error — validando shape parcial
        defaultInclusion: { TRIAL: 'included', STARTER: 'disabled', PRO: 'included' },
      }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

describe('platform.aiMarketplace.createFeature persistence', () => {
  it('lança CONFLICT quando code já existe', async () => {
    mockAiFeature.findUnique.mockResolvedValueOnce({ id: 'feat-existing' });
    const caller = await makeCaller();

    await expect(caller.createFeature(validInput)).rejects.toMatchObject({
      name: 'TRPCError',
      code: 'CONFLICT',
      message: 'Feature com esse code já existe.',
    });

    expect(mockAiFeature.create).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('persiste com os campos corretos + active=true', async () => {
    mockAiFeature.findUnique.mockResolvedValueOnce(null);
    mockAiFeature.create.mockResolvedValueOnce({
      id: 'feat-1',
      code: validInput.code,
    });
    const caller = await makeCaller();

    await caller.createFeature(validInput);

    const call = mockAiFeature.create.mock.calls[0]![0]!;
    expect(call.data).toMatchObject({
      code: 'email-classify',
      name: 'Classificação de e-mails',
      category: 'CLASSIFICATION',
      defaultProvider: 'ANTHROPIC',
      defaultModel: 'claude-haiku-4-5-20251001',
      addonPriceBrlMonthly: 89,
      addonPriceBrlPerUse: null,
      active: true,
    });
    expect(call.data.defaultInclusion).toEqual({
      TRIAL: 'included',
      STARTER: 'disabled',
      PRO: 'included',
      ENTERPRISE: 'included',
    });
  });

  it('nulifica preços quando não informados', async () => {
    mockAiFeature.findUnique.mockResolvedValueOnce(null);
    mockAiFeature.create.mockResolvedValueOnce({ id: 'feat-1' });
    const caller = await makeCaller();

    await caller.createFeature({
      ...validInput,
      addonPriceBrlMonthly: undefined,
      addonPriceBrlPerUse: undefined,
    });

    const call = mockAiFeature.create.mock.calls[0]![0]!;
    expect(call.data.addonPriceBrlMonthly).toBeNull();
    expect(call.data.addonPriceBrlPerUse).toBeNull();
  });

  it('grava audit com action platform.aiMarketplace.createFeature + after populado', async () => {
    const createdRow = {
      id: 'feat-1',
      code: 'email-classify',
      name: 'Classificação de e-mails',
      active: true,
    };
    mockAiFeature.findUnique.mockResolvedValueOnce(null);
    mockAiFeature.create.mockResolvedValueOnce(createdRow);
    const caller = await makeCaller();

    await caller.createFeature(validInput);

    expect(auditSpy).toHaveBeenCalledTimes(1);
    const entry = auditSpy.mock.calls[0]![0]!;
    expect(entry).toMatchObject({
      platformUserId: 'plat-user-1',
      action: 'platform.aiMarketplace.createFeature',
      tableName: 'ai_features',
      recordId: 'feat-1',
      after: createdRow,
    });
  });

  it('feature criada aparece em list subsequente', async () => {
    mockAiFeature.findUnique.mockResolvedValueOnce(null);
    const createdRow = {
      id: 'feat-1',
      code: 'email-classify',
      name: 'Classificação de e-mails',
      description: validInput.description,
      category: 'CLASSIFICATION',
      defaultProvider: 'ANTHROPIC',
      defaultModel: 'claude-haiku-4-5-20251001',
      defaultInclusion: validInput.defaultInclusion,
      addonPriceBrlMonthly: 89,
      addonPriceBrlPerUse: null,
      active: true,
      createdAt: new Date('2026-07-01T00:00:00Z'),
    };
    mockAiFeature.create.mockResolvedValueOnce(createdRow);
    const caller = await makeCaller();

    await caller.createFeature(validInput);

    // Simula list retornando a feature recém-criada + count zero
    mockAiFeature.findMany.mockResolvedValueOnce([
      { ...createdRow, _count: { tenantStates: 0 } },
    ]);

    const list = await caller.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.code).toBe('email-classify');
    expect(mockAiFeature.findMany).toHaveBeenCalledWith({
      orderBy: { name: 'asc' },
      include: { _count: { select: { tenantStates: true } } },
    });
  });
});

describe('platform.aiMarketplace.createFeature RBAC', () => {
  it('bloqueia caller sem platformRole=PLATFORM_OWNER (FORBIDDEN)', async () => {
    const caller = await makeCaller({
      platformUser: null,
      platformRole: 'ADMIN',
    });

    await expect(caller.createFeature(validInput)).rejects.toMatchObject({
      name: 'TRPCError',
      code: 'FORBIDDEN',
    });

    expect(mockAiFeature.findUnique).not.toHaveBeenCalled();
    expect(mockAiFeature.create).not.toHaveBeenCalled();
  });

  it('bloqueia caller sem platformUser (sessão tenant regular)', async () => {
    const caller = await makeCaller({ platformUser: null, platformRole: null });

    await expect(caller.createFeature(validInput)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
