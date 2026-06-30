import { headers } from 'next/headers';
import { getThemeConfig } from '@/server/services/theme.service';
import { VENZO_DEFAULTS } from './types';
import type { ResolvedTheme } from '@/server/services/theme.service';
import { PoweredByMode } from '@prisma/client';
import { hslToCssTokens } from './color';

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

/**
 * Constrói o objeto CSS com as vars de marca a partir do theme do tenant.
 * Sprint 14 — usa canais HSL separados (--brand-primary-h/-s/-l) para
 * compatibilidade com Tailwind alpha modifiers.
 * Mantém também --brand-primary (hex) como fallback para classes legadas.
 */
export function buildBrandStyle(
  themeConfig: ResolvedTheme['themeConfig'],
): React.CSSProperties {
  const safe = (hex: string) => (/^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : '#7C3AED');
  const fontStack = `'${themeConfig.fontFamily.replace(/'/g, '')}', 'Plus Jakarta Sans', system-ui, sans-serif`;
  return {
    ...hslToCssTokens('brand-primary', safe(themeConfig.primaryColor)),
    ...hslToCssTokens('brand-primary-dark', safe(themeConfig.primaryDark)),
    ...hslToCssTokens('brand-primary-light', safe(themeConfig.primaryLight)),
    ...hslToCssTokens('brand-accent', safe(themeConfig.accentColor)),
    '--font-sans': fontStack,
    '--brand-font': fontStack,
  } as React.CSSProperties;
}
