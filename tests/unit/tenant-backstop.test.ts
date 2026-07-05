import { describe, it, expect } from 'vitest';
import { assertTenantWritePayload } from '@/server/db/client';

/**
 * P-42 — Backstop de tenant-isolation em writes.
 *
 * Antes: qualquer `.update` sem `tenantId` no data lançava erro cru → 500
 * em produção quando a UI salvava campos por estágio (meetingScheduledAt,
 * meetingHappened, etc.). Zod schemas de update não têm tenantId e não
 * deveriam ter — o cliente não precisa (e não pode) saber o tenantId.
 *
 * Depois: create exige tenantId (compat + defesa em profundidade contra
 * spread bypass); update/upsert.update só bloqueia se o payload declarar
 * um tenantId diferente do contexto (ataque explícito de mover row
 * cross-tenant). Ausente = OK, porque a WHERE injection já garante que
 * a row alvo pertence ao tenant corrente.
 */

const CTX = 'tenant-abc';

describe('assertTenantWritePayload — create', () => {
  it('sem tenantId no payload → erro', () => {
    const err = assertTenantWritePayload('Opportunity', 'create', CTX, {
      title: 'x',
    });
    expect(err).toMatch(/sem tenantId no payload/);
  });

  it('com tenantId igual ao contexto → OK', () => {
    const err = assertTenantWritePayload('Opportunity', 'create', CTX, {
      tenantId: CTX,
      title: 'x',
    });
    expect(err).toBeNull();
  });

  it('com tenantId diferente do contexto → erro (defesa cross-tenant)', () => {
    const err = assertTenantWritePayload('Opportunity', 'create', CTX, {
      tenantId: 'tenant-outro',
      title: 'x',
    });
    expect(err).toMatch(/difere do contexto/);
  });

  it('payload undefined → OK (nada a checar)', () => {
    const err = assertTenantWritePayload('Opportunity', 'create', CTX, undefined);
    expect(err).toBeNull();
  });
});

describe('assertTenantWritePayload — update', () => {
  it('sem tenantId no payload → OK (WHERE injection protege)', () => {
    const err = assertTenantWritePayload('Opportunity', 'update', CTX, {
      meetingScheduledAt: new Date(),
      meetingHappened: true,
      updatedBy: 'user-1',
    });
    expect(err).toBeNull();
  });

  it('com tenantId igual ao contexto → OK', () => {
    const err = assertTenantWritePayload('Opportunity', 'update', CTX, {
      tenantId: CTX,
      updatedBy: 'user-1',
    });
    expect(err).toBeNull();
  });

  it('com tenantId diferente do contexto → erro (defesa cross-tenant)', () => {
    const err = assertTenantWritePayload('Opportunity', 'update', CTX, {
      tenantId: 'tenant-outro',
      updatedBy: 'user-1',
    });
    expect(err).toMatch(/difere do contexto/);
  });

  it('payload vazio → OK', () => {
    const err = assertTenantWritePayload('Opportunity', 'update', CTX, {});
    expect(err).toBeNull();
  });

  it('regressão P-42: update com data típico de opportunities.update', () => {
    // Reproduz exatamente o payload que a procedure `opportunities.update`
    // monta em src/server/trpc/routers/opportunities.ts:204 quando o Fred
    // salva "Salvar alterações" no estágio Lead. Antes do fix, throw.
    const err = assertTenantWritePayload('Opportunity', 'update', CTX, {
      meetingScheduledAt: new Date('2026-07-10T10:00:00Z'),
      meetingHappened: false,
      updatedBy: 'user-fred',
    });
    expect(err).toBeNull();
  });
});

describe('assertTenantWritePayload — modelos afetados por P-42', () => {
  const modelsAffected = [
    'Company',
    'Contact',
    'Product',
    'Proposal',
    'Approval',
    'PartnerEngagement',
    'InboundLeadRejected',
    'Opportunity',
  ];

  it.each(modelsAffected)(
    '%s.update sem tenantId no data passa (regressão P-42)',
    (model) => {
      const err = assertTenantWritePayload(model, 'update', CTX, {
        updatedBy: 'user-x',
        someField: 'value',
      });
      expect(err).toBeNull();
    },
  );
});

describe('assertTenantWritePayload — createMany (P-45)', () => {
  it('array com 3 rows todas com tenantId correto → OK', () => {
    const err = assertTenantWritePayload('Activity', 'createMany', CTX, [
      { tenantId: CTX, kind: 'CALL' },
      { tenantId: CTX, kind: 'EMAIL' },
      { tenantId: CTX, kind: 'MEETING' },
    ]);
    expect(err).toBeNull();
  });

  it('array com 1 row sem tenantId → erro identificando índice', () => {
    const err = assertTenantWritePayload('Activity', 'createMany', CTX, [
      { tenantId: CTX, kind: 'CALL' },
      { kind: 'EMAIL' },
      { tenantId: CTX, kind: 'MEETING' },
    ]);
    expect(err).toMatch(/row 1 sem tenantId no payload/);
  });

  it('array com 1 row tenantId ≠ contexto → erro identificando índice', () => {
    const err = assertTenantWritePayload('Activity', 'createMany', CTX, [
      { tenantId: CTX, kind: 'CALL' },
      { tenantId: CTX, kind: 'EMAIL' },
      { tenantId: 'tenant-outro', kind: 'MEETING' },
    ]);
    expect(err).toMatch(/row 2 tenantId no payload difere do contexto/);
  });

  it('array vazio → OK (nada a checar)', () => {
    const err = assertTenantWritePayload('Activity', 'createMany', CTX, []);
    expect(err).toBeNull();
  });

  it('payload undefined → OK (Prisma rejeita por outro caminho)', () => {
    const err = assertTenantWritePayload('Activity', 'createMany', CTX, undefined);
    expect(err).toBeNull();
  });

  it('array com row null intercalada → ignora null, valida restantes', () => {
    // Cenário defensivo: null como row nunca deveria chegar aqui, mas o
    // backstop deve ignorar em vez de crashar. Cast através de unknown[].
    const payload = [
      { tenantId: CTX, kind: 'CALL' },
      null,
      { tenantId: CTX, kind: 'EMAIL' },
    ] as unknown as Record<string, unknown>[];
    const err = assertTenantWritePayload('Activity', 'createMany', CTX, payload);
    expect(err).toBeNull();
  });

  it('array como payload de create (op errada) → OK (ignora)', () => {
    // Defensivo: arrays só fazem sentido em createMany; outras ops
    // recebendo array (não deveriam) são ignoradas em vez de crash.
    const err = assertTenantWritePayload('Activity', 'create', CTX, [
      { tenantId: 'tenant-outro', kind: 'CALL' },
    ]);
    expect(err).toBeNull();
  });

  it('createMany com row única (não-array) → semântica de create', () => {
    // Prisma aceita `data` como objeto único em createMany; backstop
    // aplica a mesma regra de create (exige tenantId).
    const errMissing = assertTenantWritePayload('Activity', 'createMany', CTX, {
      kind: 'CALL',
    });
    expect(errMissing).toMatch(/sem tenantId no payload/);

    const errOk = assertTenantWritePayload('Activity', 'createMany', CTX, {
      tenantId: CTX,
      kind: 'CALL',
    });
    expect(errOk).toBeNull();
  });
});
