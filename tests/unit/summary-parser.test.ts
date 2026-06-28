import { describe, it, expect } from 'vitest';
import { __test } from '@/server/services/communication-summary.service';

const { parseSummaryJson } = __test;

describe('parseSummaryJson', () => {
  it('parseia JSON limpo', () => {
    const raw = JSON.stringify({
      themes: ['integração', 'prazo'],
      adjustments: ['migrar de v1 para v2'],
      decisions: ['cliente aprovou MVP'],
      nextSteps: [
        { title: 'Enviar proposta', dueDate: '2026-07-10', assigneeHint: 'Fred' },
      ],
    });
    const r = parseSummaryJson(raw);
    expect(r.themes).toEqual(['integração', 'prazo']);
    expect(r.nextSteps[0]!.title).toBe('Enviar proposta');
    expect(r.nextSteps[0]!.dueDate).toBe('2026-07-10');
  });

  it('extrai JSON de bloco markdown', () => {
    const raw = '```json\n{"themes":["a"],"adjustments":[],"decisions":[],"nextSteps":[]}\n```';
    const r = parseSummaryJson(raw);
    expect(r.themes).toEqual(['a']);
  });

  it('tolera JSON inválido — cai em fallback', () => {
    const r = parseSummaryJson('isso não é JSON');
    expect(r.themes.length).toBe(1);
    expect(r.themes[0]).toContain('isso não é JSON');
    expect(r.adjustments).toEqual([]);
    expect(r.nextSteps).toEqual([]);
  });

  it('filtra próximos passos sem título', () => {
    const raw = JSON.stringify({
      themes: [],
      adjustments: [],
      decisions: [],
      nextSteps: [
        { title: '', dueDate: null, assigneeHint: null },
        { title: 'Válida', dueDate: null, assigneeHint: null },
      ],
    });
    const r = parseSummaryJson(raw);
    expect(r.nextSteps).toHaveLength(1);
    expect(r.nextSteps[0]!.title).toBe('Válida');
  });
});
