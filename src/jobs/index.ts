/**
 * Entry point dos workers BullMQ.
 * Rodar: `npm run worker`
 *
 * Sobe (Sprint 15B):
 *   - alerts-scan  — gerador de alertas (07:00 BRT)
 *   - email-send   — despacha e-mails via Resend
 *   - import-run   — roda importação CSV/XLSX (Sprint 9)
 *   - ai-usage-rollup     — agrega ai_usage_logs em ai_usage_daily (00:30 BRT)
 *   - health-score-rollup — snapshot diário de tenant_health (02:00 BRT)
 */
import { makeQueue, QUEUE_NAMES, type AlertsScanJobData } from './queues';
import { startAlertsScanWorker } from './alerts-scan.worker';
import { startEmailSendWorker } from './email-send.worker';
import { startImportRunWorker } from './import-run.worker';
import {
  startAiUsageRollupWorker,
  type AiUsageRollupJobData,
} from './ai-usage-rollup.worker';
import {
  startHealthScoreRollupWorker,
  type HealthScoreRollupJobData,
} from './health-score-rollup.worker';
// Sprint 15D — captura de leads inbound
import { startInboundLeadCreateWorker } from './inbound-lead-create.worker';

async function main() {
  const scanWorker = startAlertsScanWorker();
  const emailWorker = startEmailSendWorker();
  const importWorker = startImportRunWorker();
  const aiRollupWorker = startAiUsageRollupWorker();
  const healthRollupWorker = startHealthScoreRollupWorker();
  const inboundLeadWorker = startInboundLeadCreateWorker();

  scanWorker.on('failed', (job, err) =>
    console.error(`[alerts-scan] job ${job?.id} falhou:`, err.message),
  );
  emailWorker.on('failed', (job, err) =>
    console.error(`[email-send] job ${job?.id} falhou:`, err.message),
  );
  importWorker.on('failed', (job, err) =>
    console.error(`[import-run] job ${job?.id} falhou:`, err.message),
  );
  aiRollupWorker.on('failed', (job, err) =>
    console.error(`[ai-usage-rollup] job ${job?.id} falhou:`, err.message),
  );
  healthRollupWorker.on('failed', (job, err) =>
    console.error(`[health-score-rollup] job ${job?.id} falhou:`, err.message),
  );
  inboundLeadWorker.on('failed', (job, err) =>
    console.error(`[inbound-lead-create] job ${job?.id} falhou:`, err.message),
  );

  // Agendamentos diários (BRT)
  const scanQueue = makeQueue<AlertsScanJobData>(QUEUE_NAMES.alertsScan);
  await scanQueue.add('daily-scan', {}, {
    repeat: { pattern: '0 7 * * *', tz: 'America/Sao_Paulo' },
    removeOnComplete: 100,
    removeOnFail: 200,
  });

  const aiRollupQueue = makeQueue<AiUsageRollupJobData>(QUEUE_NAMES.aiUsageRollup);
  await aiRollupQueue.add('daily-rollup', {}, {
    repeat: { pattern: '30 0 * * *', tz: 'America/Sao_Paulo' },
    removeOnComplete: 100,
    removeOnFail: 200,
  });

  const healthRollupQueue = makeQueue<HealthScoreRollupJobData>(
    QUEUE_NAMES.healthScoreRollup,
  );
  await healthRollupQueue.add('daily-health', {}, {
    repeat: { pattern: '0 2 * * *', tz: 'America/Sao_Paulo' },
    removeOnComplete: 100,
    removeOnFail: 200,
  });

  console.info(
    '[workers] alerts-scan + email-send + import-run + ai-usage-rollup + health-score-rollup + inbound-lead-create rodando',
  );
  console.info('[workers] crons: scan 07:00 BRT · ai-rollup 00:30 BRT · health-rollup 02:00 BRT');

  // Shutdown gracioso
  const shutdown = async () => {
    console.info('[workers] desligando...');
    await Promise.all([
      scanWorker.close(),
      emailWorker.close(),
      importWorker.close(),
      aiRollupWorker.close(),
      healthRollupWorker.close(),
      inboundLeadWorker.close(),
    ]);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[workers] falha no boot:', err);
  process.exit(1);
});
