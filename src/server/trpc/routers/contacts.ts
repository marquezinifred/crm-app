import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '@/server/trpc/trpc';
import { withCapability } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { registerPublicContact } from '@/server/services/contact-self-register.service';
import { zUuid } from '@/lib/validators';
import {
  contactCreateInput,
  contactUpdateInput,
  contactListInput,
  contactSelfRegisterInput,
  contactApprovalInput,
} from '@/lib/validators/contact';
import { ContactApprovalStatus, ImportantDateEntityType, Prisma } from '@prisma/client';

const canRead = withCapability('contact', 'read');
const canCreate = withCapability('contact', 'create');
const canUpdate = withCapability('contact', 'update');
const canDelete = withCapability('contact', 'delete');

export const contactsRouter = router({
  list: canRead.input(contactListInput).query(async ({ input }) => {
    const where: Prisma.ContactWhereInput = {
      deletedAt: null,
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.approvalStatus ? { approvalStatus: input.approvalStatus } : {}),
      ...(input.search
        ? {
            OR: [
              { fullName: { contains: input.search, mode: 'insensitive' } },
              { email: { contains: input.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: { fullName: 'asc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      prisma.contact.count({ where }),
    ]);
    return { rows, total, page: input.page, pageSize: input.pageSize };
  }),

  byId: canRead.input(z.object({ id: zUuid })).query(async ({ input }) => {
    const contact = await prisma.contact.findFirst({
      where: { id: input.id, deletedAt: null },
    });
    if (!contact) throw new TRPCError({ code: 'NOT_FOUND' });
    const importantDates = await prisma.importantDate.findMany({
      where: {
        deletedAt: null,
        entityType: ImportantDateEntityType.CONTACT,
        entityId: contact.id,
      },
      orderBy: { dateValue: 'asc' },
    });
    return { ...contact, importantDates };
  }),

  create: canCreate.input(contactCreateInput).mutation(async ({ input, ctx }) => {
    const { importantDates, ...data } = input;
    const contact = await prisma.contact.create({
      data: {
        tenantId: ctx.tenantId,
        createdBy: ctx.user.id,
        ...data,
      } as Prisma.ContactUncheckedCreateInput,
    });
    if (importantDates?.length) {
      await prisma.importantDate.createMany({
        data: importantDates.map((d) => ({
          tenantId: ctx.tenantId,
          entityType: ImportantDateEntityType.CONTACT,
          entityId: contact.id,
          dateType: d.dateType,
          label: d.label ?? null,
          dateValue: d.dateValue,
          alertActive: d.alertActive,
          createdBy: ctx.user.id,
        })),
      });
    }
    await audit({
      action: 'contact.create',
      tableName: 'contacts',
      recordId: contact.id,
      after: contact,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return contact;
  }),

  update: canUpdate.input(contactUpdateInput).mutation(async ({ input, ctx }) => {
    // importantDates updates ficam em mutation dedicada (sprint posterior)
    const { id, importantDates: _ignored, ...data } = input;
    void _ignored;
    const before = await prisma.contact.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
    const updated = await prisma.contact.update({
      where: { id },
      data: { ...data, updatedBy: ctx.user.id } as Prisma.ContactUncheckedUpdateInput,
    });
    await audit({
      action: 'contact.update',
      tableName: 'contacts',
      recordId: updated.id,
      before,
      after: updated,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return updated;
  }),

  remove: canDelete.input(z.object({ id: zUuid })).mutation(async ({ input, ctx }) => {
    const before = await prisma.contact.findFirst({
      where: { id: input.id, deletedAt: null },
    });
    if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
    const updated = await prisma.contact.update({
      where: { id: input.id },
      data: { deletedAt: new Date(), updatedBy: ctx.user.id },
    });
    await audit({
      action: 'contact.delete',
      tableName: 'contacts',
      recordId: updated.id,
      before,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: true };
  }),

  approveSelfRegistration: canUpdate
    .input(contactApprovalInput)
    .mutation(async ({ input, ctx }) => {
      const before = await prisma.contact.findFirst({
        where: {
          id: input.id,
          deletedAt: null,
          approvalStatus: ContactApprovalStatus.PENDING_APPROVAL,
        },
      });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND' });

      const approved = input.decision === 'APPROVED';
      const updated = await prisma.contact.update({
        where: { id: input.id },
        data: {
          approvalStatus: approved
            ? ContactApprovalStatus.APPROVED
            : ContactApprovalStatus.REJECTED,
          active: approved,
          approvedById: ctx.user.id,
          approvedAt: new Date(),
          updatedBy: ctx.user.id,
          ...(input.reason && !approved
            ? { notes: `${before.notes ?? ''}\n[Rejeição] ${input.reason}`.trim() }
            : {}),
        } as Prisma.ContactUncheckedUpdateInput,
      });
      await audit({
        action: approved ? 'contact.approve' : 'contact.reject',
        tableName: 'contacts',
        recordId: updated.id,
        before,
        after: updated,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    }),

  // ----- Auto-cadastro público (sem auth) -----
  selfRegister: publicProcedure
    .input(contactSelfRegisterInput)
    .mutation(async ({ input }) => registerPublicContact(input)),
});
