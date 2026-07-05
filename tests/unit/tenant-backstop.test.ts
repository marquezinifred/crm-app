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
