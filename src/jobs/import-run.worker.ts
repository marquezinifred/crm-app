import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { ImportStatus, Prisma } from '@prisma/client';
import { parseFile } from '@/lib/import/parser';
import { runImport } from '@/server/services/import-engine.service';
import { sendEmail } from '@/server/services/email-sender.service';
import { env } from '@/lib/env';
import { makeWorker, QUEUE_NAMES, type ImportRunJobData } from './queues';

/**
 * Worker BullMQ que processa import_jobs em status MAPPED:
 *   1. Carrega bytes + mapping
 *   2. Re-parseia o arquivo (uso completo, não preview)
 *   3. Roda engine por entidade
 *   4. Persiste resultJson + status DONE
 *   5. Envia e-mail ao createdBy com sumário
 *
 * Em caso de erro, status=FAILED + errorMessage.
 */
export function startImportRunWorker() {
  return makeWorker<ImportRunJobData>(QUEUE_NAMES.importRun, async ({ data }) => {
    await runAsSystem(async () => {
      const job = await prisma.importJob.findUnique({ where: { id: data.importJobId } });
      if (!job || job.status !== ImportStatus.MAPPED) return;

      const start = Date.now();
      try {
        await prisma.importJob.update({
          where: { id: job.id },
          data: { status: ImportStatus.RUNNING },
        });

        const parsed = await parseFile(job.fileName, Buffer.from(job.fileBytes));
        const mapping = (job.mappingJson ?? {}) as Record<string, number>;

        const creator = await prisma.user.findUnique({
          where: { id: job.createdBy },
          select: { email: true, fullName: true },
        });

        const result = await runImport({
          tenantId: job.tenantId,
          entity: job.entity,
          createdBy: job.createdBy,
          mapping,
          headers: parsed.headers,
          rows: parsed.rows,
          strategy: job.dedupStrategy,
          onProgress: async (processed) => {
            await prisma.importJob.update({
              where: { id: job.id },
              data: { processedRows: processed },
            });
          },
        });

        await prisma.importJob.update({
          where: { id: job.id },
          data: {
            status: ImportStatus.DONE,
            resultJson: result as unknown as Prisma.InputJsonValue,
            totalRows: parsed.totalRows,
            processedRows: parsed.rows.length,
            finishedAt: new Date(),
          },
        });

        if (creator?.email) {
          await sendEmail({
            to: creator.email,
            subject: `Importação concluída: ${job.entity.toLowerCase()} (${result.created} criados, ${result.updated} atualizados, ${result.errors.length} erros)`,
            html: `
              <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px;">
                <h2>Importação concluída</h2>
                <p>${creator.fullName ?? ''}, sua importação de <strong>${job.entity}</strong> terminou.</p>
                <ul>
                  <li><strong>${result.created}</strong> criados</li>
                  <li><strong>${result.updated}</strong> atualizados</li>
                  <li><strong>${result.skipped}</strong> ignorados (duplicatas)</li>
                  <li><strong>${result.errors.length}</strong> erros</li>
                </ul>
                <p>Levou ${Math.round((Date.now() - start) / 1000)}s.</p>
                <p><a href="${env.NEXT_PUBLIC_APP_URL}/imports/${job.id}">Ver detalhes</a></p>
              </div>
            `,
          });
        }
      } catch (err) {
        console.error('[import-run] falha', err);
        await prisma.importJob.update({
          where: { id: job.id },
          data: {
            status: ImportStatus.FAILED,
            errorMessage: err instanceof Error ? err.message : 'erro desconhecido',
            finishedAt: new Date(),
          },
        });
      }
    });
  });
}
