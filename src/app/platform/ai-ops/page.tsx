'use client';

import { trpc } from '@/lib/trpc/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, THead, TBody, TH, TR, TD, TableEmpty } from '@/components/ui/table';
import { formatBRL, formatBRLCompact } from '@/lib/utils/format';

export default function PlatformAiOpsPage() {
  const utils = trpc.useUtils();
  const summary = trpc.platform.aiOps.summary.useQuery();
  const ack = trpc.platform.aiOps.acknowledgeAlert.useMutation({
    onSuccess: () => utils.platform.aiOps.summary.invalidate(),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Ops"
        description="Consumo de IA cross-tenant, anomalias e top consumidores do mês."
      />

      {summary.isLoading && <p className="text-body text-text-2">Carregando…</p>}

      {summary.data && (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {summary.data.byProvider.map((p) => (
              <div key={p.provider} className="rounded-md border border-border bg-card p-4">
                <div className="text-label text-text-3">{p.provider}</div>
                <div className="text-h2 font-mono tabular-nums text-text-1 mt-1">
                  {p.tokens.toLocaleString('pt-BR')}
                </div>
                <div className="text-caption text-text-2 mt-1">
                  {p.requests} requests · {formatBRLCompact(p.costBrl)}
                </div>
              </div>
            ))}
          </section>

          <section>
            <h2 className="text-h3 mb-3">Anomalias ativas</h2>
            <Table>
              <THead>
                <tr>
                  <TH>Tenant</TH>
                  <TH>Tipo</TH>
                  <TH>Detalhes</TH>
                  <TH>Quando</TH>
                  <TH>Ações</TH>
                </tr>
              </THead>
              <TBody>
                {summary.data.anomalies.length === 0 && (
                  <TableEmpty colSpan={5}>Nenhuma anomalia ativa. Tudo no esperado.</TableEmpty>
                )}
                {summary.data.anomalies.map((a) => {
                  const d = a.details as { today?: number; avg7d?: number; multiplier?: number };
                  return (
                    <TR key={a.id}>
                      <TD>
                        <span className="font-medium">{a.tenant.name}</span>
                        <span className="block text-caption text-text-3 font-mono">{a.tenant.slug}</span>
                      </TD>
                      <TD><Badge variant="warning">{a.type}</Badge></TD>
                      <TD className="text-caption text-text-2 font-mono">
                        hoje {d.today?.toLocaleString('pt-BR')} vs média 7d {d.avg7d?.toLocaleString('pt-BR')} (× {d.multiplier})
                      </TD>
                      <TD className="text-caption text-text-2">
                        {new Date(a.detectedAt).toLocaleString('pt-BR')}
                      </TD>
                      <TD>
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={ack.isPending}
                          onClick={() => ack.mutate({ id: a.id })}
                        >
                          Reconhecer
                        </Button>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </section>

          <section>
            <h2 className="text-h3 mb-3">Top consumidores do mês</h2>
            <Table>
              <THead>
                <tr>
                  <TH>Tenant</TH>
                  <TH>Plano</TH>
                  <TH>Tokens</TH>
                  <TH>R$</TH>
                </tr>
              </THead>
              <TBody>
                {summary.data.topTenants.map((t) => (
                  <TR key={t.tenantId}>
                    <TD>
                      <span className="font-medium">{t.tenant?.name}</span>
                      <span className="block text-caption text-text-3 font-mono">{t.tenant?.slug}</span>
                    </TD>
                    <TD><Badge variant="default">{t.tenant?.plan}</Badge></TD>
                    <TD className="font-mono tabular-nums text-text-1">{t.tokens.toLocaleString('pt-BR')}</TD>
                    <TD className="font-mono tabular-nums text-brand-accent">
                      <span title={formatBRL(t.costBrl)}>{formatBRLCompact(t.costBrl)}</span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </section>
        </>
      )}
    </div>
  );
}
