import { z } from 'zod';
import { router, protectedProcedure } from '@/server/trpc/trpc';
import { prisma } from '@/server/db/client';
import { hasCapability } from '@/lib/auth/rbac';
import type { Prisma } from '@prisma/client';

/**
 * P-16 — Global command palette search.
 *
 * Read-only, alto volume, sem valor auditável — NÃO chama `audit()`.
 * Cada bucket é gated por capability RBAC; user sem permissão pra ler
 * um recurso recebe array vazio no bucket (não erro global).
 *
 * Multi-tenancy: todas as queries incluem `tenantId = ctx.tenantId`.
 * A Prisma extension já injeta isso automaticamente, mas repetimos
 * explícito em cada `where` como defesa em profundidade.
 *
 * ILIKE '%q%' é o suficiente pra escopo P-16. Fuzzy match e tsvector
 * viram P-18 se necessário.
 */

const globalSearchInput = z.object({
  query: z.string().min(2).max(100),
});

const RESULT_LIMIT = 5;

export const searchRouter = router({
  global: protectedProcedure
    .input(globalSearchInput)
    .query(async ({ input, ctx }) => {
      const q = input.query.trim();
      const canReadCompany = hasCapability(ctx.user.role, 'company', 'read');
      const canReadContact = hasCapability(ctx.user.role, 'contact', 'read');
      const canReadOpportunity = hasCapability(
        ctx.user.role,
        'opportunity',
        'read',
      );
      const canReadUser = hasCapability(ctx.user.role, 'user', 'read');

      const digits = q.replace(/\D/g, '');

      const companiesTask: Promise<
        Array<{
          id: string;
          name: string;
          cnpj: string | null;
          city: string | null;
        }>
      > = canReadCompany
        ? prisma.company
            .findMany({
              where: {
                tenantId: ctx.tenantId,
                deletedAt: null,
                OR: [
                  { razaoSocial: { contains: q, mode: 'insensitive' } },
                  { nomeFantasia: { contains: q, mode: 'insensitive' } },
                  ...(digits.length >= 2
                    ? [{ cnpj: { contains: digits } } as Prisma.CompanyWhereInput]
                    : []),
                ],
              },
              select: {
                id: true,
                razaoSocial: true,
                nomeFantasia: true,
                cnpj: true,
                city: true,
              },
              orderBy: { razaoSocial: 'asc' },
              take: RESULT_LIMIT,
            })
            .then((rows) =>
              rows.map((r) => ({
                id: r.id,
                name: r.nomeFantasia ?? r.razaoSocial,
                cnpj: r.cnpj,
                city: r.city,
              })),
            )
        : Promise.resolve([]);

      const contactsTask: Promise<
        Array<{
          id: string;
          fullName: string;
          email: string;
          companyName: string | null;
        }>
      > = canReadContact
        ? prisma.contact
            .findMany({
              where: {
                tenantId: ctx.tenantId,
                deletedAt: null,
                OR: [
                  { fullName: { contains: q, mode: 'insensitive' } },
                  { email: { contains: q, mode: 'insensitive' } },
                ],
              },
              select: {
                id: true,
                fullName: true,
                email: true,
                company: { select: { razaoSocial: true, nomeFantasia: true } },
              },
              orderBy: { fullName: 'asc' },
              take: RESULT_LIMIT,
            })
            .then((rows) =>
              rows.map((r) => ({
                id: r.id,
                fullName: r.fullName,
                email: r.email,
                companyName:
                  r.company?.nomeFantasia ?? r.company?.razaoSocial ?? null,
              })),
            )
        : Promise.resolve([]);

      const opportunitiesTask: Promise<
        Array<{
          id: string;
          title: string;
          stage: string;
          companyName: string | null;
        }>
      > = canReadOpportunity
        ? prisma.opportunity
            .findMany({
              where: {
                tenantId: ctx.tenantId,
                deletedAt: null,
                title: { contains: q, mode: 'insensitive' },
              },
              select: {
                id: true,
                title: true,
                stage: true,
                clientCompany: {
                  select: { razaoSocial: true, nomeFantasia: true },
                },
              },
              orderBy: { updatedAt: 'desc' },
              take: RESULT_LIMIT,
            })
            .then((rows) =>
              rows.map((r) => ({
                id: r.id,
                title: r.title,
                stage: r.stage as string,
                companyName:
                  r.clientCompany?.nomeFantasia ??
                  r.clientCompany?.razaoSocial ??
                  null,
              })),
            )
        : Promise.resolve([]);

      const usersTask: Promise<
        Array<{ id: string; fullName: string; email: string; role: string }>
      > = canReadUser
        ? prisma.user
            .findMany({
              where: {
                tenantId: ctx.tenantId,
                deletedAt: null,
                active: true,
                OR: [
                  { fullName: { contains: q, mode: 'insensitive' } },
                  { email: { contains: q, mode: 'insensitive' } },
                ],
              },
              select: {
                id: true,
                fullName: true,
                email: true,
                role: true,
              },
              orderBy: { fullName: 'asc' },
              take: RESULT_LIMIT,
            })
            .then((rows) =>
              rows.map((r) => ({
                id: r.id,
                fullName: r.fullName,
                email: r.email,
                role: r.role as string,
              })),
            )
        : Promise.resolve([]);

      const [companies, contacts, opportunities, users] = await Promise.all([
        companiesTask,
        contactsTask,
        opportunitiesTask,
        usersTask,
      ]);

      return { companies, contacts, opportunities, users };
    }),
});
