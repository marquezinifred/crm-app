import { Redis } from 'ioredis';
import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { audit } from './audit.service';
import {
  type ThemeConfig,
  themeConfigSchema,
  VENZO_DEFAULTS,
  toVenzoPlan,
  defaultPoweredByForPlan,
  canCustomizeTheme,
  canUseFreeformHex,
  canHidePoweredBy,
  canOverrideWcag,
  type VenzoPlan,
} from '@/lib/theme/types';
import { isCuratedPalette } from '@/lib/theme/curated-palettes';
import { isCuratedFont } from '@/lib/theme/curated-fonts';
import {
  validateThemeCombinations,
  type ValidationResult,
} from './wcag-validator.service';
import { flagEnabled } from '@/lib/feature-flags';
import { env } from '@/lib/env';
import { Prisma, PoweredByMode } from '@prisma/client';

const CACHE_TTL_SECONDS = 60 * 60;

let _redis: Redis | null = null;
function redis(): Redis | null {
  if (_redis) return _redis;
  try {
    _redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    _redis.on('error', (err) => console.warn('[theme cache] redis err:', err.message));
    return _redis;
  } catch {
    return null;
  }
}

function cacheKey(tenantId: string): string {
  return `theme:${tenantId}`;
}

export interface ResolvedTheme {
  themeConfig: ThemeConfig;
  poweredBy: PoweredByMode;
  themingEnabled: boolean;
  plan: VenzoPlan;
  /** Quando true, tenant tem overrides WCAG aprovados em produção. */
  hasActiveOverrides: boolean;
}

export async function getThemeConfig(tenantId: string): Promise<ResolvedTheme> {
  const r = redis();
  if (r) {
    try {
      await r.connect().catch(() => undefined);
      const cached = await r.get(cacheKey(tenantId));
      if (cached) return JSON.parse(cached) as ResolvedTheme;
    } catch {
      /* cache miss → segue para o banco */
    }
  }

  const result = await runAsSystem(async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true, settings: true },
    });
    if (!tenant) return null;
    const plan = toVenzoPlan(tenant.plan);
    const settings = tenant.settings;
    const themeConfig: ThemeConfig =
      (settings?.themeConfig as ThemeConfig | null) ?? VENZO_DEFAULTS;
    const poweredBy = settings?.poweredBy ?? PoweredByMode.VISIBLE;
    const overrides = Array.isArray(settings?.wcagOverrides)
      ? (settings!.wcagOverrides as unknown[])
      : [];
    return {
      themeConfig,
      poweredBy,
      themingEnabled: settings?.themingEnabled ?? true,
      plan,
      hasActiveOverrides: overrides.length > 0,
    };
  });

  if (!result) {
    return {
      themeConfig: VENZO_DEFAULTS,
      poweredBy: PoweredByMode.VISIBLE,
      themingEnabled: false,
      plan: 'STARTER',
      hasActiveOverrides: false,
    };
  }

  if (r) {
    try {
      await r.setex(cacheKey(tenantId), CACHE_TTL_SECONDS, JSON.stringify(result));
    } catch {
      /* ignore */
    }
  }
  return result;
}

export async function invalidateThemeCache(tenantId: string): Promise<void> {
  const r = redis();
  if (!r) return;
  try {
    await r.del(cacheKey(tenantId));
  } catch {
    /* ignore */
  }
}

// ---------- Update ----------

export interface UpdateThemeInput {
  tenantId: string;
  actorUserId: string;
  themeConfig: ThemeConfig;
  poweredBy?: PoweredByMode;
  /** Apenas Enterprise + falhas: publica mesmo com WCAG falhando. */
  overrideJustification?: string;
  overrideDpoApproval?: boolean;
  ip?: string | null;
  userAgent?: string | null;
}

export class ThemeUpdateError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'PLAN_FORBIDDEN'
      | 'FEATURE_DISABLED'
      | 'INVALID_INPUT'
      | 'CURATED_REQUIRED'
      | 'FONT_NOT_CURATED'
      | 'WCAG_FAILED'
      | 'OVERRIDE_NOT_ALLOWED'
      | 'OVERRIDE_INCOMPLETE',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ThemeUpdateError';
  }
}

export interface UpdateThemeResult {
  themeConfig: ThemeConfig;
  poweredBy: PoweredByMode;
  validation: ValidationResult;
  overrideApplied: boolean;
}

export async function updateThemeConfig(input: UpdateThemeInput): Promise<UpdateThemeResult> {
  const enabled = await flagEnabled('tenant_theming_enabled', { tenantId: input.tenantId });
  if (!enabled) throw new ThemeUpdateError('Theming desabilitado', 'FEATURE_DISABLED');

  const parsed = themeConfigSchema.safeParse(input.themeConfig);
  if (!parsed.success) {
    throw new ThemeUpdateError('Theme inválido', 'INVALID_INPUT', parsed.error.flatten());
  }
  const theme = parsed.data;

  return runAsSystem(async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { plan: true, settings: true, name: true },
    });
    if (!tenant) throw new ThemeUpdateError('Tenant não encontrado', 'INVALID_INPUT');

    const plan = toVenzoPlan(tenant.plan);

    if (!canCustomizeTheme(plan)) {
      throw new ThemeUpdateError(
        'Plano Starter não permite customização de tema. Faça upgrade para Growth ou Enterprise.',
        'PLAN_FORBIDDEN',
      );
    }

    // Growth: paleta e fonte devem ser curadas
    if (!canUseFreeformHex(plan)) {
      const paletteOK = isCuratedPalette({
        primaryColor: theme.primaryColor,
        primaryDark: theme.primaryDark,
        primaryLight: theme.primaryLight,
        accentColor: theme.accentColor,
      });
      if (!paletteOK) {
        throw new ThemeUpdateError(
          'Plano Growth exige paleta da lista curada. Faça upgrade para Enterprise para hex livre.',
          'CURATED_REQUIRED',
        );
      }
      if (!isCuratedFont(theme.fontFamily)) {
        throw new ThemeUpdateError(
          'Plano Growth exige fonte da lista curada.',
          'FONT_NOT_CURATED',
        );
      }
    }

    // poweredBy enforcement (refinamento spec)
    const resolvedPoweredBy = input.poweredBy ?? tenant.settings?.poweredBy ?? defaultPoweredByForPlan(plan);
    if (resolvedPoweredBy === PoweredByMode.HIDDEN && !canHidePoweredBy(plan)) {
      throw new ThemeUpdateError(
        'Apenas planos Enterprise podem esconder o badge "Powered by Venzo".',
        'PLAN_FORBIDDEN',
      );
    }

    // Validação WCAG combinatorial
    const validation = validateThemeCombinations(theme);

    let overrideApplied = false;
    if (!validation.passed) {
      if (!canOverrideWcag(plan)) {
        throw new ThemeUpdateError(
          `Falhou WCAG AA em ${validation.failures.length} combinação(ões). Apenas Enterprise pode publicar com override.`,
          'WCAG_FAILED',
          { failures: validation.failures },
        );
      }
      // Enterprise pode override, mas exige aceite formal
      if (!input.overrideJustification || input.overrideJustification.length < 30 || !input.overrideDpoApproval) {
        throw new ThemeUpdateError(
          'Override WCAG exige checkbox DPO + justificativa ≥ 30 caracteres.',
          'OVERRIDE_INCOMPLETE',
          { failures: validation.failures },
        );
      }
      overrideApplied = true;
    }

    // Persist + atualizar wcag_overrides se aplicável
    const overrideEntry = overrideApplied
      ? {
          appliedAt: new Date().toISOString(),
          actorUserId: input.actorUserId,
          justification: input.overrideJustification,
          failedCombinations: validation.failures.map((f) => f.combination),
          wcagLevel: 'AA com override',
        }
      : null;

    const before = tenant.settings;
    const updated = await prisma.tenantSettings.upsert({
      where: { tenantId: input.tenantId },
      update: {
        themeConfig: theme as unknown as Prisma.InputJsonValue,
        poweredBy: resolvedPoweredBy,
        updatedBy: input.actorUserId,
        ...(overrideEntry
          ? {
              wcagOverrides: [
                ...((before?.wcagOverrides as unknown[]) ?? []),
                overrideEntry,
              ] as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
      create: {
        tenantId: input.tenantId,
        themeConfig: theme as unknown as Prisma.InputJsonValue,
        poweredBy: resolvedPoweredBy,
        wcagOverrides: (overrideEntry ? [overrideEntry] : []) as unknown as Prisma.InputJsonValue,
        updatedBy: input.actorUserId,
      },
    });

    await invalidateThemeCache(input.tenantId);

    await audit({
      action: 'theme.update',
      tableName: 'tenant_settings',
      recordId: input.tenantId,
      tenantIdOverride: input.tenantId,
      before: before
        ? {
            themeConfig: before.themeConfig,
            poweredBy: before.poweredBy,
          }
        : null,
      after: {
        themeConfig: updated.themeConfig,
        poweredBy: updated.poweredBy,
        validation: {
          passed: validation.passed,
          failureCount: validation.failures.length,
          wcagLevel: overrideApplied ? 'AA com override' : 'AA',
        },
        overrideJustification: overrideEntry?.justification ?? null,
      },
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return {
      themeConfig: theme,
      poweredBy: resolvedPoweredBy,
      validation,
      overrideApplied,
    };
  });
}
