import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router } from '@/server/trpc/trpc';
import { adminOnlyProcedure } from '@/server/trpc/middlewares';
import {
  getThemeConfig,
  updateThemeConfig,
  ThemeUpdateError,
} from '@/server/services/theme.service';
import { suggestContrastFix } from '@/server/services/contrast-suggester.service';
import { validateThemeCombinations } from '@/server/services/wcag-validator.service';
import { themeConfigSchema, toVenzoPlan } from '@/lib/theme/types';
import { CURATED_PALETTES } from '@/lib/theme/curated-palettes';
import { CURATED_FONTS } from '@/lib/theme/curated-fonts';
import { prisma } from '@/server/db/client';
import { PoweredByMode } from '@prisma/client';

function mapError(err: ThemeUpdateError): TRPCError {
  if (err.code === 'PLAN_FORBIDDEN' || err.code === 'OVERRIDE_NOT_ALLOWED')
    return new TRPCError({ code: 'FORBIDDEN', message: err.message, cause: err.details });
  if (err.code === 'FEATURE_DISABLED')
    return new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message });
  return new TRPCError({
    code: 'UNPROCESSABLE_CONTENT',
    message: err.message,
    cause: err.details,
  });
}

// P-91 — todas as queries do router `theme` são consumidas exclusivamente
// pela UI `/admin/branding`. `resolveTenantTheme` no layout server-side lê
// direto do service `getThemeConfig` (não passa por tRPC), então gate
// admin não afeta o rendering global. Fecha vazamento de config de brand
// (paleta, fontes, overrides WCAG, histórico) pra não-ADMIN.
export const themeRouter = router({
  get: adminOnlyProcedure.query(({ ctx }) => getThemeConfig(ctx.tenantId)),

  validate: adminOnlyProcedure
    .input(themeConfigSchema)
    .query(({ input }) => validateThemeCombinations(input)),

  suggestContrastFix: adminOnlyProcedure
    .input(z.object({ baseHex: z.string(), minRatio: z.number().min(1).max(21).default(4.5) }))
    .query(({ input }) => suggestContrastFix(input.baseHex, input.minRatio)),

  listCuratedPalettes: adminOnlyProcedure.query(() => CURATED_PALETTES),

  listCuratedFonts: adminOnlyProcedure.query(() => CURATED_FONTS),

  update: adminOnlyProcedure
    .input(
      z.object({
        themeConfig: themeConfigSchema,
        poweredBy: z.nativeEnum(PoweredByMode).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await updateThemeConfig({
          tenantId: ctx.tenantId,
          actorUserId: ctx.user.id,
          themeConfig: input.themeConfig,
          poweredBy: input.poweredBy,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      } catch (err) {
        if (err instanceof ThemeUpdateError) throw mapError(err);
        throw err;
      }
    }),

  publishWithOverride: adminOnlyProcedure
    .input(
      z.object({
        themeConfig: themeConfigSchema,
        poweredBy: z.nativeEnum(PoweredByMode).optional(),
        justification: z.string().min(30).max(500),
        dpoApproval: z.literal(true),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await updateThemeConfig({
          tenantId: ctx.tenantId,
          actorUserId: ctx.user.id,
          themeConfig: input.themeConfig,
          poweredBy: input.poweredBy,
          overrideJustification: input.justification,
          overrideDpoApproval: input.dpoApproval,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      } catch (err) {
        if (err instanceof ThemeUpdateError) throw mapError(err);
        throw err;
      }
    }),

  auditHistory: adminOnlyProcedure.query(async ({ ctx }) => {
    const rows = await prisma.auditLog.findMany({
      where: {
        tenantId: ctx.tenantId,
        action: 'theme.update',
      },
      orderBy: { at: 'desc' },
      take: 50,
      include: { user: { select: { fullName: true, email: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      actor: r.user,
      before: r.before,
      after: r.after,
    }));
  }),

  planInfo: adminOnlyProcedure.query(async ({ ctx }) => {
    const t = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { plan: true },
    });
    return { plan: t ? toVenzoPlan(t.plan) : 'STARTER', rawPlan: t?.plan ?? null };
  }),
});
