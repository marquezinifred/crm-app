import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router } from '@/server/trpc/trpc';
import { withCapability } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { dispatchHandoff } from '@/server/services/contract-handoff.service';
import { zUuid } from '@/lib/validators';
import {
  contractCreateInput,
  contractUpdateInput,
  installmentCreateInput,
  installmentUpdateInput,
} from '@/lib/validators/contract';
import { Prisma } from '@prisma/client';

const canRead = withCapability('contract', 'read');
const canCreate = withCapability('contract', 'create');
const canUpdate = withCapability('contract', 'update');

export const contractsRouter = router({
  list: canRead
    .input(
      z
        .object({
          opportunityId: zUuid.optional(),
          search: z.string().max(80).optional(),
        })
        .default({}),
    )
    .query(async ({ input }) =>
      prisma.contract.findMany({
        where: {
          deletedAt: null,
          ...(input.opportunityId ? { opportunityId: input.opportunityId } : {}),
          ...(input.search ? { number: { contains: input.search, mode: 'insensitive' } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        include: {
          opportunity: { select: { id: true, title: true } },
          installments: { orderBy: { number: 'asc' } },
        },
      }),
    ),

  byId: canRead.input(z.object({ id: zUuid })).query(async ({ input }) => {
    const c = await prisma.contract.findFirst({
      where: { id: input.id, deletedAt: null },
      include: { installments: { orderBy: { number: 'asc' } } },
    });
    if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
    return c;
  }),

  create: canCreate.input(contractCreateInput).mutation(async ({ input, ctx }) => {
    const created = await prisma.contract.create({
      data: {
        tenantId: ctx.tenantId,
        createdBy: ctx.user.id,
        ...input,
      } as Prisma.ContractUncheckedCreateInput,
    });
    await audit({
      action: 'contract.create',
      tableName: 'contracts',
      recordId: created.id,
      after: created,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return created;
  }),

  update: canUpdate.input(contractUpdateInput).mutation(async ({ input, ctx }) => {
    const { id, ...data } = input;
    const before = await prisma.contract.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
    const updated = await prisma.contract.update({
      where: { id },
      data: { ...data, updatedBy: ctx.user.id } as Prisma.ContractUncheckedUpdateInput,
    });
    await audit({
      action: 'contract.update',
      tableName: 'contracts',
      recordId: updated.id,
      before,
      after: updated,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    // Handoff automático ao virar ACTIVE
    if (before.status !== 'ACTIVE' && updated.status === 'ACTIVE') {
      try {
        await dispatchHandoff(updated.id);
      } catch (err) {
        console.error('[contract.update] handoff falhou', err);
      }
    }
    return updated;
  }),

  installments: router({
    create: canUpdate.input(installmentCreateInput).mutation(async ({ input, ctx }) => {
      const { billingData, ...data } = input;
      const created = await prisma.contractInstallment.create({
        data: {
          tenantId: ctx.tenantId,
          createdBy: ctx.user.id,
          billingDataJson: billingData as never,
          ...data,
        } as Prisma.ContractInstallmentUncheckedCreateInput,
      });
      await audit({
        action: 'contract_installment.create',
        tableName: 'contract_installments',
        recordId: created.id,
        after: created,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return created;
    }),

    update: canUpdate.input(installmentUpdateInput).mutation(async ({ input, ctx }) => {
      const { id, billingData, ...data } = input;
      const before = await prisma.contractInstallment.findFirst({
        where: { id, deletedAt: null },
      });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
      const updated = await prisma.contractInstallment.update({
        where: { id },
        data: {
          ...data,
          ...(billingData ? { billingDataJson: billingData as never } : {}),
          updatedBy: ctx.user.id,
        } as Prisma.ContractInstallmentUncheckedUpdateInput,
      });
      await audit({
        action: 'contract_installment.update',
        tableName: 'contract_installments',
        recordId: updated.id,
        before,
        after: updated,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    }),
  }),
});
