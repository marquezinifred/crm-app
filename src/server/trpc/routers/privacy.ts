import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure } from '@/server/trpc/trpc';
import { adminOnlyProcedure } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { audit } from '@/server/services/audit.service';
import {
  collectPersonalData,
  anonymizeSubject,
  createDataSubjectRequest,
  markRequestProcessing,
  completeRequest,
  rejectRequest,
} from '@/server/services/privacy-workflow.service';
import {
  uploadObject,
  presignDownload,
  s3Enabled,
} from '@/server/services/storage-s3.service';
import { zEmail, zUuid } from '@/lib/validators';
import {
  DataSubjectRequestStatus,
  DataSubjectRequestType,
  PolicyDocument,
  Prisma,
} from '@prisma/client';

const submitInput = z.object({
  tenantSlug: z.string().min(2).max(60),
  requestType: z.nativeEnum(DataSubjectRequestType),
  subjectEmail: zEmail,
  subjectName: z.string().max(160).optional(),
  description: z.string().max(2000).optional(),
});

export const privacyRouter = router({
  /** Pública: titular submete solicitação. Sem auth. */
  submitRequest: publicProcedure.input(submitInput).mutation(async ({ input, ctx }) => {
    const tenant = await runAsSystem(() =>
      prisma.tenant.findUnique({
        where: { slug: input.tenantSlug },
        select: { id: true },
      }),
    );
    if (!tenant) throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant inválido' });

    const created = await createDataSubjectRequest({
      tenantId: tenant.id,
      requestType: input.requestType,
      subjectEmail: input.subjectEmail,
      subjectName: input.subjectName,
      description: input.description,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: true, requestId: created.id, dueAt: created.dueAt };
  }),

  listPending: adminOnlyProcedure.query(({ ctx }) =>
    prisma.dataSubjectRequest.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      orderBy: { dueAt: 'asc' },
    }),
  ),

  listAll: adminOnlyProcedure.query(({ ctx }) =>
    prisma.dataSubjectRequest.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    }),
  ),

  process: adminOnlyProcedure
    .input(z.object({ id: zUuid }))
    .mutation(async ({ input, ctx }) => {
      const req = await prisma.dataSubjectRequest.findFirst({
        where: { id: input.id, deletedAt: null },
      });
      if (!req) throw new TRPCError({ code: 'NOT_FOUND' });
      await markRequestProcessing(req.id, ctx.user.id);

      let exportKey: string | null = null;
      try {
        if (req.requestType === 'ACCESS' || req.requestType === 'PORTABILITY') {
          const pkg = await collectPersonalData(req.tenantId, req.subjectEmail);
          const json = JSON.stringify(pkg, null, 2);
          if (s3Enabled()) {
            const key = `privacy-exports/${req.tenantId}/${req.id}.json`;
            const uploaded = await uploadObject(key, json, 'application/json');
            exportKey = uploaded ?? `inline:${Buffer.from(json).toString('base64').slice(0, 200)}`;
          } else {
            exportKey = `inline:${Buffer.from(json).toString('base64').slice(0, 200)}`;
          }
        }
        if (req.requestType === 'DELETION') {
          await anonymizeSubject(req.tenantId, req.subjectEmail);
        }
        const done = await completeRequest(req.id, exportKey);
        await audit({
          action: `lgpd.${req.requestType.toLowerCase()}.complete`,
          tableName: 'data_subject_requests',
          recordId: req.id,
          after: { exportKey, requestType: req.requestType },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          tenantIdOverride: ctx.tenantId,
        });
        return done;
      } catch (err) {
        await rejectRequest(req.id, err instanceof Error ? err.message : 'erro desconhecido');
        throw err;
      }
    }),

  reject: adminOnlyProcedure
    .input(z.object({ id: zUuid, reason: z.string().min(3).max(500) }))
    .mutation(async ({ input, ctx }) => {
      const updated = await rejectRequest(input.id, input.reason);
      await audit({
        action: 'lgpd.reject',
        tableName: 'data_subject_requests',
        recordId: input.id,
        after: { reason: input.reason },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return updated;
    }),

  exportPayload: adminOnlyProcedure
    .input(z.object({ id: zUuid }))
    .query(async ({ input }) => {
      const req = await prisma.dataSubjectRequest.findFirst({
        where: { id: input.id, deletedAt: null, status: DataSubjectRequestStatus.COMPLETED },
      });
      if (!req || !req.exportFileKey) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      if (req.exportFileKey.startsWith('inline:')) {
        const b64 = req.exportFileKey.slice('inline:'.length);
        return { kind: 'inline' as const, preview: b64.slice(0, 100), totalChars: b64.length };
      }
      const url = await presignDownload(req.exportFileKey, 60 * 60 * 24);
      if (!url) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'S3 não configurado' });
      return { kind: 's3' as const, url, expiresInSeconds: 60 * 60 * 24 };
    }),

  // ----- Aceite de termos -----
  acceptPolicy: protectedProcedure
    .input(
      z.object({
        document: z.nativeEnum(PolicyDocument),
        version: z.string().min(1).max(40),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await prisma.policyAcceptance.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.id,
          document: input.document,
          version: input.version,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        } as Prisma.PolicyAcceptanceUncheckedCreateInput,
      });
      return { ok: true };
    }),

  myAcceptedVersions: protectedProcedure.query(({ ctx }) =>
    prisma.policyAcceptance.findMany({
      where: { userId: ctx.user.id },
      orderBy: { acceptedAt: 'desc' },
      take: 20,
      select: { document: true, version: true, acceptedAt: true },
    }),
  ),
});
