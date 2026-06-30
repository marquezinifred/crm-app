/**
 * Utilitários de cor — Sprint 14.
 *
 * Converte hex → canais HSL separados (`{ h, s, l }`) para que o tenant
 * theming continue funcionando após a migração para tokens HSL com alpha.
 */

export interface HslChannels {
  h: number; // 0..360
  s: number; // 0..100
  l: number; // 0..100
}

export function hexToHsl(hex: string): HslChannels {
  const m = /^#?([a-f0-9]{6})$/i.exec(hex.trim());
  if (!m) return { h: 262, s: 84, l: 58 }; // fallback Venzo

  const raw = m[1] as string;
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function hslToCssTokens(prefix: string, hex: string): Record<string, string> {
  const { h, s, l } = hexToHsl(hex);
  return {
    [`--${prefix}-h`]: String(h),
    [`--${prefix}-s`]: `${s}%`,
    [`--${prefix}-l`]: `${l}%`,
  };
}
