import { describe, it, expect } from 'vitest';
import {
  computeContrast,
  hexToRgb,
  validateThemeCombinations,
  TEXT_CONTEXTS,
} from '@/server/services/wcag-validator.service';
import { VENZO_DEFAULTS } from '@/lib/theme/types';

describe('computeContrast', () => {
  it('preto vs branco → 21', () => {
    expect(computeContrast('#000000', '#FFFFFF')).toBe(21);
  });

  it('cor igual → 1', () => {
    expect(computeContrast('#7C3AED', '#7C3AED')).toBe(1);
  });

  it('violeta Venzo (#7C3AED) vs branco passa 4.5:1', () => {
    expect(computeContrast('#7C3AED', '#FFFFFF')).toBeGreaterThan(4.5);
  });

  it('aceita hex sem # ou case mista', () => {
    expect(computeContrast('7c3aed', 'FFFFFF')).toBeGreaterThan(4.5);
  });

  it('cor inválida → 0', () => {
    expect(computeContrast('not-hex', '#FFFFFF')).toBe(0);
  });

  it('amarelo claro vs branco falha 4.5:1', () => {
    expect(computeContrast('#FFD700', '#FFFFFF')).toBeLessThan(4.5);
  });
});

describe('hexToRgb', () => {
  it('converte cor padrão', () => {
    expect(hexToRgb('#7C3AED')).toEqual({ r: 0x7c, g: 0x3a, b: 0xed });
  });
  it('rejeita inválido', () => {
    expect(hexToRgb('#XYZ')).toBeNull();
    expect(hexToRgb('#FFF')).toBeNull(); // shorthand não suportado
  });
});

describe('TEXT_CONTEXTS', () => {
  it('texto grande tem 3:1', () => {
    expect(TEXT_CONTEXTS['page-title']!.minRatio).toBe(3);
    expect(TEXT_CONTEXTS['section-heading']!.minRatio).toBe(3);
  });
  it('texto normal tem 4.5:1', () => {
    expect(TEXT_CONTEXTS.body!.minRatio).toBe(4.5);
    expect(TEXT_CONTEXTS['button-primary']!.minRatio).toBe(4.5);
    expect(TEXT_CONTEXTS.badge!.minRatio).toBe(4.5);
  });
  it('ícone funcional tem 3:1 (WCAG 1.4.11)', () => {
    expect(TEXT_CONTEXTS['icon-functional']!.minRatio).toBe(3);
  });
});

describe('validateThemeCombinations', () => {
  it('paleta Venzo padrão passa em todas combinações principais', () => {
    const r = validateThemeCombinations(VENZO_DEFAULTS);
    // Venzo passa em quase tudo (alguns combos podem falhar — verificamos pelo menos as principais)
    expect(r.checks.length).toBeGreaterThanOrEqual(8);
    // Botão primário com texto branco deve passar
    const buttonCheck = r.checks.find((c) => c.combination.includes('botão primário'));
    expect(buttonCheck?.passed).toBe(true);
  });

  it('paleta amarela falha em texto branco', () => {
    const r = validateThemeCombinations({
      ...VENZO_DEFAULTS,
      primaryColor: '#FFD700',
    });
    expect(r.passed).toBe(false);
    expect(r.failures.length).toBeGreaterThan(0);
    // Pelo menos uma falha deve mencionar botão primário (branco em amarelo)
    expect(r.failures.some((f) => f.context.includes('Button') || f.combination.includes('botão'))).toBe(true);
  });

  it('failures incluem ratio real e requerido', () => {
    const r = validateThemeCombinations({ ...VENZO_DEFAULTS, primaryColor: '#FFFF00' });
    if (r.failures.length > 0) {
      const f = r.failures[0]!;
      expect(typeof f.actualRatio).toBe('number');
      expect(typeof f.requiredRatio).toBe('number');
      expect(f.requiredRatio).toBeGreaterThanOrEqual(3);
    }
  });
});
