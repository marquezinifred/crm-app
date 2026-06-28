import { describe, it, expect } from 'vitest';
import {
  validateStageExit,
  isValidTransition,
  STAGE_ORDER,
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
