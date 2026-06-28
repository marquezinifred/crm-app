import { z } from 'zod';

/** Theme config persistido em tenant_settings.theme_config */
export interface ThemeConfig {
  primaryColor: string;
  primaryDark: string;
  primaryLight: string;
  accentColor: string;
  fontFamily: string;
  logoUrl: string | null;
}

export const VENZO_DEFAULTS: ThemeConfig = {
  primaryColor: '#7C3AED',
  primaryDark: '#3B1F6A',
  primaryLight: '#C084FC',
  accentColor: '#F5A623',
  fontFamily: 'Plus Jakarta Sans',
  logoUrl: null,
};

const hex = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Cor deve estar em formato #RRGGBB');

export const themeConfigSchema = z.object({
  primaryColor: hex,
  primaryDark: hex,
  primaryLight: hex,
  accentColor: hex,
  fontFamily: z.string().min(2).max(80),
  logoUrl: z.string().url().nullable(),
});

/** Plano Venzo (alinhado com brand guide). Mapeia TenantPlan interno. */
export type VenzoPlan = 'STARTER' | 'GROWTH' | 'ENTERPRISE';

/** Mapeia TenantPlan (existente) para VenzoPlan do brand guide. */
export function toVenzoPlan(plan: string): VenzoPlan {
  if (plan === 'ENTERPRISE') return 'ENTERPRISE';
  if (plan === 'PRO') return 'GROWTH';
  return 'STARTER'; // TRIAL e STARTER
}

/** Plano determina poweredBy default (server enforce). */
export function defaultPoweredByForPlan(plan: VenzoPlan): 'VISIBLE' | 'SUBTLE' | 'HIDDEN' {
  if (plan === 'ENTERPRISE') return 'HIDDEN';
  if (plan === 'GROWTH') return 'SUBTLE';
  return 'VISIBLE';
}

/** Pode esconder badge? Apenas Enterprise. */
export function canHidePoweredBy(plan: VenzoPlan): boolean {
  return plan === 'ENTERPRISE';
}

/** Pode personalizar tema? Não-Starter. */
export function canCustomizeTheme(plan: VenzoPlan): boolean {
  return plan !== 'STARTER';
}

/** Hex livre? Apenas Enterprise. Growth tem lista curada. */
export function canUseFreeformHex(plan: VenzoPlan): boolean {
  return plan === 'ENTERPRISE';
}

/** Pode override WCAG? Apenas Enterprise. */
export function canOverrideWcag(plan: VenzoPlan): boolean {
  return plan === 'ENTERPRISE';
}
