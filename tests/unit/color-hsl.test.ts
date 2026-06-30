import { describe, it, expect } from 'vitest';
import { hexToHsl, hslToCssTokens } from '@/lib/theme/color';

describe('hexToHsl', () => {
  it('converte branco para HSL 0,0,100', () => {
    expect(hexToHsl('#FFFFFF')).toEqual({ h: 0, s: 0, l: 100 });
  });

  it('converte preto para HSL 0,0,0', () => {
    expect(hexToHsl('#000000')).toEqual({ h: 0, s: 0, l: 0 });
  });

  it('converte violeta Venzo (#7C3AED) aproximadamente para 262/84/58', () => {
    const r = hexToHsl('#7C3AED');
    expect(r.h).toBeGreaterThanOrEqual(261);
    expect(r.h).toBeLessThanOrEqual(264);
    expect(r.s).toBeGreaterThanOrEqual(80);
    expect(r.l).toBeGreaterThanOrEqual(55);
    expect(r.l).toBeLessThanOrEqual(60);
  });

  it('converte vermelho puro para hue 0', () => {
    expect(hexToHsl('#FF0000')).toEqual({ h: 0, s: 100, l: 50 });
  });

  it('fallback Venzo em hex inválido', () => {
    expect(hexToHsl('#XYZ')).toEqual({ h: 262, s: 84, l: 58 });
    expect(hexToHsl('')).toEqual({ h: 262, s: 84, l: 58 });
  });

  it('hslToCssTokens produz 3 vars com sufixo -h/-s/-l', () => {
    const tokens = hslToCssTokens('brand-primary', '#7C3AED');
    expect(Object.keys(tokens)).toEqual([
      '--brand-primary-h',
      '--brand-primary-s',
      '--brand-primary-l',
    ]);
    expect(tokens['--brand-primary-s']).toMatch(/%$/);
    expect(tokens['--brand-primary-l']).toMatch(/%$/);
  });
});
