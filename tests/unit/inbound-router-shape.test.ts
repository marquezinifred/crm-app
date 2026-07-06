import { describe, it, expect } from 'vitest';
import { inboundRouter } from '@/server/trpc/routers/inbound';

/**
 * Testes shape do router inbound — garantem que os endpoints exportados
 * batem com o consumo no frontend (/inbox/prospects, /admin/email-inbound).
 * Testes de comportamento (auth, cross-tenant, upsert) rodam via integration.
 */
describe('inboundRouter — shape', () => {
  it('expõe getConfig / updateConfig / regenerateWebhookSecret', () => {
    const proc = inboundRouter._def.procedures as Record<string, unknown>;
    expect(proc.getConfig).toBeDefined();
    expect(proc.updateConfig).toBeDefined();
    expect(proc.regenerateWebhookSecret).toBeDefined();
  });

  it('expõe queueList / queueCount / sellersWithLoad / assignInbound', () => {
    const proc = inboundRouter._def.procedures as Record<string, unknown>;
    expect(proc.queueList).toBeDefined();
    expect(proc.queueCount).toBeDefined();
    expect(proc.sellersWithLoad).toBeDefined();
    expect(proc.assignInbound).toBeDefined();
  });

  it('expõe historyList / rejectedList / rejectedDiscard', () => {
    const proc = inboundRouter._def.procedures as Record<string, unknown>;
    expect(proc.historyList).toBeDefined();
    expect(proc.rejectedList).toBeDefined();
    expect(proc.rejectedDiscard).toBeDefined();
  });

  it('P-30 — expõe rejectedPromote / rejectedRetryParser', () => {
    const proc = inboundRouter._def.procedures as Record<string, unknown>;
    expect(proc.rejectedPromote).toBeDefined();
    expect(proc.rejectedRetryParser).toBeDefined();
  });
});
