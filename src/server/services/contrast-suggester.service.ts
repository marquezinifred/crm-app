import { computeContrast, hexToRgb } from './wcag-validator.service';

/**
 * Sugestão dupla de cor — Sprint_10_5_WCAG_Refinements.md regra #2.
 *
 * Recebe uma cor base que falhou contraste e retorna duas opções:
 *   - darker: versão com L reduzido até passar 4.5:1 contra branco
 *   - lighter: versão com L aumentado até passar 4.5:1 contra preto
 *
 * Algoritmo: HEX → HSL → iterar L em passos de 5% (max 8 passos por
 * direção). Se nenhuma direção passa, retorna null no campo correspondente.
 *
 * Quando ambos os campos forem null, a UI deve sugerir trocar de cor.
 */

const TEXT_PRIMARY = '#111827';
const SURFACE_WHITE = '#FFFFFF';

// ---------- HSL conversion ----------

interface HSL {
  h: number; // 0-360
  s: number; // 0-1
  l: number; // 0-1
}

function rgbToHsl(r: number, g: number, b: number): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0));
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

function hslToRgb({ h, s, l }: HSL): { r: number; g: number; b: number } {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hh = h / 360;
  const r = hue2rgb(p, q, hh + 1 / 3);
  const g = hue2rgb(p, q, hh);
  const b = hue2rgb(p, q, hh - 1 / 3);
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  return `#${h(r)}${h(g)}${h(b)}`;
}

// ---------- Sugestão ----------

export interface ContrastSuggestions {
  darker: string | null;
  lighter: string | null;
  /** Quando ambos null, a cor é incompatível com WCAG AA. */
  unsupported: boolean;
}

const MAX_STEPS = 8;
const STEP = 0.05;

function iterateLuminance(
  base: HSL,
  direction: 'down' | 'up',
  target: string,
  minRatio: number,
): string | null {
  for (let i = 1; i <= MAX_STEPS; i++) {
    const delta = STEP * i * (direction === 'down' ? -1 : 1);
    const newL = Math.max(0, Math.min(1, base.l + delta));
    if (newL === base.l) return null;
    const rgb = hslToRgb({ ...base, l: newL });
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    const ratio = computeContrast(hex, target);
    if (ratio >= minRatio) return hex;
  }
  return null;
}

export function suggestContrastFix(
  baseHex: string,
  minRatio = 4.5,
): ContrastSuggestions {
  const rgb = hexToRgb(baseHex);
  if (!rgb) return { darker: null, lighter: null, unsupported: true };
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

  const darker = iterateLuminance(hsl, 'down', SURFACE_WHITE, minRatio);
  const lighter = iterateLuminance(hsl, 'up', TEXT_PRIMARY, minRatio);

  return {
    darker,
    lighter,
    unsupported: darker == null && lighter == null,
  };
}
