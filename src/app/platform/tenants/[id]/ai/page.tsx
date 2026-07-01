'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, THead, TBody, TH, TR, TD, TableEmpty } from '@/components/ui/table';
import { formatBRL, formatBRLCompact } from '@/lib/utils/format';

/**
 * Drilldown de uso de IA por tenant — P-06 tela 1.
 *
 * Consome `platform.aiOps.byTenant({id})` — limites configurados, uso do mês,
 * breakdown por (provider, model), últimos 90 dias e anomalias detectadas.
 * Edição de limites via `platform.aiOps.setLimits`; resolução de anomalias
 * via `platform.aiOps.acknowledgeAlert`.
 */
export default function PlatformTenantAiPage({
  params,
}: {
  params: { id: string };
}) {
  const utils = trpc.useUtils();
  const tenantQ = trpc.platform.tenantById.useQuery({ id: params.id });
  const opsQ = trpc.platform.aiOps.byTenant.useQuery({ id: params.id });

  const setLimits = trpc.platform.aiOps.setLimits.useMutation({
    onSuccess: () => utils.platform.aiOps.byTenant.invalidate({ id: params.id }),
  });
  const ack = trpc.platform.aiOps.acknowledgeAlert.useMutation({
    onSuccess: () => utils.platform.aiOps.byTenant.invalidate({ id: params.id }),
  });

  const [form, setForm] = useState({
    monthlyTokenLimit: '',
    dailyRequestLimit: '',
    pinnedModelHaiku: '',
    pinnedModelSonnet: '',
    anomalyThresholdMultiplier: '3',
  });

  useEffect(() => {
    if (opsQ.data?.limits) {
      setForm({
        monthlyTokenLimit:
          opsQ.data.limits.monthlyTokenLimit != null
            ? opsQ.data.limits.monthlyTokenLimit.toString()
            : '',
        dailyRequestLimit:
          opsQ.data.limits.dailyRequestLimit != null
            ? opsQ.data.limits.dailyRequestLimit.toString()
            : '',
        pinnedModelHaiku: opsQ.data.limits.pinnedModelHaiku ?? '',
        pinnedModelSonnet: opsQ.data.limits.pinnedModelSonnet ?? '',
        anomalyThresholdMultiplier:
          opsQ.data.limits.anomalyThresholdMultiplier?.toString() ?? '3',
      });
    }
  }, [opsQ.data?.limits]);

  if (tenantQ.isLoading || opsQ.isLoading) {
    return (
      <div className="space-y-3">
        <div className="skeleton h-8 w-1/2" />
        <div className="skeleton h-4 w-1/3" />
      </div>
    );
  }
  if (tenantQ.error || !tenantQ.data) {
    return (
      <p role="alert" className="text-body text-danger">
        {tenantQ.error?.message ?? 'Tenant não encontrado.'}
      </p>
    );
  }
  if (opsQ.error || !opsQ.data) {
    return (
      <p role="alert" className="text-body text-danger">
        {opsQ.error?.message ?? 'Falha ao carregar uso de IA.'}
      </p>
    );
  }

  const { tenant } = tenantQ.data;
  const { limits, monthlyUsage, breakdown, recentDaily, anomalies } = opsQ.data;

  const monthlyLimitNum = limits?.monthlyTokenLimit
    ? Number(limits.monthlyTokenLimit)
    : null;
  const monthlyPct =
    monthlyLimitNum && monthlyLimitNum > 0
      ? Math.min(100, (monthlyUsage.tokens / monthlyLimitNum) * 100)
      : null;

  const maxBreakdownTokens = breakdown.reduce((m, b) => Math.max(m, b.tokens), 0) || 1;
  const maxDailyTokens = recentDaily.reduce(
    (m, d) => Math.max(m, Number(d.tokensInput) + Number(d.tokensOutput)),
    0,
  ) || 1;

  const submitLimits = () => {
    setLimits.mutate({
      tenantId: params.id,
      monthlyTokenLimit: form.monthlyTokenLimit.trim() === '' ? null : Number(form.monthlyTokenLimit),
      dailyRequestLimit: form.dailyRequestLimit.trim() === '' ? null : Number(form.dailyRequestLimit),
      pinnedModelHaiku: form.pinnedModelHaiku.trim() === '' ? null : form.pinnedModelHaiku.trim(),
      pinnedModelSonnet:
        form.pinnedModelSonnet.trim() === '' ? null : form.pinnedModelSonnet.trim(),
      anomalyThresholdMultiplier: Number(form.anomalyThresholdMultiplier) || 3,
    });
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <nav aria-label="Trilha" className="text-caption text-text-2">
        <Link
          href={`/platform/tenants/${tenant.id}`}
          className="underline hover:text-text-1"
        >
          ← Voltar para {tenant.name}
        </Link>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1">IA · {tenant.name}</h1>
          <p className="text-caption text-text-2 font-mono mt-1">{tenant.slug}</p>
          <div className="flex gap-2 mt-2">
            <Badge variant="primary">{tenant.plan}</Badge>
          </div>
        </div>
        <Link href={`/platform/tenants/${tenant.id}/ai/features`}>
          <Button variant="secondary">Gerenciar Features IA →</Button>
        </Link>
      </header>

      {/* Card A — limites vs uso */}
      <section className="rounded-md border border-border bg-card p-5">
        <h2 className="text-h3 mb-4">Limites e uso do mês</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <MetricTile
            label="Tokens consumidos"
            value={monthlyUsage.tokens.toLocaleString('pt-BR')}
            hint={
              monthlyLimitNum
                ? `de ${monthlyLimitNum.toLocaleString('pt-BR')} (${monthlyPct?.toFixed(0)}%)`
                : 'sem limite configurado'
            }
          />
          <MetricTile
            label="Requests"
            value={monthlyUsage.requests.toLocaleString('pt-BR')}
            hint={
              limits?.dailyRequestLimit
                ? `limite diário: ${limits.dailyRequestLimit.toLocaleString('pt-BR')}`
                : 'sem limite diário'
            }
          />
          <MetricTile
            label="Custo estimado"
            value={formatBRLCompact(monthlyUsage.costBrl)}
            hint={formatBRL(monthlyUsage.costBrl)}
            accent
          />
        </div>

        {monthlyPct != null && (
          <div className="mb-5" role="progressbar" aria-valuenow={Math.round(monthlyPct)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-2 bg-hover rounded-full overflow-hidden">
              <div
                className={
                  monthlyPct >= 100
                    ? 'h-full bg-danger'
                    : monthlyPct >= 80
                    ? 'h-full bg-warning'
                    : 'h-full bg-brand-primary'
                }
                style={{ width: `${Math.min(100, monthlyPct)}%` }}
              />
            </div>
          </div>
        )}

        <details className="border-t border-border pt-4">
          <summary className="cursor-pointer text-body font-medium text-text-1">
            Editar limites e models pinados
          </summary>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Limite mensal de tokens">
              <Input
                type="number"
                min="0"
                placeholder="Ex: 5000000"
                value={form.monthlyTokenLimit}
                onChange={(e) =>
                  setForm((f) => ({ ...f, monthlyTokenLimit: e.target.value }))
                }
              />
            </Field>
            <Field label="Limite diário de requests">
              <Input
                type="number"
                min="0"
                placeholder="Ex: 1000"
                value={form.dailyRequestLimit}
                onChange={(e) =>
                  setForm((f) => ({ ...f, dailyRequestLimit: e.target.value }))
                }
              />
            </Field>
            <Field label="Modelo pinado Haiku">
              <Input
                placeholder="claude-haiku-4-5-20251001"
                value={form.pinnedModelHaiku}
                onChange={(e) =>
                  setForm((f) => ({ ...f, pinnedModelHaiku: e.target.value }))
                }
              />
            </Field>
            <Field label="Modelo pinado Sonnet">
              <Input
                placeholder="claude-sonnet-4-6"
                value={form.pinnedModelSonnet}
                onChange={(e) =>
                  setForm((f) => ({ ...f, pinnedModelSonnet: e.target.value }))
                }
              />
            </Field>
            <Field label="Multiplicador de anomalia (× média 7d)">
              <Input
                type="number"
                min="1"
                max="20"
                step="0.1"
                value={form.anomalyThresholdMultiplier}
                onChange={(e) =>
                  setForm((f) => ({ ...f, anomalyThresholdMultiplier: e.target.value }))
                }
              />
            </Field>
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              variant="primary"
              loading={setLimits.isPending}
              onClick={submitLimits}
            >
              Salvar limites
            </Button>
          </div>
          {setLimits.error && (
            <p role="alert" className="mt-2 text-caption text-danger">
              {setLimits.error.message}
            </p>
          )}
          {setLimits.isSuccess && (
            <p className="mt-2 text-caption text-success">Limites atualizados.</p>
          )}
        </details>
      </section>

      {/* Card B — breakdown por provider/model */}
      <section className="rounded-md border border-border bg-card p-5">
        <h2 className="text-h3 mb-4">Breakdown por provider / model (mês)</h2>
        {breakdown.length === 0 ? (
          <p className="text-body text-text-2">Nenhum uso registrado neste mês.</p>
        ) : (
          <div className="space-y-2">
            {breakdown.map((b) => {
              const pct = (b.tokens / maxBreakdownTokens) * 100;
              return (
                <div key={`${b.provider}-${b.model}`} className="grid grid-cols-[180px_1fr_100px] items-center gap-3">
                  <div className="text-caption">
                    <div className="font-medium text-text-1">{b.provider}</div>
                    <div className="text-text-3 font-mono truncate" title={b.model}>{b.model}</div>
                  </div>
                  <div className="relative h-6 bg-hover rounded overflow-hidden">
                    <div
                      className="h-full bg-brand-primary"
                      style={{ width: `${pct}%` }}
                    />
                    <span className="absolute inset-0 flex items-center px-2 text-caption font-mono tabular-nums text-text-1">
                      {b.tokens.toLocaleString('pt-BR')} tk · {b.requests} req
                    </span>
                  </div>
                  <div className="text-right font-mono tabular-nums text-brand-accent" title={formatBRL(b.costBrl)}>
                    {formatBRLCompact(b.costBrl)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Card C — histórico diário (últimos 30) */}
      <section className="rounded-md border border-border bg-card p-5">
        <h2 className="text-h3 mb-4">Histórico diário (últimos 30d)</h2>
        {recentDaily.length === 0 ? (
          <p className="text-body text-text-2">Sem consumo no período.</p>
        ) : (
          <>
            <div
              className="flex items-end gap-1 h-24 border-b border-border pb-1 mb-4"
              aria-hidden="true"
            >
              {recentDaily
                .slice(0, 30)
                .reverse()
                .map((d) => {
                  const total = Number(d.tokensInput) + Number(d.tokensOutput);
                  const h = Math.max(2, (total / maxDailyTokens) * 96);
                  return (
                    <div
                      key={d.id}
                      className="flex-1 min-w-0 bg-brand-primary/70 rounded-t"
                      style={{ height: `${h}px` }}
                      title={`${new Date(d.date).toLocaleDateString('pt-BR')} · ${total.toLocaleString('pt-BR')} tk`}
                    />
                  );
                })}
            </div>
            <Table>
              <THead>
                <tr>
                  <TH>Data</TH>
                  <TH>Provider</TH>
                  <TH>Model</TH>
                  <TH>Reqs</TH>
                  <TH>Tokens</TH>
                  <TH>Custo R$</TH>
                </tr>
              </THead>
              <TBody>
                {recentDaily.slice(0, 30).map((d) => (
                  <TR key={d.id}>
                    <TD className="font-mono text-caption">
                      {new Date(d.date).toLocaleDateString('pt-BR')}
                    </TD>
                    <TD className="text-caption text-text-2">{d.provider}</TD>
                    <TD className="text-caption text-text-3 font-mono">{d.model}</TD>
                    <TD className="font-mono tabular-nums">{d.requestCount}</TD>
                    <TD className="font-mono tabular-nums">
                      {(Number(d.tokensInput) + Number(d.tokensOutput)).toLocaleString('pt-BR')}
                    </TD>
                    <TD className="font-mono tabular-nums text-brand-accent">
                      {formatBRL(Number(d.costBrl))}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </>
        )}
      </section>

      {/* Card D — models pinados */}
      <section className="rounded-md border border-border bg-card p-5">
        <h2 className="text-h3 mb-4">Modelos pinados</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-body">
          <div>
            <dt className="text-label text-text-3">Haiku</dt>
            <dd className="text-text-1 font-mono mt-1">
              {limits?.pinnedModelHaiku ?? <span className="text-text-3 italic">nenhum (usa default)</span>}
            </dd>
          </div>
          <div>
            <dt className="text-label text-text-3">Sonnet</dt>
            <dd className="text-text-1 font-mono mt-1">
              {limits?.pinnedModelSonnet ?? <span className="text-text-3 italic">nenhum (usa default)</span>}
            </dd>
          </div>
        </dl>
      </section>

      {/* Card E — anomalias */}
      <section className="rounded-md border border-border bg-card p-5">
        <h2 className="text-h3 mb-4">Anomalias detectadas (últimas 20)</h2>
        <Table>
          <THead>
            <tr>
              <TH>Tipo</TH>
              <TH>Detalhes</TH>
              <TH>Detectada</TH>
              <TH>Status</TH>
              <TH>Ações</TH>
            </tr>
          </THead>
          <TBody>
            {anomalies.length === 0 && (
              <TableEmpty colSpan={5}>Nenhuma anomalia registrada.</TableEmpty>
            )}
            {anomalies.map((a) => {
              const d = a.details as { today?: number; avg7d?: number; multiplier?: number };
              const done = Boolean(a.acknowledgedAt);
              return (
                <TR key={a.id}>
                  <TD>
                    <Badge variant={done ? 'default' : 'warning'}>{a.type}</Badge>
                  </TD>
                  <TD className="text-caption font-mono text-text-2">
                    hoje {d.today?.toLocaleString('pt-BR') ?? '—'} vs média 7d{' '}
                    {d.avg7d?.toLocaleString('pt-BR') ?? '—'} (× {d.multiplier ?? '—'})
                  </TD>
                  <TD className="text-caption text-text-2">
                    {new Date(a.detectedAt).toLocaleString('pt-BR')}
                  </TD>
                  <TD>
                    {done ? (
                      <Badge variant="success">Reconhecida</Badge>
                    ) : (
                      <Badge variant="warning">Ativa</Badge>
                    )}
                  </TD>
                  <TD>
                    {!done && (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={ack.isPending}
                        onClick={() => ack.mutate({ id: a.id })}
                      >
                        Reconhecer
                      </Button>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </section>
    </div>
  );
}

function MetricTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-page p-4">
      <div className="text-label text-text-3">{label}</div>
      <div
        className={
          accent
            ? 'text-h2 font-mono tabular-nums text-brand-accent mt-1'
            : 'text-h2 font-mono tabular-nums text-text-1 mt-1'
        }
      >
        {value}
      </div>
      {hint && <div className="text-caption text-text-3 mt-1">{hint}</div>}
    </div>
  );
}
