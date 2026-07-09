import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router } from '@/server/trpc/trpc';
import { withPermission } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { zUuid } from '@/lib/validators';
import {
  companyCreateInput,
  companyUpdateInput,
  companyListInput,
} from '@/lib/validators/company';
import { ImportantDateEntityType, Prisma } from '@prisma/client';

const canRead = withPermission('company:read');
const canCreate = withPermission('company:create');
const canUpdate = withPermission('company:update');
const canDelete = withPermission('company:delete');

export const companiesRouter = router({
  list: canRead.input(companyListInput).query(async ({ input, ctx }) => {
    const where: Prisma.CompanyWhereInput = {
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...(input.type ? { type: input.type } : {}),
      ...(input.territoryId ? { territoryId: input.territoryId } : {}),
      ...(input.segmentId ? { segmentId: input.segmentId } : {}),
      ...(input.search
        ? {
            OR: [
              { razaoSocial: { contains: input.search, mode: 'insensitive' } },
              { nomeFantasia: { contains: input.search, mode: 'insensitive' } },
              { cnpj: { contains: input.search.replace(/\D/g, '') } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.company.findMany({
        where,
        orderBy: { razaoSocial: 'asc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        }),
      prisma.company.count({ where }),
    ]);
    return { rows, total, page: input.page, pageSize: input.pageSize };
  }),

  byId: canRead.input(z.object({ id: zUuid })).query(async ({ input, ctx }) => {
    const company = await prisma.company.findFirst({
      where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!company) throw new TRPCError({ code: 'NOT_FOUND' });
    const importantDates = await prisma.importantDate.findMany({
      where: {
        tenantId: ctx.tenantId,
        deletedAt: null,
        entityType: ImportantDateEntityType.COMPANY,
        entityId: company.id,
      },
      orderBy: { dateValue: 'asc' },
    });
    return { ...company, importantDates };
  }),

  create: canCreate.input(companyCreateInput).mutation(async ({ input, ctx }) => {
    const { importantDates, ...data } = input;
    const company = await prisma.company.create({
      data: {
        tenantId: ctx.tenantId,
        createdBy: ctx.user.id,
        ...data,
      } as Prisma.CompanyUncheckedCreateInput,
    });
    if (importantDates?.length) {
      await prisma.importantDate.createMany({
        data: importantDates.map((d) => ({
          tenantId: ctx.tenantId,
          entityType: ImportantDateEntityType.COMPANY,
          entityId: company.id,
          dateType: d.dateType,
          label: d.label ?? null,
          dateValue: d.dateValue,
          alertActive: d.alertActive,
          createdBy: ctx.user.id,
        })),
      });
    }
    await audit({
      action: 'company.create',
      tableName: 'companies',
      recordId: company.id,
      after: company,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      tenantIdOverride: ctx.tenantId,
    });
    return company;
  }),

  update: canUpdate.input(companyUpdateInput).mutation(async ({ input, ctx }) => {
    // importantDates updates ficam em mutation dedicada (sprint posterior)
    const { id, importantDates: _ignored, ...data } = input;
    void _ignored;
    const before = await prisma.company.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
    const updated = await prisma.company.update({
      where: { id },
      data: { ...data, updatedBy: ctx.user.id } as Prisma.CompanyUncheckedUpdateInput,
    });
    await audit({
      action: 'company.update',
      tableName: 'companies',
      recordId: updated.id,
      before,
      after: updated,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      tenantIdOverride: ctx.tenantId,
    });
    return updated;
  }),

  remove: canDelete.input(z.object({ id: zUuid })).mutation(async ({ input, ctx }) => {
    const before = await prisma.company.findFirst({
      where: { id: input.id, deletedAt: null },
    });
    if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
    const updated = await prisma.company.update({
      where: { id: input.id },
      data: { deletedAt: new Date(), updatedBy: ctx.user.id },
    });
    await audit({
      action: 'company.delete',
      tableName: 'companies',
      recordId: updated.id,
      before,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      tenantIdOverride: ctx.tenantId,
    });
    return { ok: true };
  }),
});
