import { describe, it, expect } from 'vitest';
import { OpportunityStage } from '@prisma/client';
import { STAGE_INTENT_LABEL } from '@/lib/constants/pipeline-stages';

describe('STAGE_INTENT_LABEL', () => {
  it('cobre todos os valores do enum OpportunityStage', () => {
    const enumValues = Object.values(OpportunityStage);
    for (const v of enumValues) {
      expect(STAGE_INTENT_LABEL[v]).toBeTruthy();
      expect(STAGE_INTENT_LABEL[v].length).toBeGreaterThan(3);
    }
  });

  it('não é o mesmo que o nome técnico do enum', () => {
    for (const [key, label] of Object.entries(STAGE_INTENT_LABEL)) {
      expect(label.toUpperCase()).not.toBe(key);
    }
  });

  it('LEAD descreve agendamento de reunião', () => {
    expect(STAGE_INTENT_LABEL.LEAD.toLowerCase()).toContain('reunião');
  });
});
