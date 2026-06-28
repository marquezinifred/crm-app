import { describe, it, expect } from 'vitest';
import {
  toVenzoPlan,
  defaultPoweredByForPlan,
  canHidePoweredBy,
  canCustomizeTheme,
  canUseFreeformHex,
  canOverrideWcag,
} from '@/lib/theme/types';
import { isCuratedPalette, CURATED_PALETTES } from '@/lib/theme/curated-palettes';
import { isCuratedFont, CURATED_FONTS } from '@/lib/theme/curated-fonts';

describe('toVenzoPlan', () => {
  it('mapeia ENTERPRISE → ENTERPRISE', () => {
    expect(toVenzoPlan('ENTERPRISE')).toBe('ENTERPRISE');
  });
  it('mapeia PRO → GROWTH', () => {
    expect(toVenzoPlan('PRO')).toBe('GROWTH');
  });
  it('STARTER e TRIAL → STARTER', () => {
    expect(toVenzoPlan('STARTER')).toBe('STARTER');
    expect(toVenzoPlan('TRIAL')).toBe('STARTER');
  });
});

describe('plan matrix — powered by', () => {
  it('Starter default VISIBLE', () => {
    expect(defaultPoweredByForPlan('STARTER')).toBe('VISIBLE');
  });
  it('Growth default SUBTLE', () => {
    expect(defaultPoweredByForPlan('GROWTH')).toBe('SUBTLE');
  });
  it('Enterprise default HIDDEN', () => {
    expect(defaultPoweredByForPlan('ENTERPRISE')).toBe('HIDDEN');
  });

  it('apenas Enterprise pode esconder badge', () => {
    expect(canHidePoweredBy('STARTER')).toBe(false);
    expect(canHidePoweredBy('GROWTH')).toBe(false);
    expect(canHidePoweredBy('ENTERPRISE')).toBe(true);
  });
});

describe('plan matrix — customização', () => {
  it('Starter não customiza', () => {
    expect(canCustomizeTheme('STARTER')).toBe(false);
  });
  it('Growth e Enterprise customizam', () => {
    expect(canCustomizeTheme('GROWTH')).toBe(true);
    expect(canCustomizeTheme('ENTERPRISE')).toBe(true);
  });

  it('apenas Enterprise usa hex livre', () => {
    expect(canUseFreeformHex('GROWTH')).toBe(false);
    expect(canUseFreeformHex('ENTERPRISE')).toBe(true);
  });

  it('apenas Enterprise override WCAG', () => {
    expect(canOverrideWcag('GROWTH')).toBe(false);
    expect(canOverrideWcag('ENTERPRISE')).toBe(true);
  });
});

describe('curated palettes (Growth)', () => {
  it('lista contém pelo menos 8 paletas', () => {
    expect(CURATED_PALETTES.length).toBeGreaterThanOrEqual(8);
  });

  it('primeira paleta é Venzo default', () => {
    expect(CURATED_PALETTES[0]!.id).toBe('venzo-default');
    expect(CURATED_PALETTES[0]!.config.primaryColor).toBe('#7C3AED');
  });

  it('isCuratedPalette reconhece Venzo default', () => {
    expect(
      isCuratedPalette({
        primaryColor: '#7C3AED',
        primaryDark: '#3B1F6A',
        primaryLight: '#C084FC',
        accentColor: '#F5A623',
      }),
    ).toBe(true);
  });

  it('isCuratedPalette rejeita paleta freeform', () => {
    expect(
      isCuratedPalette({
        primaryColor: '#FF00FF',
        primaryDark: '#000000',
        primaryLight: '#FFFFFF',
        accentColor: '#00FF00',
      }),
    ).toBe(false);
  });
});

describe('curated fonts (Growth)', () => {
  it('lista contém pelo menos 6 fontes', () => {
    expect(CURATED_FONTS.length).toBeGreaterThanOrEqual(6);
  });

  it('Plus Jakarta Sans é a primeira', () => {
    expect(CURATED_FONTS[0]!.family).toBe('Plus Jakarta Sans');
  });

  it('isCuratedFont reconhece Inter, Manrope', () => {
    expect(isCuratedFont('Inter')).toBe(true);
    expect(isCuratedFont('Manrope')).toBe(true);
    expect(isCuratedFont('Comic Sans MS')).toBe(false);
  });
});
