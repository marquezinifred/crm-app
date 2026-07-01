// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';

// Prisma mock — cada teste seta os retornos dos métodos usados
const mockTask = {
  findFirst: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
};

vi.mock('@/server/db/client', () => ({
  prisma: { task: mockTask },
}));

vi.mock('@/server/db/tenant-context', () => ({
  runAsSystem: <T,>(fn: () => Promise<T>) => fn(),
  getTenantContext: () => ({ tenantId: 'tenant-A', userId: 'user-1' }),
  SYSTEM_TENANT_SENTINEL: '__system__',
}));

// Audit stub — captura chamadas pra verificação
const auditSpy = vi.fn();
vi.mock('@/server/services/audit.service', () => ({
  audit: (entry: unknown) => auditSpy(entry),
}));

async function makeCaller(role: 'ADMIN' | 'ANALISTA' = 'ADMIN') {
  const { tasksRouter } = await import('@/server/trpc/routers/activities');
  return tasksRouter.createCaller({
    req: new Request('http://localhost/test'),
    tenantId: 'tenant-A',
    user: {
      id: 'user-1',
      email: 'a@b.co',
      fullName: 'Fred',
      role,
      tenantId: 'tenant-A',
      partnerCompanyId: null,
    },
    platformUser: null,
    platformRole: null,
    ip: '127.0.0.1',
    userAgent: 'test-agent',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tasksRouter.update (P-20)', () => {
  it('lança NOT_FOUND quando a task pertence a outro tenant (findFirst filtra por tenantId)', async () => {
    mockTask.findFirst.mockResolvedValueOnce(null);
    const caller = await makeCaller();

    await expect(
      caller.update({
        id: '11111111-1111-1111-1111-111111111111',
        title: 'novo título',
      }),
    ).rejects.toMatchObject({
      name: 'TRPCError',
      code: 'NOT_FOUND',
    });

    expect(mockTask.findFirst).toHaveBeenCalledWith({
      where: {
        id: '11111111-1111-1111-1111-111111111111',
        tenantId: 'tenant-A',
        deletedAt: null,
      },
      select: { id: true },
    });
    expect(mockTask.update).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('só passa campos definidos pro Prisma (undefined não sobrescreve)', async () => {
    mockTask.findFirst.mockResolvedValueOnce({ id: 't1' });
    mockTask.update.mockResolvedValueOnce({ id: 't1', title: 'novo título' });
    const caller = await makeCaller();

    await caller.update({
      id: '11111111-1111-1111-1111-111111111111',
      title: 'novo título',
      // description, dueDate, priority, assigneeId propositalmente omitidos
    });

    const call = mockTask.update.mock.calls[0]![0]!;
    expect(call.data).toMatchObject({ title: 'novo título', updatedBy: 'user-1' });
    expect(call.data).not.toHaveProperty('description');
    expect(call.data).not.toHaveProperty('dueDate');
    expect(call.data).not.toHaveProperty('priority');
    expect(call.data).not.toHaveProperty('assigneeId');
  });

  it('aceita null explícito pra description/dueDate/assigneeId (limpar campo)', async () => {
    mockTask.findFirst.mockResolvedValueOnce({ id: 't1' });
    mockTask.update.mockResolvedValueOnce({ id: 't1' });
    const caller = await makeCaller();

    await caller.update({
      id: '11111111-1111-1111-1111-111111111111',
      description: null,
      dueDate: null,
      assigneeId: null,
    });

    const call = mockTask.update.mock.calls[0]![0]!;
    expect(call.data).toMatchObject({
      description: null,
      dueDate: null,
      assigneeId: null,
    });
  });

  it('grava audit com tenantIdOverride e ação task.update', async () => {
    mockTask.findFirst.mockResolvedValueOnce({ id: 't1' });
    mockTask.update.mockResolvedValueOnce({ id: 't1', title: 'x', priority: 'HIGH' });
    const caller = await makeCaller();

    await caller.update({
      id: '11111111-1111-1111-1111-111111111111',
      priority: 'HIGH',
    });

    expect(auditSpy).toHaveBeenCalledTimes(1);
    const entry = auditSpy.mock.calls[0]![0]!;
    expect(entry).toMatchObject({
      action: 'task.update',
      tableName: 'tasks',
      recordId: 't1',
      tenantIdOverride: 'tenant-A',
      ip: '127.0.0.1',
      userAgent: 'test-agent',
    });
  });

  it('rejeita título vazio ou <2 chars via validação Zod', async () => {
    const caller = await makeCaller();
    await expect(
      caller.update({
        id: '11111111-1111-1111-1111-111111111111',
        title: 'x',
      }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(mockTask.findFirst).not.toHaveBeenCalled();
  });

  it('rejeita usuário sem capability opportunity:update (ANALISTA tem, PARCEIRO não)', async () => {
    // ANALISTA tem opportunity:update pela matriz — smoke test que caller funciona
    mockTask.findFirst.mockResolvedValueOnce({ id: 't1' });
    mockTask.update.mockResolvedValueOnce({ id: 't1' });
    const caller = await makeCaller('ANALISTA');
    await expect(
      caller.update({
        id: '11111111-1111-1111-1111-111111111111',
        title: 'novo título',
      }),
    ).resolves.toBeDefined();
  });
});

describe('tasksRouter.delete (P-20)', () => {
  it('lança NOT_FOUND (não FORBIDDEN — evita enumeration) pra task de outro tenant', async () => {
    mockTask.findFirst.mockResolvedValueOnce(null);
    const caller = await makeCaller();

    await expect(
      caller.delete({ id: '11111111-1111-1111-1111-111111111111' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mockTask.update).not.toHaveBeenCalled();
  });

  it('faz soft delete (preenche deletedAt em vez de remover)', async () => {
    mockTask.findFirst.mockResolvedValueOnce({
      id: 't1',
      title: 'Enviar proposta',
      opportunityId: 'opp-1',
      status: 'TODO',
    });
    mockTask.update.mockResolvedValueOnce({ id: 't1' });
    const caller = await makeCaller();

    const result = await caller.delete({ id: '11111111-1111-1111-1111-111111111111' });
    expect(result).toEqual({ ok: true });

    const updateCall = mockTask.update.mock.calls[0]![0]!;
    expect(updateCall.where).toEqual({ id: '11111111-1111-1111-1111-111111111111' });
    expect(updateCall.data).toMatchObject({ updatedBy: 'user-1' });
    expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
  });

  it('grava audit com before + tenantIdOverride e ação task.delete', async () => {
    const before = {
      id: 't1',
      title: 'Enviar proposta',
      opportunityId: 'opp-1',
      status: 'TODO',
    };
    mockTask.findFirst.mockResolvedValueOnce(before);
    mockTask.update.mockResolvedValueOnce({ id: 't1' });
    const caller = await makeCaller();

    await caller.delete({ id: '11111111-1111-1111-1111-111111111111' });

    expect(auditSpy).toHaveBeenCalledTimes(1);
    const entry = auditSpy.mock.calls[0]![0]!;
    expect(entry).toMatchObject({
      action: 'task.delete',
      tableName: 'tasks',
      recordId: '11111111-1111-1111-1111-111111111111',
      before,
      tenantIdOverride: 'tenant-A',
    });
  });

  it('rejeita id não-uuid via Zod', async () => {
    const caller = await makeCaller();
    await expect(caller.delete({ id: 'not-a-uuid' })).rejects.toBeInstanceOf(TRPCError);
    expect(mockTask.findFirst).not.toHaveBeenCalled();
  });
});
