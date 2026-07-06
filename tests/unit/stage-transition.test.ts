import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateStageExit,
  isValidTransition,
  STAGE_ORDER,
  validateProposalExit,
  StageTransitionError,
} from '@/server/services/opportunity-stage.service';

describe('stage transition rules', () => {
  it('PROSPECT exige source para sair', () => {
    expect(validateStageExit({ source: null }, 'PROSPECT').ok).toBe(false);
    expect(validateStageExit({ source: 'INDICACAO' }, 'PROSPECT').ok).toBe(true);
  });

  it('LEAD exige meetingScheduledAt', () => {
    const r = validateStageExit({ meetingScheduledAt: null }, 'LEAD');
    expect(r.ok).toBe(false);
    expect(r.missingFields).toContain('meetingScheduledAt');
  });

  it('OPORTUNIDADE exige briefing + valor + data prevista', () => {
    const r = validateStageExit(
      { briefing: '', estimatedValue: null, expectedCloseDate: null },
      'OPORTUNIDADE',
    );
    expect(r.ok).toBe(false);
    expect(r.missingFields.sort()).toEqual(['briefing', 'estimatedValue', 'expectedCloseDate'].sort());
  });

  it('PROPOSTA exige datas de apresentação e decisão', () => {
    const r = validateStageExit(
      { proposalPresentedAt: null, decisionExpectedAt: null },
      'PROPOSTA',
    );
    expect(r.ok).toBe(false);
    expect(r.missingFields).toHaveLength(2);
  });

  it('CONTRATO é estágio final sem requisitos de saída', () => {
    expect(validateStageExit({}, 'CONTRATO').ok).toBe(true);
  });
});

describe('transitions', () => {
  it('permite avançar 1 estágio', () => {
    expect(isValidTransition('PROSPECT', 'LEAD').ok).toBe(true);
    expect(isValidTransition('NEGOCIACAO', 'ACEITE').ok).toBe(true);
  });

  it('permite retroceder qualquer quantidade', () => {
    expect(isValidTransition('NEGOCIACAO', 'PROSPECT').ok).toBe(true);
    expect(isValidTransition('CONTRATO', 'LEAD').ok).toBe(true);
  });

  it('proíbe pular múltiplos estágios para frente', () => {
    expect(isValidTransition('PROSPECT', 'CONTRATO').ok).toBe(false);
    expect(isValidTransition('LEAD', 'PROPOSTA').ok).toBe(false);
  });

  it('proíbe transição para o mesmo estágio', () => {
    expect(isValidTransition('LEAD', 'LEAD').ok).toBe(false);
  });

  it('STAGE_ORDER cobre os 7 estágios na ordem certa', () => {
    expect(STAGE_ORDER).toEqual([
      'PROSPECT', 'LEAD', 'OPORTUNIDADE', 'PROPOSTA', 'NEGOCIACAO', 'ACEITE', 'CONTRATO',
    ]);
  });
});

describe('validateProposalExit — P-66 gate PROPOSTA → NEGOCIACAO', () => {
  const OPP_ID = 'opp-1';
  const TENANT_ID = 'tenant-A';

  const findFirst = vi.fn();
  const count = vi.fn();
  const client = {
    proposalVersion: { findFirst },
    document: { count },
  };

  beforeEach(() => {
    findFirst.mockReset();
    count.mockReset();
  });

  it('sem versão de proposta → StageTransitionError MISSING_FIELDS', async () => {
    findFirst.mockResolvedValueOnce(null);
    await expect(validateProposalExit(client, OPP_ID, TENANT_ID)).rejects.toMatchObject({
      name: 'StageTransitionError',
      code: 'MISSING_FIELDS',
      details: { missingFields: ['proposalVersion'] },
    });
    expect(findFirst).toHaveBeenCalledOnce();
    expect(count).not.toHaveBeenCalled();
  });

  it('totalValue null → erro específico de valor', async () => {
    findFirst.mockResolvedValueOnce({ totalValue: null, marginPct: 20 });
    await expect(validateProposalExit(client, OPP_ID, TENANT_ID)).rejects.toMatchObject({
      code: 'MISSING_FIELDS',
      details: { missingFields: ['proposalVersion.totalValue'] },
    });
    expect(count).not.toHaveBeenCalled();
  });

  it('marginPct null → erro específico de margem', async () => {
    findFirst.mockResolvedValueOnce({ totalValue: 50000, marginPct: null });
    await expect(validateProposalExit(client, OPP_ID, TENANT_ID)).rejects.toMatchObject({
      code: 'MISSING_FIELDS',
      details: { missingFields: ['proposalVersion.marginPct'] },
    });
    expect(count).not.toHaveBeenCalled();
  });

  it('valor+margem OK mas sem documento categoria proposta → erro de documento', async () => {
    findFirst.mockResolvedValueOnce({ totalValue: 50000, marginPct: 20 });
    count.mockResolvedValueOnce(0);
    await expect(validateProposalExit(client, OPP_ID, TENANT_ID)).rejects.toMatchObject({
      code: 'MISSING_FIELDS',
      details: { missingFields: ['document:PROPOSTA'] },
    });
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT_ID,
          relatedEntityType: 'opportunity',
          relatedEntityId: OPP_ID,
          deletedAt: null,
          category: { in: ['PROPOSTA_TECNICA', 'PROPOSTA_COMERCIAL'] },
        }),
      }),
    );
  });

  it('tudo preenchido + documento PROPOSTA_TECNICA → passa sem erro', async () => {
    findFirst.mockResolvedValueOnce({ totalValue: 50000, marginPct: 20 });
    count.mockResolvedValueOnce(1);
    await expect(validateProposalExit(client, OPP_ID, TENANT_ID)).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledOnce();
    expect(count).toHaveBeenCalledOnce();
  });

  it('mensagens de erro são claras em PT-BR (Fred verá via friendlyTrpcError)', async () => {
    findFirst.mockResolvedValueOnce(null);
    await expect(validateProposalExit(client, OPP_ID, TENANT_ID)).rejects.toThrow(
      /Crie uma versão de proposta com valor e margem preenchidos/,
    );

    findFirst.mockResolvedValueOnce({ totalValue: null, marginPct: 20 });
    await expect(validateProposalExit(client, OPP_ID, TENANT_ID)).rejects.toThrow(
      /Preencha o valor total/,
    );

    findFirst.mockResolvedValueOnce({ totalValue: 50000, marginPct: null });
    await expect(validateProposalExit(client, OPP_ID, TENANT_ID)).rejects.toThrow(
      /Preencha a margem/,
    );

    findFirst.mockResolvedValueOnce({ totalValue: 50000, marginPct: 20 });
    count.mockResolvedValueOnce(0);
    await expect(validateProposalExit(client, OPP_ID, TENANT_ID)).rejects.toThrow(
      /Anexe o documento da proposta/,
    );
  });

  it('lança StageTransitionError (não Error genérico) — router traduz para PRECONDITION_FAILED', async () => {
    findFirst.mockResolvedValueOnce(null);
    await expect(validateProposalExit(client, OPP_ID, TENANT_ID)).rejects.toBeInstanceOf(
      StageTransitionError,
    );
  });

  it('consulta a última versão via orderBy version desc', async () => {
    findFirst.mockResolvedValueOnce({ totalValue: 50000, marginPct: 20 });
    count.mockResolvedValueOnce(1);
    await validateProposalExit(client, OPP_ID, TENANT_ID);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT_ID,
          proposal: { opportunityId: OPP_ID, deletedAt: null },
          deletedAt: null,
        }),
        orderBy: { version: 'desc' },
        select: { totalValue: true, marginPct: true },
      }),
    );
  });
});
