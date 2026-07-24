import { describe, it, expect } from 'vitest';
import {
  assertTransferWriteAllowed,
  payloadClearsCurrentTransfer,
  evaluateTransferGuard,
  type TransferGuardDb,
  type TransferGuardFacts,
} from '@/server/db/client';

/**
 * Sprint 15G.5 chip 2c (T2/T15/T19) — Guard de transferência de oportunidade
 * na Prisma extension (`src/server/db/client.ts`).
 *
 * Provas obrigatórias da T19 (as carve-outs sem as quais o guard quebra o
 * próprio fluxo):
 *  - dono (owner) NÃO edita business field / cria task/activity/proposal/doc
 *    durante PENDING → bloqueado.
 *  - destinatário CONSEGUE approve/reject (payload zera currentTransferId,
 *    userId != disparador, flag ainda setada no banco) → passa (T19a).
 *  - worker timeout CONSEGUE (contexto de sistema, userId null) → passa (T19b).
 *  - disparador (requester) CONSEGUE escrever durante PENDING.
 *  - opp SEM transferência ativa → ninguém bloqueado (pré-15G.5).
 *
 * Os testes da função PURA (`assertTransferWriteAllowed`) são a prova
 * determinística; `evaluateTransferGuard` com um `TransferGuardDb` fake
 * exercita a resolução da opp-alvo + a carve-out ponta a ponta sem DB. O
 * caminho da extension REAL (kill-switch, base não-estendido, anti-recursão)
 * é coberto por `tests/integration/opportunity-transfer-guard.test.ts`
 * (gated por DATABASE_URL_TEST) + o backstop estrutural.
 */

const REQUESTER = 'user-requester';
const OWNER = 'user-owner';
const RECIPIENT = 'user-recipient';
const TENANT = 'tenant-A';
const TID = 'transfer-1';

// ======================================================================
// 1. assertTransferWriteAllowed — núcleo puro da decisão (T19)
// ======================================================================

describe('assertTransferWriteAllowed — pura (T19)', () => {
  const pending = (over: Partial<TransferGuardFacts> = {}): TransferGuardFacts => ({
    currentTransferId: TID,
    activeTransferRequestedById: REQUESTER,
    ctxUserId: OWNER,
    payloadClearsTransfer: false,
    model: 'Opportunity',
    opportunityId: 'opp-1',
    ...over,
  });

  it('dono NÃO edita business field durante PENDING → bloqueado', () => {
    const detail = assertTransferWriteAllowed(pending({ ctxUserId: OWNER }));
    expect(detail).toContain('[transfer-guard]');
    expect(detail).toContain('opp-1');
  });

  it('terceiro (nem dono nem disparador) NÃO escreve durante PENDING → bloqueado', () => {
    expect(assertTransferWriteAllowed(pending({ ctxUserId: 'user-outro' }))).not.toBeNull();
  });

  it('dono NÃO cria task/activity/proposal/document durante PENDING → bloqueado', () => {
    for (const model of ['Task', 'Activity', 'Proposal', 'Document']) {
      const detail = assertTransferWriteAllowed(pending({ model, ctxUserId: OWNER }));
      expect(detail, `${model} deveria bloquear`).not.toBeNull();
      expect(detail).toContain(model);
    }
  });

  it('destinatário CONSEGUE approve — payload zera currentTransferId (T19a)', () => {
    const detail = assertTransferWriteAllowed(
      pending({ ctxUserId: RECIPIENT, payloadClearsTransfer: true }),
    );
    expect(detail).toBeNull();
  });

  it('destinatário CONSEGUE reject — mesma carve-out de máquina de estado', () => {
    const detail = assertTransferWriteAllowed(
      pending({ ctxUserId: RECIPIENT, payloadClearsTransfer: true }),
    );
    expect(detail).toBeNull();
  });

  it('worker timeout CONSEGUE — contexto de sistema (userId null) (T19b)', () => {
    expect(assertTransferWriteAllowed(pending({ ctxUserId: null }))).toBeNull();
  });

  it('disparador (requester) CONSEGUE escrever durante PENDING', () => {
    expect(assertTransferWriteAllowed(pending({ ctxUserId: REQUESTER }))).toBeNull();
  });

  it('opp SEM transferência ativa → ninguém bloqueado (pré-15G.5)', () => {
    expect(
      assertTransferWriteAllowed(
        pending({ currentTransferId: null, activeTransferRequestedById: null, ctxUserId: OWNER }),
      ),
    ).toBeNull();
  });

  it('carve-out (a) precede a checagem de ator — recipient com clear passa mesmo != requester', () => {
    // Garante a ordem: mesmo com ctxUserId != requester, o clear libera.
    const detail = assertTransferWriteAllowed(
      pending({ ctxUserId: RECIPIENT, payloadClearsTransfer: true }),
    );
    expect(detail).toBeNull();
  });

  it('mensagem de bloqueio traz disparador e ator no cause (P-98 técnico)', () => {
    const detail = assertTransferWriteAllowed(pending({ ctxUserId: OWNER }));
    expect(detail).toContain(REQUESTER);
    expect(detail).toContain(OWNER);
  });
});

// ======================================================================
// 2. payloadClearsCurrentTransfer — detecção do "seta para null" (T19a)
// ======================================================================

describe('payloadClearsCurrentTransfer', () => {
  it('update { currentTransferId: null } → true', () => {
    expect(payloadClearsCurrentTransfer('update', { data: { currentTransferId: null } })).toBe(
      true,
    );
  });

  it('update { currentTransferId: { set: null } } → true', () => {
    expect(
      payloadClearsCurrentTransfer('update', { data: { currentTransferId: { set: null } } }),
    ).toBe(true);
  });

  it('update sem currentTransferId (edição normal do dono) → false', () => {
    expect(
      payloadClearsCurrentTransfer('update', { data: { description: 'x', updatedBy: OWNER } }),
    ).toBe(false);
  });

  it('request seta currentTransferId para não-null → false (não é carve-out)', () => {
    expect(
      payloadClearsCurrentTransfer('update', { data: { currentTransferId: TID } }),
    ).toBe(false);
  });

  it('upsert usa o branch update → true quando update zera', () => {
    expect(
      payloadClearsCurrentTransfer('upsert', {
        update: { currentTransferId: null },
        create: { currentTransferId: TID },
      }),
    ).toBe(true);
  });

  it('data array (defensivo) → false', () => {
    expect(payloadClearsCurrentTransfer('updateMany', { data: [{ currentTransferId: null }] })).toBe(
      false,
    );
  });

  it('data ausente → false', () => {
    expect(payloadClearsCurrentTransfer('update', {})).toBe(false);
  });
});

// ======================================================================
// 3. evaluateTransferGuard — resolução da opp-alvo + carve-out (fake db)
// ======================================================================

interface FakeOpp {
  id: string;
  tenantId: string;
  currentTransferId: string | null;
  requestedById: string | null;
}
interface FakeChild {
  id: string;
  tenantId: string;
  opportunityId: string | null;
}
interface FakeDoc {
  id: string;
  tenantId: string;
  relatedEntityType: string;
  relatedEntityId: string;
}

interface FakeWorld {
  opps?: FakeOpp[];
  proposals?: FakeChild[];
  activities?: FakeChild[];
  tasks?: FakeChild[];
  docs?: FakeDoc[];
}

interface RecordedCall {
  model: string;
  tenantId: string | undefined;
  ids: string[] | null;
}

function parseArgs(args: unknown): { ids: string[] | null; tenantId: string | undefined } {
  const a = (args ?? {}) as { where?: { id?: unknown; tenantId?: unknown } };
  const where = a.where ?? {};
  const id = where.id as { in?: unknown } | undefined;
  const ids = id && typeof id === 'object' && Array.isArray(id.in) ? (id.in as string[]) : null;
  const tenantId = typeof where.tenantId === 'string' ? where.tenantId : undefined;
  return { ids, tenantId };
}

function makeFakeDb(world: FakeWorld): TransferGuardDb & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const filterChildren = (rows: FakeChild[], args: unknown) => {
    const { ids, tenantId } = parseArgs(args);
    calls.push({ model: 'child', tenantId, ids });
    return rows
      .filter((c) => (ids ? ids.includes(c.id) : true) && c.tenantId === tenantId)
      .map((c) => ({ opportunityId: c.opportunityId }));
  };
  return {
    calls,
    opportunity: {
      async findMany(args: unknown) {
        const { ids, tenantId } = parseArgs(args);
        calls.push({ model: 'opportunity', tenantId, ids });
        return (world.opps ?? [])
          .filter((o) => (ids ? ids.includes(o.id) : true) && o.tenantId === tenantId)
          .map((o) => ({
            id: o.id,
            currentTransferId: o.currentTransferId,
            currentTransfer: o.currentTransferId
              ? { requestedById: o.requestedById ?? '' }
              : null,
          }));
      },
    },
    proposal: { async findMany(args: unknown) { return filterChildren(world.proposals ?? [], args); } },
    activity: { async findMany(args: unknown) { return filterChildren(world.activities ?? [], args); } },
    task: { async findMany(args: unknown) { return filterChildren(world.tasks ?? [], args); } },
    document: {
      async findMany(args: unknown) {
        const { ids, tenantId } = parseArgs(args);
        calls.push({ model: 'document', tenantId, ids });
        return (world.docs ?? [])
          .filter((d) => (ids ? ids.includes(d.id) : true) && d.tenantId === tenantId)
          .map((d) => ({ relatedEntityType: d.relatedEntityType, relatedEntityId: d.relatedEntityId }));
      },
    },
  };
}

const oppUnderTransfer: FakeOpp = {
  id: 'opp-1',
  tenantId: TENANT,
  currentTransferId: TID,
  requestedById: REQUESTER,
};
const oppFree: FakeOpp = {
  id: 'opp-2',
  tenantId: TENANT,
  currentTransferId: null,
  requestedById: null,
};

describe('evaluateTransferGuard — Opportunity direto', () => {
  it('dono edita opp em PENDING → bloqueado', async () => {
    const db = makeFakeDb({ opps: [oppUnderTransfer] });
    const detail = await evaluateTransferGuard(
      db,
      'Opportunity',
      'update',
      { where: { id: 'opp-1' }, data: { description: 'x' } },
      TENANT,
      OWNER,
    );
    expect(detail).not.toBeNull();
  });

  it('disparador edita opp em PENDING → passa', async () => {
    const db = makeFakeDb({ opps: [oppUnderTransfer] });
    const detail = await evaluateTransferGuard(
      db,
      'Opportunity',
      'update',
      { where: { id: 'opp-1' }, data: { description: 'x' } },
      TENANT,
      REQUESTER,
    );
    expect(detail).toBeNull();
  });

  it('destinatário approve (data.currentTransferId=null) → passa (carve-out)', async () => {
    const db = makeFakeDb({ opps: [oppUnderTransfer] });
    const detail = await evaluateTransferGuard(
      db,
      'Opportunity',
      'update',
      { where: { id: 'opp-1' }, data: { ownerId: 'new', currentTransferId: null } },
      TENANT,
      RECIPIENT,
    );
    expect(detail).toBeNull();
  });

  it('opp sem transferência → passa', async () => {
    const db = makeFakeDb({ opps: [oppFree] });
    const detail = await evaluateTransferGuard(
      db,
      'Opportunity',
      'update',
      { where: { id: 'opp-2' }, data: { description: 'x' } },
      TENANT,
      OWNER,
    );
    expect(detail).toBeNull();
  });

  it('Opportunity.create → skip (sem lookup, opp nova)', async () => {
    const db = makeFakeDb({ opps: [oppUnderTransfer] });
    const detail = await evaluateTransferGuard(
      db,
      'Opportunity',
      'create',
      { data: { title: 'nova', tenantId: TENANT } },
      TENANT,
      OWNER,
    );
    expect(detail).toBeNull();
    expect(db.calls.length).toBe(0);
  });

  it('worker (ctxUserId null) → passa mesmo com opp em PENDING (T19b)', async () => {
    const db = makeFakeDb({ opps: [oppUnderTransfer] });
    const detail = await evaluateTransferGuard(
      db,
      'Opportunity',
      'update',
      { where: { id: 'opp-1' }, data: { currentTransferId: null } },
      TENANT,
      null,
    );
    expect(detail).toBeNull();
  });

  it('updateMany com where complexo (sem id) → permissivo, sem lookup', async () => {
    const db = makeFakeDb({ opps: [oppUnderTransfer] });
    const detail = await evaluateTransferGuard(
      db,
      'Opportunity',
      'updateMany',
      { where: { stage: 'LEAD' }, data: { description: 'x' } },
      TENANT,
      OWNER,
    );
    expect(detail).toBeNull();
    expect(db.calls.length).toBe(0);
  });

  it('cross-tenant: opp de outro tenant não é encontrada → passa (isolamento)', async () => {
    const db = makeFakeDb({ opps: [oppUnderTransfer] });
    const detail = await evaluateTransferGuard(
      db,
      'Opportunity',
      'update',
      { where: { id: 'opp-1' }, data: { description: 'x' } },
      'tenant-OUTRO',
      OWNER,
    );
    expect(detail).toBeNull();
    // O lookup foi filtrado pelo tenant do contexto.
    expect(db.calls[0]?.tenantId).toBe('tenant-OUTRO');
  });
});

describe('evaluateTransferGuard — modelos-filho', () => {
  it('Task.create pelo dono na opp em PENDING → bloqueado', async () => {
    const db = makeFakeDb({ opps: [oppUnderTransfer] });
    const detail = await evaluateTransferGuard(
      db,
      'Task',
      'create',
      { data: { opportunityId: 'opp-1', title: 't' } },
      TENANT,
      OWNER,
    );
    expect(detail).not.toBeNull();
  });

  it('Task.create pelo disparador → passa', async () => {
    const db = makeFakeDb({ opps: [oppUnderTransfer] });
    const detail = await evaluateTransferGuard(
      db,
      'Task',
      'create',
      { data: { opportunityId: 'opp-1', title: 't' } },
      TENANT,
      REQUESTER,
    );
    expect(detail).toBeNull();
  });

  it('Activity.create pelo dono na opp em PENDING → bloqueado', async () => {
    const db = makeFakeDb({ opps: [oppUnderTransfer] });
    const detail = await evaluateTransferGuard(
      db,
      'Activity',
      'create',
      { data: { opportunityId: 'opp-1', kind: 'NOTE' } },
      TENANT,
      OWNER,
    );
    expect(detail).not.toBeNull();
  });

  it('Proposal.create pelo dono na opp em PENDING → bloqueado', async () => {
    const db = makeFakeDb({ opps: [oppUnderTransfer] });
    const detail = await evaluateTransferGuard(
      db,
      'Proposal',
      'create',
      { data: { opportunityId: 'opp-1' } },
      TENANT,
      OWNER,
    );
    expect(detail).not.toBeNull();
  });

  it('Task.update pelo dono → resolve filho→opp (child lookup) → bloqueado', async () => {
    const db = makeFakeDb({
      opps: [oppUnderTransfer],
      tasks: [{ id: 'task-1', tenantId: TENANT, opportunityId: 'opp-1' }],
    });
    const detail = await evaluateTransferGuard(
      db,
      'Task',
      'update',
      { where: { id: 'task-1' }, data: { status: 'DONE' } },
      TENANT,
      OWNER,
    );
    expect(detail).not.toBeNull();
    // Fez 2 lookups: task (child) + opportunity.
    expect(db.calls.map((c) => c.model)).toEqual(['child', 'opportunity']);
  });

  it('Task.update de task sem opp (opportunityId null) → passa', async () => {
    const db = makeFakeDb({
      opps: [oppUnderTransfer],
      tasks: [{ id: 'task-x', tenantId: TENANT, opportunityId: null }],
    });
    const detail = await evaluateTransferGuard(
      db,
      'Task',
      'update',
      { where: { id: 'task-x' }, data: { status: 'DONE' } },
      TENANT,
      OWNER,
    );
    expect(detail).toBeNull();
  });
});

describe('evaluateTransferGuard — Document (polimórfico)', () => {
  it('Document.create relatedEntityType=opportunity pelo dono em PENDING → bloqueado', async () => {
    const db = makeFakeDb({ opps: [oppUnderTransfer] });
    const detail = await evaluateTransferGuard(
      db,
      'Document',
      'create',
      { data: { relatedEntityType: 'opportunity', relatedEntityId: 'opp-1' } },
      TENANT,
      OWNER,
    );
    expect(detail).not.toBeNull();
  });

  it('Document.create relatedEntityType=company → skip (não é opp)', async () => {
    const db = makeFakeDb({ opps: [oppUnderTransfer] });
    const detail = await evaluateTransferGuard(
      db,
      'Document',
      'create',
      { data: { relatedEntityType: 'company', relatedEntityId: 'company-1' } },
      TENANT,
      OWNER,
    );
    expect(detail).toBeNull();
    expect(db.calls.length).toBe(0);
  });

  it('Document.update pelo dono → resolve doc→opp → bloqueado', async () => {
    const db = makeFakeDb({
      opps: [oppUnderTransfer],
      docs: [
        {
          id: 'doc-1',
          tenantId: TENANT,
          relatedEntityType: 'opportunity',
          relatedEntityId: 'opp-1',
        },
      ],
    });
    const detail = await evaluateTransferGuard(
      db,
      'Document',
      'update',
      { where: { id: 'doc-1' }, data: { filename: 'x.pdf' } },
      TENANT,
      OWNER,
    );
    expect(detail).not.toBeNull();
    expect(db.calls.map((c) => c.model)).toEqual(['document', 'opportunity']);
  });

  it('Document.update de doc de company → passa (não resolve opp)', async () => {
    const db = makeFakeDb({
      opps: [oppUnderTransfer],
      docs: [
        {
          id: 'doc-2',
          tenantId: TENANT,
          relatedEntityType: 'company',
          relatedEntityId: 'company-1',
        },
      ],
    });
    const detail = await evaluateTransferGuard(
      db,
      'Document',
      'update',
      { where: { id: 'doc-2' }, data: { filename: 'x.pdf' } },
      TENANT,
      OWNER,
    );
    expect(detail).toBeNull();
  });
});
