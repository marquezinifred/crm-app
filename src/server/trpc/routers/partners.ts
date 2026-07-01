import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, publicProcedure } from '@/server/trpc/trpc';
import { adminOnlyProcedure, withCapability } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { audit } from '@/server/services/audit.service';
import { zUuid, zEmail } from '@/lib/validators';
import { CompanyType, Prisma } from '@prisma/client';

/**
 * Router de parceiros — complementa Company.PARTNER já existente:
 *   - listWithStats: lista parceiros + oportunidades vinculadas + comissão acumulada
 *   - getTcText: texto T&C do parceiro
 *   - updateTcText: atualiza T&C (Admin)
 *   - registerTcAcceptance: aceite formal por oportunidade (público — token-based)
 *   - linkUserToPartner: vincula User PARCEIRO a Company PARTNER (Admin)
 */

export const partnersRouter = router({
  listWithStats: protectedProcedure.query(async ({ ctx }) => {
    const partners = await prisma.company.findMany({
      where: { tenantId: ctx.tenantId, type: CompanyType.PARTNER, deletedAt: null },
      orderBy: { razaoSocial: 'asc' },
      include: {
        engagements: {
          where: { status: 'APPROVED' },
          select: { opportunityId: true },
        },
        asPartnerIn: {
          where: { deletedAt: null },
          select: {
            id: true,
            stage: true,
            status: true,
            estimatedValue: true,
            closedValue: true,
            commissionPctOverride: true,
          },
        },
        tcAcceptances: { select: { id: true, tcVersion: true } },
        partnerUsers: { select: { id: true, fullName: true, email: true } },
      },
    });

    return partners.map((p) => {
      const totalDeals = p.asPartnerIn.length;
      const won = p.asPartnerIn.filter((o) => o.status === 'WON').length;
      const wonValue = p.asPartnerIn
        .filter((o) => o.status === 'WON')
        .reduce((s, o) => s + Number(o.closedValue ?? o.estimatedValue ?? 0), 0);
      const commission = p.asPartnerIn
        .filter((o) => o.status === 'WON')
        .reduce((s, o) => {
          const pct = Number(o.commissionPctOverride ?? p.commissionPct ?? 0);
          return s + (Number(o.closedValue ?? o.estimatedValue ?? 0) * pct) / 100;
        }, 0);
      return {
        id: p.id,
        razaoSocial: p.razaoSocial,
        nomeFantasia: p.nomeFantasia,
        cnpj: p.cnpj,
        commissionPct: p.commissionPct ? Number(p.commissionPct) : 0,
        partnerActive: p.partnerActive,
        tcVersion: p.tcVersion,
        hasTcText: !!p.tcText,
        totalDeals,
        won,
        wonValue,
        commissionAccrued: commission,
        tcAcceptanceCount: p.tcAcceptances.length,
        partnerUsers: p.partnerUsers,
      };
    });
  }),

  getTcText: protectedProcedure
    .input(z.object({ partnerCompanyId: zUuid }))
    .query(async ({ input }) => {
      const p = await prisma.company.findFirst({
        where: { id: input.partnerCompanyId, type: CompanyType.PARTNER, deletedAt: null },
        select: { tcVersion: true, tcText: true, razaoSocial: true },
      });
      if (!p) throw new TRPCError({ code: 'NOT_FOUND' });
      return p;
    }),

  updatePartnerConfig: adminOnlyProcedure
    .input(
      z.object({
        partnerCompanyId: zUuid,
        commissionPct: z.number().min(0).max(100).optional(),
        tcText: z.string().max(50000).optional(),
        tcVersion: z.string().max(40).optional(),
        partnerActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const updated = await prisma.company.update({
        where: { id: input.partnerCompanyId },
        data: {
          ...(input.commissionPct !== undefined ? { commissionPct: input.commissionPct } : {}),
          ...(input.tcText !== undefined ? { tcText: input.tcText } : {}),
          ...(input.tcVersion !== undefined ? { tcVersion: input.tcVersion } : {}),
          ...(input.partnerActive !== undefined ? { partnerActive: input.partnerActive } : {}),
          updatedBy: ctx.user.id,
        } as Prisma.CompanyUncheckedUpdateInput,
      });
      await audit({
        action: 'partner.update_config',
        tableName: 'companies',
        recordId: updated.id,
        after: input,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return { ok: true };
    }),

  linkUserToPartner: adminOnlyProcedure
    .input(z.object({ userId: zUuid, partnerCompanyId: zUuid }))
    .mutation(async ({ input, ctx }) => {
      const u = await prisma.user.update({
        where: { id: input.userId },
        data: {
          partnerCompanyId: input.partnerCompanyId,
          role: 'PARCEIRO',
        } as Prisma.UserUncheckedUpdateInput,
      });
      await audit({
        action: 'partner.link_user',
        tableName: 'users',
        recordId: u.id,
        after: { partnerCompanyId: input.partnerCompanyId },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return { ok: true };
    }),

  // Aceite formal por oportunidade — bloqueia engajamento APPROVED até existir
  registerTcAcceptance: withCapability('partner', 'invite')
    .input(
      z.object({
        opportunityId: zUuid,
        partnerCompanyId: zUuid,
        tcVersion: z.string().min(1).max(40),
        acceptedByName: z.string().min(2).max(160),
        acceptedByEmail: zEmail,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const acceptance = await prisma.partnerTcAcceptance.create({
        data: {
          tenantId: ctx.tenantId,
          partnerCompanyId: input.partnerCompanyId,
          tcVersion: input.tcVersion,
          acceptedByName: input.acceptedByName,
          acceptedByEmail: input.acceptedByEmail,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        } as Prisma.PartnerTcAcceptanceUncheckedCreateInput,
      });
      await audit({
        action: 'partner.tc_accept',
        tableName: 'partner_tc_acceptances',
        recordId: acceptance.id,
        after: { partnerCompanyId: input.partnerCompanyId, version: input.tcVersion },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return { ok: true, acceptanceId: acceptance.id };
    }),

  // Página pública de aceite — sem auth (token = partnerLink.token)
  publicTcView: publicProcedure
    .input(z.object({ token: z.string().min(8).max(80) }))
    .query(async ({ input }) => {
      return runAsSystem(async () => {
        const link = await prisma.partnerLink.findFirst({
          where: {
            token: input.token,
            deletedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          include: {
            partnerCompany: {
              select: { id: true, razaoSocial: true, tcText: true, tcVersion: true },
            },
            tenant: { select: { name: true, slug: true } },
          },
        });
        if (!link || !link.partnerCompany) return null;
        return {
          tenantName: link.tenant.name,
          partner: {
            id: link.partnerCompany.id,
            razaoSocial: link.partnerCompany.razaoSocial,
            tcText: link.partnerCompany.tcText,
            tcVersion: link.partnerCompany.tcVersion,
          },
        };
      });
    }),

  publicTcAccept: publicProcedure
    .input(
      z.object({
        token: z.string().min(8).max(80),
        acceptedByName: z.string().min(2).max(160),
        acceptedByEmail: zEmail,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return runAsSystem(async () => {
        const link = await prisma.partnerLink.findFirst({
          where: {
            token: input.token,
            deletedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          select: {
            id: true,
            tenantId: true,
            partnerCompanyId: true,
            uses: true,
            maxUses: true,
            partnerCompany: { select: { tcVersion: true } },
          },
        });
        if (!link || !link.partnerCompanyId || link.uses >= link.maxUses) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Token inválido ou expirado.' });
        }

        const ip = ctx.ip ?? null;
        const userAgent = ctx.userAgent ?? null;

        await prisma.$transaction([
          prisma.partnerTcAcceptance.create({
            data: {
              tenantId: link.tenantId,
              partnerCompanyId: link.partnerCompanyId,
              tcVersion: link.partnerCompany?.tcVersion ?? '1.0',
              acceptedByName: input.acceptedByName,
              acceptedByEmail: input.acceptedByEmail,
              ip,
              userAgent,
            } as Prisma.PartnerTcAcceptanceUncheckedCreateInput,
          }),
          prisma.partnerLink.update({
            where: { id: link.id },
            data: { uses: { increment: 1 }, usedAt: new Date() },
          }),
        ]);

        return { ok: true };
      });
    }),
});
