/**
 * Feature flag stub — Sprint 10.5.
 *
 * Em produção, plugar Unleash (UNLEASH_URL + UNLEASH_API_TOKEN).
 * Em dev/test, retorna o default declarado por flag.
 *
 * Sprint 12 substitui pela integração Unleash real.
 */

const DEFAULTS: Record<string, boolean> = {
  tenant_theming_enabled: true,
};

export interface FlagContext {
  tenantId?: string;
  userId?: string;
}

export async function flagEnabled(
  key: string,
  ctx: FlagContext = {},
): Promise<boolean> {
  void ctx;
  if (!process.env.UNLEASH_URL || !process.env.UNLEASH_API_TOKEN) {
    return DEFAULTS[key] ?? false;
  }
  // TODO Sprint 12: integrar SDK Unleash com ctx (tenantId, userId)
  return DEFAULTS[key] ?? false;
}

export function flagEnabledSync(key: string): boolean {
  return DEFAULTS[key] ?? false;
}
