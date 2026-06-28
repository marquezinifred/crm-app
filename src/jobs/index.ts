/**
 * Entry point dos workers BullMQ.
 * Rodar: `npm run worker`
 *
 * Sobe:
 *   - alerts-scan worker (executa o gerador de alertas)
 *   - email-send worker (despacha e-mails via Resend)
 *   - Um job recorrente diário às 07:00 BRT que enfileira o scan
 */
import { makeQueue, QUEUE_NAMES, type AlertsScanJobData } from './queues';
import { startAlertsScanWorker } from './alerts-scan.worker';
import { startEmailSendWorker } from './email-send.worker';
import { startImportRunWorker } from './import-run.worker';

async function main() {
  const scanWorker = startAlertsScanWorker();
  const emailWorker = startEmailSendWorker();
  const importWorker = startImportRunWorker();

  scanWorker.on('failed', (job, err) =>
    console.error(`[alerts-scan] job ${job?.id} falhou:`, err.message),
  );
  emailWorker.on('failed', (job, err) =>
    console.error(`[email-send] job ${job?.id} falhou:`, err.message),
  );
  importWorker.on('failed', (job, err) =>
    console.error(`[import-run] job ${job?.id} falhou:`, err.message),
  );

  // Agenda repeatable job diário às 07:00 (timezone BRT)
  const scanQueue = makeQueue<AlertsScanJobData>(QUEUE_NAMES.alertsScan);
  await scanQueue.add(
    'daily-scan',
    {},
    {
      repeat: { pattern: '0 7 * * *', tz: 'America/Sao_Paulo' },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  );

  console.info('[workers] alerts-scan + email-send + import-run rodando · scan diário 07:00 BRT');

  // Shutdown gracioso
  const shutdown = async () => {
    console.info('[workers] desligando...');
    await Promise.all([scanWorker.close(), emailWorker.close(), importWorker.close()]);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[workers] falha no boot:', err);
  process.exit(1);
});
