import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { router, protectedProcedure } from '@/server/trpc/trpc';
import { adminOnlyProcedure, withPermission } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { compareDocumentVersions } from '@/server/services/document-compare.service';
import { uploadObject, s3Enabled } from '@/server/services/storage-s3.service';
import { zUuid } from '@/lib/validators';
import { DocumentCategory, Prisma } from '@prisma/client';

// P-19 — nome sanitizado pro storageKey: preserva letras/dígitos/./-/_
// e converte espaços em `_`. Colapsa `..` (path traversal) em `_` e
// remove diacríticos via NFKD antes do strip.
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[/\\]+/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.\-]+|[_.\-]+$/g, '')
    .slice(0, 120);
  return cleaned || 'file';
}

export function buildDocumentStorageKey(tenantId: string, filename: string): string {
  return `tenant/${tenantId}/documents/${randomUUID()}-${sanitizeFilename(filename)}`;
}

const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const LOCAL_UPLOAD_ROOT = join(tmpdir(), 'venzo-uploads');

/**
 * Routers de documentos (Sprint 7):
 *   - documents.* — anexos a oportunidades, com categoria + versionamento
 *   - templates.* — biblioteca de templates por categoria, por tenant
 *
 * Sprint 7 NÃO implementa upload binário; armazena `storageKey` como URL/path
 * (S3/Drive/Dropbox externos). Sprint 11 endurece com presigned URLs.
 */

// Sprint 15E — antes: `opportunity:read` / `opportunity:update` (proxy grosso
// via opp). Agora: permissions granulares (P-19). Matriz concede
// `document:upload/read` amplamente; `document:delete` só ADMIN.
const canRead = withPermission('document:read');
const canWrite = withPermission('document:upload');

export const documentsRouter = router({
  // P-19 — cliente pede intent de upload. Server gera storageKey com
  // prefixo tenant/${tenantId}/ e retorna. Cliente sobe bytes via
  // uploadProxy (upload-then-forward via server) — mais simples que
  // presigned URL direto (que exigiria CORS bucket).
  getUploadIntent: canWrite
    .input(
      z.object({
        filename: z.string().min(1).max(255),
        mimeType: z.string().min(3).max(120),
        sizeBytes: z.number().int().positive().max(UPLOAD_MAX_BYTES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const storageKey = buildDocumentStorageKey(ctx.tenantId, input.filename);
      const mode: 's3' | 'local' = s3Enabled() ? 's3' : 'local';
      await audit({
        action: 'document.upload_intent',
        tableName: 'documents',
        recordId: storageKey,
        after: { filename: input.filename, sizeBytes: input.sizeBytes, mode },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return { storageKey, mode };
    }),

  // P-19 — cliente sobe os bytes em base64. Server valida prefixo do
  // storageKey (defesa cross-tenant), decoda e delega pra S3 ou grava
  // em fallback local (/tmp/venzo-uploads) quando S3 não configurado.
  uploadProxy: canWrite
    .input(
      z.object({
        storageKey: z.string().min(1).max(500),
        contentBase64: z.string().min(1).max(30 * 1024 * 1024), // ~22 MB binário
        mimeType: z.string().min(3).max(120),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const prefix = `tenant/${ctx.tenantId}/`;
      if (!input.storageKey.startsWith(prefix)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'storageKey fora do escopo do tenant.',
        });
      }
      const body = Buffer.from(input.contentBase64, 'base64');
      if (body.byteLength === 0 || body.byteLength > UPLOAD_MAX_BYTES) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Payload vazio ou maior que o limite.',
        });
      }

      let mode: 's3' | 'local';
      const s3Key = await uploadObject(input.storageKey, body, input.mimeType);
      if (s3Key) {
        mode = 's3';
      } else {
        const localPath = join(LOCAL_UPLOAD_ROOT, input.storageKey);
        await fs.mkdir(dirname(localPath), { recursive: true });
        await fs.writeFile(localPath, body);
        mode = 'local';
      }

      await audit({
        action: 'document.upload',
        tableName: 'documents',
        recordId: input.storageKey,
        after: { sizeBytes: body.byteLength, mode },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return { storageKey: input.storageKey, mode, sizeBytes: body.byteLength };
    }),

  listByOpportunity: canRead
    .input(z.object({ opportunityId: zUuid }))
    .query(({ input, ctx }) =>
      prisma.document.findMany({
        where: {
          tenantId: ctx.tenantId,
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
        tenantIdOverride: ctx.tenantId,
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
        tenantIdOverride: ctx.tenantId,
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
        tenantIdOverride: ctx.tenantId,
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
        tenantIdOverride: ctx.tenantId,
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
