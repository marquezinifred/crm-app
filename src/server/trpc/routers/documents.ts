import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '@/server/trpc/trpc';
import { adminOnlyProcedure, withCapability } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { compareDocumentVersions } from '@/server/services/document-compare.service';
import { zUuid } from '@/lib/validators';
import { DocumentCategory, Prisma } from '@prisma/client';

/**
 * Routers de documentos (Sprint 7):
 *   - documents.* — anexos a oportunidades, com categoria + versionamento
 *   - templates.* — biblioteca de templates por categoria, por tenant
 *
 * Sprint 7 NÃO implementa upload binário; armazena `storageKey` como URL/path
 * (S3/Drive/Dropbox externos). Sprint 11 endurece com presigned URLs.
 */

const canRead = withCapability('opportunity', 'read');
const canWrite = withCapability('opportunity', 'update');

export const documentsRouter = router({
  listByOpportunity: canRead
    .input(z.object({ opportunityId: zUuid }))
    .query(({ input }) =>
      prisma.document.findMany({
        where: {
          deletedAt: null,
          relatedEntityType: 'opportunity',
          relatedEntityId: input.opportunityId,
        },
        orderBy: { updatedAt: 'desc' },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            select: {
              id: true,
              version: true,
              storageKey: true,
              sha256: true,
              createdAt: true,
              uploadedBy: { select: { id: true, fullName: true } },
            },
          },
        },
      }),
    ),

  create: canWrite
    .input(
      z.object({
        opportunityId: zUuid,
        category: z.nativeEnum(DocumentCategory),
        filename: z.string().min(1).max(200),
        mimeType: z.string().min(1).max(120),
        sizeBytes: z.number().int().min(0).max(2_000_000_000),
        storageKey: z.string().min(1).max(500),
        sha256: z.string().regex(/^[a-f0-9]{64}$/i),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const created = await prisma.$transaction(async (tx) => {
        const doc = await tx.document.create({
          data: {
            tenantId: ctx.tenantId,
            category: input.category,
            relatedEntityType: 'opportunity',
            relatedEntityId: input.opportunityId,
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: BigInt(input.sizeBytes),
            createdBy: ctx.user.id,
          } as Prisma.DocumentUncheckedCreateInput,
        });
        const v = await tx.documentVersion.create({
          data: {
            tenantId: ctx.tenantId,
            documentId: doc.id,
            version: 1,
            storageKey: input.storageKey,
            sizeBytes: BigInt(input.sizeBytes),
            sha256: input.sha256,
            uploadedById: ctx.user.id,
          } as Prisma.DocumentVersionUncheckedCreateInput,
        });
        await tx.document.update({
          where: { id: doc.id },
          data: { currentVersionId: v.id } as Prisma.DocumentUncheckedUpdateInput,
        });
        return { ...doc, currentVersionId: v.id };
      });
      await audit({
        action: 'document.create',
        tableName: 'documents',
        recordId: created.id,
        after: created,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return created;
    }),

  addVersion: canWrite
    .input(
      z.object({
        documentId: zUuid,
        storageKey: z.string().min(1).max(500),
        sizeBytes: z.number().int().min(0).max(2_000_000_000),
        sha256: z.string().regex(/^[a-f0-9]{64}$/i),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const doc = await prisma.document.findFirst({
        where: { id: input.documentId, deletedAt: null },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      });
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND' });

      // Dedup por sha256 — se já existe, retorna existente
      const existing = await prisma.documentVersion.findFirst({
        where: { documentId: input.documentId, sha256: input.sha256 },
      });
      if (existing) {
        return { versionId: existing.id, version: existing.version, deduped: true };
      }

      const nextVersion = (doc.versions[0]?.version ?? 0) + 1;
      const v = await prisma.documentVersion.create({
        data: {
          tenantId: ctx.tenantId,
          documentId: input.documentId,
          version: nextVersion,
          storageKey: input.storageKey,
          sizeBytes: BigInt(input.sizeBytes),
          sha256: input.sha256,
          uploadedById: ctx.user.id,
        } as Prisma.DocumentVersionUncheckedCreateInput,
      });
      await prisma.document.update({
        where: { id: input.documentId },
        data: {
          currentVersionId: v.id,
          updatedBy: ctx.user.id,
        } as Prisma.DocumentUncheckedUpdateInput,
      });
      await audit({
        action: 'document.add_version',
        tableName: 'document_versions',
        recordId: v.id,
        after: { version: nextVersion, documentId: input.documentId },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return { versionId: v.id, version: nextVersion, deduped: false };
    }),

  compare: canWrite
    .input(
      z.object({
        documentId: zUuid,
        fromVersion: z.number().int().min(1),
        toVersion: z.number().int().min(1),
        // Cliente pode enviar o texto extraído (PDF → texto) para a IA processar.
        // Se omitido, retorna apenas o diff de metadados.
        fromText: z.string().max(40000).optional(),
        toText: z.string().max(40000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const doc = await prisma.document.findFirst({
        where: { id: input.documentId, deletedAt: null },
        include: {
          versions: {
            where: { version: { in: [input.fromVersion, input.toVersion] } },
            select: { version: true, sizeBytes: true, sha256: true, createdAt: true },
          },
        },
      });
      if (!doc || doc.versions.length !== 2) throw new TRPCError({ code: 'NOT_FOUND' });

      const result = await compareDocumentVersions({
        tenantId: ctx.tenantId,
        userId: ctx.user.id,
        fromVersion: input.fromVersion,
        toVersion: input.toVersion,
        fromText: input.fromText,
        toText: input.toText,
      });
      return result;
    }),
});

export const templatesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          category: z.nativeEnum(DocumentCategory).optional(),
          activeOnly: z.boolean().default(true),
        })
        .default({ activeOnly: true }),
    )
    .query(({ input }) =>
      prisma.documentTemplate.findMany({
        where: {
          deletedAt: null,
          ...(input.activeOnly ? { active: true } : {}),
          ...(input.category ? { category: input.category } : {}),
        },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      }),
    ),

  create: adminOnlyProcedure
    .input(
      z.object({
        category: z.nativeEnum(DocumentCategory),
        name: z.string().min(2).max(120),
        description: z.string().max(1000).optional(),
        storageKey: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const t = await prisma.documentTemplate.create({
        data: {
          tenantId: ctx.tenantId,
          category: input.category,
          name: input.name,
          description: input.description ?? null,
          currentVersionStorageKey: input.storageKey ?? null,
          createdBy: ctx.user.id,
        } as Prisma.DocumentTemplateUncheckedCreateInput,
      });
      await audit({
        action: 'template.create',
        tableName: 'document_templates',
        recordId: t.id,
        after: t,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return t;
    }),

  uploadVersion: adminOnlyProcedure
    .input(
      z.object({
        id: zUuid,
        storageKey: z.string().min(1).max(500),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const t = await prisma.documentTemplate.findFirst({
        where: { id: input.id, deletedAt: null },
      });
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
      const updated = await prisma.documentTemplate.update({
        where: { id: input.id },
        data: {
          currentVersionStorageKey: input.storageKey,
          currentVersionNumber: t.currentVersionNumber + 1,
          updatedBy: ctx.user.id,
        } as Prisma.DocumentTemplateUncheckedUpdateInput,
      });
      await audit({
        action: 'template.upload_version',
        tableName: 'document_templates',
        recordId: updated.id,
        after: { version: updated.currentVersionNumber },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    }),

  setActive: adminOnlyProcedure
    .input(z.object({ id: zUuid, active: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await prisma.documentTemplate.update({
        where: { id: input.id },
        data: { active: input.active, updatedBy: ctx.user.id } as Prisma.DocumentTemplateUncheckedUpdateInput,
      });
      return { ok: true };
    }),
});
