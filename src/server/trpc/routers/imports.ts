import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '@/server/trpc/trpc';
import { withPermission } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { IMPORT_FIELDS } from '@/server/services/import-engine.service';
import { makeQueue, QUEUE_NAMES, type ImportRunJobData } from '@/jobs/queues';
import { zUuid } from '@/lib/validators';
import { ImportDedupStrategy, ImportEntity, ImportStatus, Prisma } from '@prisma/client';

/**
 * Fluxo:
 *   1. UI envia o arquivo via POST /api/v1/imports/upload (multipart)
 *      → cria ImportJob status=PENDING com fileBytes preservados, gera headers + preview
 *   2. UI mostra mapping wizard. Quando confirmar, chama imports.confirm({id, mapping, strategy})
 *      → atualiza status para MAPPED + enfileira no worker
 *   3. Worker processa, atualiza processedRows, status=DONE com resultJson
 */

// Sprint 15E — antes: `withCapability('company', 'create')` (proxy grosso).
// Agora: permission granular `import:run` (só ADMIN + GESTOR por default).
const canImport = withPermission('import:run');

export const importsRouter = router({
  fields: protectedProcedure
    .input(z.object({ entity: z.nativeEnum(ImportEntity) }))
    .query(({ input }) => IMPORT_FIELDS[input.entity]),

  list: canImport.query(({ ctx }) =>
    prisma.importJob.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        entity: true,
        status: true,
        fileName: true,
        totalRows: true,
        processedRows: true,
        createdAt: true,
        finishedAt: true,
        errorMessage: true,
        resultJson: true,
      },
    }),
  ),

  byId: canImport.input(z.object({ id: zUuid })).query(async ({ input }) => {
    const j = await prisma.importJob.findFirst({
      where: { id: input.id, deletedAt: null },
      select: {
        id: true,
        entity: true,
        status: true,
        fileName: true,
        headersJson: true,
        previewJson: true,
        mappingJson: true,
        resultJson: true,
        totalRows: true,
        processedRows: true,
        createdAt: true,
        finishedAt: true,
        errorMessage: true,
        dedupStrategy: true,
      },
    });
    if (!j) throw new TRPCError({ code: 'NOT_FOUND' });
    return j;
  }),

  confirm: canImport
    .input(
      z.object({
        id: zUuid,
        mapping: z.record(z.string(), z.number().int().min(0)),
        strategy: z.nativeEnum(ImportDedupStrategy).default('IGNORE_DUPLICATES'),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const job = await prisma.importJob.findFirst({
        where: { id: input.id, status: ImportStatus.PENDING, deletedAt: null },
      });
      if (!job) throw new TRPCError({ code: 'NOT_FOUND' });

      // Valida que campos obrigatórios estão no mapping
      const fields = IMPORT_FIELDS[job.entity];
      const missing = fields.filter((f) => f.required && !(f.name in input.mapping));
      if (missing.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Mapeie os campos obrigatórios: ${missing.map((m) => m.label).join(', ')}`,
        });
      }

      await prisma.importJob.update({
        where: { id: input.id },
        data: {
          status: ImportStatus.MAPPED,
          mappingJson: input.mapping as Prisma.InputJsonValue,
          dedupStrategy: input.strategy,
        },
      });

      const queue = makeQueue<ImportRunJobData>(QUEUE_NAMES.importRun);
      await queue.add('run', { importJobId: input.id }, { attempts: 2 });

      await audit({
        action: 'import.confirm',
        tableName: 'import_jobs',
        recordId: input.id,
        after: { entity: job.entity, strategy: input.strategy },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });

      return { ok: true };
    }),

  cancel: canImport.input(z.object({ id: zUuid })).mutation(async ({ input, ctx }) => {
    await prisma.importJob.update({
      where: { id: input.id },
      data: { deletedAt: new Date() },
    });
    await audit({
      action: 'import.cancel',
      tableName: 'import_jobs',
      recordId: input.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      tenantIdOverride: ctx.tenantId,
    });
    return { ok: true };
  }),
});
