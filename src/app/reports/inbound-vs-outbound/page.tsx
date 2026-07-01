'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { formatBRL, formatBRLCompact } from '@/lib/utils/format';
import { STAGE_LABELS } from '@/components/pipeline/types';

/**
 * /reports/inbound-vs-outbound — Sprint 15D.
 *
 * Funis lado a lado (inbound / outbound), conversion rate, ticket médio
 * e cycle time por origem. Filtros: from/to. Export Excel reusa o
 * endpoint /api/v1/reports/export (Sprint 5).
 */
export default function InboundVsOutboundPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filters = {
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  };

  const q = trpc.reports.inboundVsOutbound.useQuery(filters);

  return (
    <main className="mx-auto max-w-5xl p-4 md:p-6">
      <PageHeader
        title="Inbound × Outbound"
        description="Compare o funil, conversion rate e ticket médio de leads que chegaram automaticamente contra os prospectados manualmente."
      />

      <section className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-text-2">De</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-text-2">Até</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input"
          />
        </label>
      </section>

      {q.isLoading && <p className="text-sm text-text-2">Carregando…</p>}
      {q.error && (
        <p className="rounded-lg border border-danger bg-danger-bg p-3 text-sm text-danger-text">
          {q.error.message}
        </p>
      )}

      {q.data && (
        <>
          {/* KPIs comparativos */}
          <section className="mb-6 grid gap-3 md:grid-cols-3">
            <ComparisonCard
              label="Conversion rate"
              inbound={`${q.data.conversion.inbound.winRatePct.toFixed(1)}%`}
              outbound={`${q.data.conversion.outbound.winRatePct.toFixed(1)}%`}
              inboundSub={`${q.data.conversion.inbound.won}/${q.data.conversion.inbound.won + q.data.conversion.inbound.lost} decididos`}
              outboundSub={`${q.data.conversion.outbound.won}/${q.data.conversion.outbound.won + q.data.conversion.outbound.lost} decididos`}
            />
            <ComparisonCard
              label="Ticket médio (ganhas)"
              inbound={
                q.data.ticket.inboundCount > 0
                  ? formatBRLCompact(q.data.ticket.inboundAvgBrl)
                  : '—'
              }
              outbound={
                q.data.ticket.outboundCount > 0
                  ? formatBRLCompact(q.data.ticket.outboundAvgBrl)
                  : '—'
              }
              inboundSub={`${q.data.ticket.inboundCount} ganha${q.data.ticket.inboundCount === 1 ? '' : 's'}`}
              outboundSub={`${q.data.ticket.outboundCount} ganha${q.data.ticket.outboundCount === 1 ? '' : 's'}`}
              inboundTooltip={
                q.data.ticket.inboundCount > 0 ? formatBRL(q.data.ticket.inboundAvgBrl) : undefined
              }
              outboundTooltip={
                q.data.ticket.outboundCount > 0 ? formatBRL(q.data.ticket.outboundAvgBrl) : undefined
              }
            />
            <ComparisonCard
              label="Tempo de ciclo"
              inbound={
                q.data.cycleTime.inboundAvgDays !== null
                  ? `${q.data.cycleTime.inboundAvgDays}d`
                  : '—'
              }
              outbound={
                q.data.cycleTime.outboundAvgDays !== null
                  ? `${q.data.cycleTime.outboundAvgDays}d`
                  : '—'
              }
              inboundSub={`${q.data.cycleTime.inboundCount} fechada${q.data.cycleTime.inboundCount === 1 ? '' : 's'}`}
              outboundSub={`${q.data.cycleTime.outboundCount} fechada${q.data.cycleTime.outboundCount === 1 ? '' : 's'}`}
            />
          </section>

          {/* Funis lado a lado */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-1">
              Funil comparativo (opps ativas)
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              <FunnelColumn
                title="Inbound"
                accent="text-brand-primary"
                stages={q.data.funnel.map((f) => ({
                  stage: f.stage,
                  count: f.inboundCount,
                  value: f.inboundValue,
                }))}
              />
              <FunnelColumn
                title="Outbound"
                accent="text-text-2"
                stages={q.data.funnel.map((f) => ({
                  stage: f.stage,
                  count: f.outboundCount,
                  value: f.outboundValue,
                }))}
              />
            </div>
            {q.data.total === 0 && (
              <p className="mt-3 text-center text-sm text-text-2">
                Ainda sem oportunidades no período. Envie um lead teste pelo webhook em
                /admin/email-inbound.
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}

// ═════════════════════════════════════════════════════════════════
// Componentes auxiliares (puros)
// ═════════════════════════════════════════════════════════════════

interface ComparisonCardProps {
  label: string;
  inbound: string;
  outbound: string;
  inboundSub: string;
  outboundSub: string;
  inboundTooltip?: string;
  outboundTooltip?: string;
}
function ComparisonCard(props: ComparisonCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="mb-2 text-xs font-medium uppercase text-text-2">{props.label}</p>
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-[10px] uppercase text-text-3">Inbound</dt>
          <dd
            className="text-h3 tabular-nums text-brand-primary"
            title={props.inboundTooltip}
          >
            {props.inbound}
          </dd>
          <p className="text-[11px] text-text-3">{props.inboundSub}</p>
        </div>
        <div>
          <dt className="text-[10px] uppercase text-text-3">Outbound</dt>
          <dd className="text-h3 tabular-nums text-text-1" title={props.outboundTooltip}>
            {props.outbound}
          </dd>
          <p className="text-[11px] text-text-3">{props.outboundSub}</p>
        </div>
      </dl>
    </div>
  );
}

interface FunnelStageEntry {
  stage: keyof typeof STAGE_LABELS;
  count: number;
  value: number;
}
interface FunnelColumnProps {
  title: string;
  accent: string;
  stages: FunnelStageEntry[];
}
function FunnelColumn({ title, accent, stages }: FunnelColumnProps) {
  const maxCount = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div>
      <p className={`mb-2 text-xs font-semibold uppercase ${accent}`}>{title}</p>
      <ul className="space-y-1.5">
        {stages.map((s) => {
          const widthPct = Math.round((s.count / maxCount) * 100);
          return (
            <li key={s.stage} className="flex items-center gap-2 text-sm">
              <span className="w-24 shrink-0 text-xs text-text-2">
                {STAGE_LABELS[s.stage] ?? s.stage}
              </span>
              <div className="flex flex-1 items-center gap-2">
                <div className="h-4 flex-1 overflow-hidden rounded bg-hover">
                  <div
                    className="h-full bg-brand-primary/60"
                    style={{ width: `${widthPct}%` }}
                    aria-hidden="true"
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-text-1">
                  {s.count}
                </span>
              </div>
              {s.value > 0 && (
                <span
                  className="w-16 shrink-0 text-right text-xs tabular-nums text-text-3"
                  title={formatBRL(s.value)}
                >
                  {formatBRLCompact(s.value)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <dl className="sr-only">
        {stages.map((s) => (
          <div key={s.stage}>
            <dt>{STAGE_LABELS[s.stage] ?? s.stage}</dt>
            <dd>
              {s.count} oportunidades, valor total {formatBRL(s.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
