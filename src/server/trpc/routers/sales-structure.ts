import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '@/server/trpc/trpc';
import { withPermission } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { zUuid } from '@/lib/validators';
import { SalesUnitRepository } from '@/server/db/repositories/sales-unit.repository';
import { SalesStructureService } from '@/server/services/sales-structure.service';

/**
 * Sprint 15G Fase 2b — router de estrutura comercial.
 *
 * Contrato compartilhado com Fase 2a via
 * `@/server/services/sales-structure.service` (stub + contrato aqui,
 * implementação real vem do Fase 2a).
 *
 * Regras de arquitetura observadas:
 *  - Multi-tenancy §4.1: cross-tenant guard em toda mutation antes
 *    de update/delete (findFirst com tenantId).
 *  - Audit §4.4: `tenantIdOverride: ctx.tenantId` obrigatório.
 *  - RBAC granular §4.5: `withPermission('sales_structure:read'|
 *    'sales_structure:manage')` conforme §8. `myScope` só
 *    `protectedProcedure` — a resposta já filtra por role.
 *  - Backstop P-42 §4.10: updates não exigem tenantId no data
 *    (WHERE injection cobre).
 *  - Convenção A7: `createUnit` NUNCA usa `prisma.salesUnit.create`
 *    direto — sempre `SalesUnitRepository.create` (calcula path
 *    ltree corretamente).
 */

const canReadStructure = withPermission('sales_structure:read');
const canManageStructure = withPermission('sales_structure:manage');

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

const createUnitTypeInput = z.object({
  name: z.string().min(2).max(50),
  level: z.number().int().min(1).max(8),
  color: z.string().regex(HEX_COLOR).optional(),
  icon: z.string().max(50).optional(),
});

const updateUnitTypeInput = z.object({
  id: zUuid,
  name: z.string().min(2).max(50).optional(),
  color: z.string().regex(HEX_COLOR).optional(),
  icon: z.string().max(50).optional(),
});

const createUnitInput = z.object({
  typeId: zUuid,
  name: z.string().min(2).max(100),
  parentId: zUuid.optional(),
});

const addMemberInput = z.object({
  unitId: zUuid,
  userId: zUuid,
  role: z.enum(['MANAGER', 'MEMBER']),
  isPrimary: z.boolean().optional(),
});

const removeMemberInput = z.object({
  unitId: zUuid,
  userId: zUuid,
});

/**
 * Cross-tenant guard reusável — retorna 404 quando o registro
 * não pertence ao tenant do caller (evita enumeration).
 */
async function assertUnitTypeInTenant(id: string, tenantId: string): Promise<void> {
  const row = await prisma.salesUnitType.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Tipo de unidade não encontrado neste tenant.' });
  }
}

async function assertUnitInTenant(id: string, tenantId: string): Promise<void> {
  const row = await prisma.salesUnit.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Unidade não encontrada neste tenant.' });
  }
}

export const salesStructureRouter = router({
  // ================================================================
  // Types
  // ================================================================

  listUnitTypes: canReadStructure.query(async ({ ctx }) => {
    return prisma.salesUnitType.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { level: 'asc' },
    });
  }),

  createUnitType: canManageStructure
    .input(createUnitTypeInput)
    .mutation(async ({ input, ctx }) => {
      const created = await SalesStructureService.createUnitType({
        ...input,
        tenantId: ctx.tenantId,
      });

      await audit({
        action: 'sales_structure.unit_type_created',
        tableName: 'sales_unit_types',
        recordId: created.id,
        tenantIdOverride: ctx.tenantId,
        after: {
          name: created.name,
          level: created.level,
          color: created.color,
          icon: created.icon,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return created;
    }),

  updateUnitType: canManageStructure
    .input(updateUnitTypeInput)
    .mutation(async ({ input, ctx }) => {
      await assertUnitTypeInTenant(input.id, ctx.tenantId);

      const { id, ...data } = input;
      const updated = await prisma.salesUnitType.update({
        where: { id },
        data,
      });

      await audit({
        action: 'sales_structure.unit_type_updated',
        tableName: 'sales_unit_types',
        recordId: id,
        tenantIdOverride: ctx.tenantId,
        after: data,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return updated;
    }),

  deleteUnitType: canManageStructure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ input, ctx }) => {
      await assertUnitTypeInTenant(input.id, ctx.tenantId);

      const inUse = await prisma.salesUnit.count({
        where: { typeId: input.id, tenantId: ctx.tenantId, deletedAt: null },
      });
      if (inUse > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Tipo em uso por unidades ativas. Remova ou reclassifique as unidades antes de excluir.',
        });
      }

      await prisma.salesUnitType.delete({ where: { id: input.id } });

      await audit({
        action: 'sales_structure.unit_type_deleted',
        tableName: 'sales_unit_types',
        recordId: input.id,
        tenantIdOverride: ctx.tenantId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { ok: true as const };
    }),

  // ================================================================
  // Units
  // ================================================================

  /**
   * Árvore completa do tenant, delega ao Repository que já ordena
   * por `path` (ltree) e agrega member_count.
   */
  getTree: canReadStructure.query(async ({ ctx }) => {
    return SalesUnitRepository.getTree(ctx.tenantId);
  }),

  /**
   * Detalhe de uma unit + ancestrais (breadcrumb) + filhos diretos.
   */
  getUnit: canReadStructure
    .input(z.object({ id: zUuid }))
    .query(async ({ input, ctx }) => {
      const [unit, ancestors, children] = await Promise.all([
        prisma.salesUnit.findFirst({
          where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null },
          include: {
            type: true,
            members: {
              include: {
                user: { select: { id: true, fullName: true, email: true, role: true } },
              },
              orderBy: [{ isPrimary: 'desc' }, { role: 'asc' }],
            },
          },
        }),
        SalesUnitRepository.getAncestors(input.id, ctx.tenantId),
        SalesUnitRepository.getChildren(input.id, ctx.tenantId),
      ]);

      if (!unit) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Unidade não encontrada neste tenant.' });
      }

      return { unit, ancestors, children };
    }),

  /**
   * Cria uma nova SalesUnit.
   *
   * ⚠️ CRÍTICO Emenda A7: NUNCA usar `prisma.salesUnit.create` direto.
   * Delegação obrigatória a `SalesUnitRepository.create` que calcula
   * o `path` ltree deterministicamente. Bypass viola o CHECK
   * `sales_units_path_not_empty`.
   *
   * Cross-tenant guards no `typeId` e no `parentId` (quando presente).
   * O Repository também tem seu próprio guard defensivo, mas manter
   * aqui evita ir até o `$queryRaw` pra descobrir que o parent não é
   * do tenant.
   */
  createUnit: canManageStructure
    .input(createUnitInput)
    .mutation(async ({ input, ctx }) => {
      await assertUnitTypeInTenant(input.typeId, ctx.tenantId);
      if (input.parentId) {
        await assertUnitInTenant(input.parentId, ctx.tenantId);
      }

      const created = await SalesUnitRepository.create({
        tenantId: ctx.tenantId,
        typeId: input.typeId,
        name: input.name,
        parentId: input.parentId ?? null,
      });

      await audit({
        action: 'sales_structure.unit_created',
        tableName: 'sales_units',
        recordId: created.id,
        tenantIdOverride: ctx.tenantId,
        after: {
          name: created.name,
          typeId: created.typeId,
          parentId: created.parentId,
          path: created.path,
          depth: created.depth,
          shortId: created.shortId,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return created;
    }),

  /**
   * Soft delete de uma unit. Bloqueia se houver filhos ativos —
   * evita órfãos silenciosos no path da árvore.
   */
  deactivateUnit: canManageStructure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ input, ctx }) => {
      await assertUnitInTenant(input.id, ctx.tenantId);

      const activeChildren = await prisma.salesUnit.count({
        where: {
          parentId: input.id,
          tenantId: ctx.tenantId,
          deletedAt: null,
          active: true,
        },
      });
      if (activeChildren > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Desative as subunidades antes de desativar esta unidade.',
        });
      }

      await prisma.salesUnit.update({
        where: { id: input.id },
        data: { active: false, deletedAt: new Date() },
      });

      await audit({
        action: 'sales_structure.unit_deactivated',
        tableName: 'sales_units',
        recordId: input.id,
        tenantIdOverride: ctx.tenantId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { ok: true as const };
    }),

  // ================================================================
  // Members
  // ================================================================

  /**
   * Delega ao Service — a lógica de transação atômica (Emenda A5:
   * `updateMany + upsert` para respeitar o partial UNIQUE
   * `sales_unit_members_one_primary_per_user`) fica lá, junto com
   * o audit interno.
   */
  addMember: canManageStructure
    .input(addMemberInput)
    .mutation(async ({ input, ctx }) => {
      const result = await SalesStructureService.addMember({
        tenantId: ctx.tenantId,
        unitId: input.unitId,
        userId: input.userId,
        role: input.role,
        isPrimary: input.isPrimary,
        assignedBy: ctx.user.id,
      });
      return { ok: true as const, ...result };
    }),

  removeMember: canManageStructure
    .input(removeMemberInput)
    .mutation(async ({ input, ctx }) => {
      await SalesStructureService.removeMember({
        tenantId: ctx.tenantId,
        unitId: input.unitId,
        userId: input.userId,
      });
      return { ok: true as const };
    }),

  // ================================================================
  // Scope
  // ================================================================

  /**
   * Resolve o escopo do caller — consumido pela UI do pipeline pra
   * decidir se mostra o "scope switcher" (ex: ADMIN alternando entre
   * ALL / TEAM / OWN) e pelo relatório de performance pra exibir a
   * média anônima.
   *
   * `protectedProcedure` basta: a resposta já é role-aware e nunca
   * expõe dados fora do escopo do caller.
   */
  myScope: protectedProcedure.query(async ({ ctx }) => {
    return SalesStructureService.resolveOpportunityScope(
      {
        id: ctx.user.id,
        role: ctx.user.role,
        partnerCompanyId: ctx.user.partnerCompanyId,
      },
      ctx.tenantId,
    );
  }),
});
