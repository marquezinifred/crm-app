import { headers } from 'next/headers';
import { getThemeConfig } from '@/server/services/theme.service';
import { VENZO_DEFAULTS } from './types';
import type { ResolvedTheme } from '@/server/services/theme.service';
import { PoweredByMode } from '@prisma/client';

/**
 * Lê o tenantId do header injetado pelo middleware Next e resolve o
 * tema persistido (cache Redis 1h). Usado pelo RootLayout (Server
 * Component) para injetar CSS vars antes do primeiro render.
 *
 * Fallback gracioso: sem tenant resolvido (sign-in, landing, etc),
 * retorna defaults Venzo.
 */
export async function resolveTenantTheme(): Promise<ResolvedTheme> {
  const h = headers();
  const tenantId = h.get('x-tenant-id');
  if (!tenantId) {
    return {
      themeConfig: VENZO_DEFAULTS,
      poweredBy: PoweredByMode.VISIBLE,
      themingEnabled: false,
      plan: 'STARTER',
      hasActiveOverrides: false,
    };
  }
  try {
    return await getThemeConfig(tenantId);
  } catch (err) {
    console.error('[theme.server] resolveTenantTheme falhou', err);
    return {
      themeConfig: VENZO_DEFAULTS,
      poweredBy: PoweredByMode.VISIBLE,
      themingEnabled: false,
      plan: 'STARTER',
      hasActiveOverrides: false,
    };
  }
}

/** Constrói o style="..." com CSS vars --brand-* a partir do theme. */
export function buildBrandStyle(themeConfig: ResolvedTheme['themeConfig']): string {
  const safe = (hex: string) => (/^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : '#7C3AED');
  return [
    `--brand-primary: ${safe(themeConfig.primaryColor)}`,
    `--brand-primary-dark: ${safe(themeConfig.primaryDark)}`,
    `--brand-primary-light: ${safe(themeConfig.primaryLight)}`,
    `--brand-accent: ${safe(themeConfig.accentColor)}`,
    `--brand-font: '${themeConfig.fontFamily.replace(/'/g, '')}', 'Plus Jakarta Sans', system-ui, sans-serif`,
  ].join('; ');
}
