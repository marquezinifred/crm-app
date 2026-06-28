import type { ThemeConfig } from '@/lib/theme/types';

/**
 * Validador WCAG AA combinatorial — Sprint 10.5 (refinamento #1, #3).
 *
 * Funcionalidades:
 *   - computeContrast(hexA, hexB) → ratio (1 a 21)
 *   - validateThemeCombinations(theme) → { passed, failures[] }
 *   - TEXT_CONTEXTS: mapping declarativo de elementos UI Venzo → ratio
 *     mínimo (texto normal 4.5:1, texto grande 3:1, ícones 3:1)
 *
 * As combinações verificadas correspondem aos pontos onde a cor
 * primária e accent aparecem na UI (botões, badges, valores monetários,
 * hover, gradientes).
 */

// Textos fixos do design system Venzo
const TEXT_PRIMARY = '#111827';
const SURFACE_WHITE = '#FFFFFF';

// ---------- Conversão e contraste ----------

interface RGB {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb: RGB): number {
  return (
    0.2126 * srgbToLinear(rgb.r) +
    0.7152 * srgbToLinear(rgb.g) +
    0.0722 * srgbToLinear(rgb.b)
  );
}

/** Retorna ratio entre 1.0 (sem contraste) e 21.0 (preto vs branco). */
export function computeContrast(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return 0;
  const lA = relativeLuminance(a);
  const lB = relativeLuminance(b);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  const raw = (lighter + 0.05) / (darker + 0.05);
  return Math.round(raw * 100) / 100;
}

// ---------- Contextos de texto (refinamento #3 — texto grande) ----------

export interface TextContext {
  name: string;
  /** Ratio mínimo WCAG: 4.5 (normal) ou 3 (grande/ícone) */
  minRatio: number;
  reason: string;
}

export const TEXT_CONTEXTS: Record<string, TextContext> = {
  'page-title': { name: 'page-title', minRatio: 3, reason: 'H1 32px bold' },
  'section-heading': { name: 'section-heading', minRatio: 3, reason: 'H2 24px bold' },
  body: { name: 'body', minRatio: 4.5, reason: 'Body 14px regular' },
  'body-large': { name: 'body-large', minRatio: 4.5, reason: 'Body large 16px regular' },
  'button-primary': { name: 'button-primary', minRatio: 4.5, reason: 'Button 14px semi-bold' },
  badge: { name: 'badge', minRatio: 4.5, reason: 'Badge 11px semi-bold' },
  'value-monetary': { name: 'value-monetary', minRatio: 3, reason: 'H2 24px bold (gold)' },
  'icon-functional': { name: 'icon-functional', minRatio: 3, reason: 'UI icon (WCAG 1.4.11)' },
  'hover-state': { name: 'hover-state', minRatio: 3, reason: 'Hover/gradient transition' },
};

// ---------- Validação combinatorial ----------

export interface ContrastCheck {
  combination: string;
  foreground: string;
  background: string;
  actualRatio: number;
  requiredRatio: number;
  context: string;
  passed: boolean;
}

export interface ValidationResult {
  passed: boolean;
  failures: ContrastCheck[];
  checks: ContrastCheck[];
}

/**
 * Lista de combinações sempre verificadas. Cobre cada lugar onde
 * primary/accent aparecem na UI Venzo. Refinamento #1 do
 * Sprint_10_5_WCAG_Refinements.md.
 */
function buildChecks(theme: ThemeConfig): ContrastCheck[] {
  const c = (
    fg: string,
    bg: string,
    label: string,
    ctxKey: keyof typeof TEXT_CONTEXTS,
  ): ContrastCheck => {
    const ctx = TEXT_CONTEXTS[ctxKey]!;
    const actualRatio = computeContrast(fg, bg);
    return {
      combination: label,
      foreground: fg,
      background: bg,
      actualRatio,
      requiredRatio: ctx.minRatio,
      context: ctx.reason,
      passed: actualRatio >= ctx.minRatio,
    };
  };

  return [
    // Botões primários: texto branco sobre cor primária
    c(SURFACE_WHITE, theme.primaryColor, 'Texto branco em botão primário', 'button-primary'),
    // Cor primária como texto (link, destaque) sobre fundo branco
    c(theme.primaryColor, SURFACE_WHITE, 'Cor primária como texto (link/destaque)', 'body'),
    // Accent sobre escuro: padrão Venzo é dourado SOBRE fundo escuro
    // (brand guide: "Nunca usar Dourado como cor de fundo — apenas como
    // texto ou ícone sobre fundo escuro"). Validamos accent como texto
    // sobre o primary-dark, que é o caso real de valor monetário em CTA.
    c(theme.accentColor, theme.primaryDark, 'Accent (dourado) sobre fundo escuro', 'value-monetary'),
    // Badge de estágio (real): texto escuro sobre fundo claro (primary-light)
    c(TEXT_PRIMARY, theme.primaryLight, 'Badge: texto escuro em fundo light', 'badge'),
    // Ícones funcionais cor primária sobre branco
    c(theme.primaryColor, SURFACE_WHITE, 'Ícone funcional cor primária', 'icon-functional'),
  ];
}

export function validateThemeCombinations(theme: ThemeConfig): ValidationResult {
  const checks = buildChecks(theme);
  const failures = checks.filter((c) => !c.passed);
  return {
    passed: failures.length === 0,
    failures,
    checks,
  };
}
