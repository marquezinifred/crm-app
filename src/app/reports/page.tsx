'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { brl } from '@/lib/utils/hooks';
import { FunnelChart } from '@/components/reports/FunnelChart';
import { Button } from '@/components/ui/button';
import { STAGE_LABELS } from '@/components/pipeline/types';

export default function ReportsPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [ownerId, setOwnerId] = useState('');

  const users = trpc.users.list.useQuery({ active: true });
  const filters = {
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
    ownerId: ownerId || undefined,
  };

  const funnel = trpc.reports.funnel.useQuery(filters);
  const perf = trpc.reports.performanceByOwner.useQuery(filters);
  const proj = trpc.reports.revenueProjection.useQuery(filters);
  const winLoss = trpc.reports.winLoss.useQuery(filters);

  return (
    <main className="mx-auto max-w-5xl p-4 md:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Relatórios</h1>
        <a
          href="/api/v1/reports/export"
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          ↓ Exportar Excel
        </a>
      </header>

      <section className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-neutral-600">De</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded border px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-neutral-600">Até</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded border px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-neutral-600">Responsável</span>
          <select
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className="rounded border px-2 py-1.5"
          >
            <option value="">Todos</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          onClick={() => {
            setFrom('');
            setTo('');
            setOwnerId('');
          }}
          variant="outline"
        >
          Limpar
        </Button>
      </section>

      <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-700">
          Funil de pipeline
        </h2>
        {funnel.data ? (
          <FunnelChart data={funnel.data} />
        ) : (
          <p className="text-sm text-neutral-600">Carregando…</p>
        )}
      </section>

      <section className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Stat
          label="Projeção base"
          value={proj.data ? brl(proj.data.base) : '—'}
          hint={proj.data ? `worst ${brl(proj.data.worst)} · best ${brl(proj.data.best)}` : ''}
        />
        <Stat
          label="Win rate"
          value={winLoss.data ? `${winLoss.data.winRatePct}%` : '—'}
          hint={
            winLoss.data
              ? `${winLoss.data.won.count} ganhas · ${winLoss.data.lost.count} perdidas`
              : ''
          }
        />
        <Stat
          label="Valor ganho"
          value={winLoss.data ? brl(winLoss.data.won.sumValue) : '—'}
        />
      </section>

      <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-700">
          Performance por responsável
        </h2>
        {perf.data && (
          <>
            {perf.data.anonymized && (
              <p className="mb-2 text-xs text-neutral-500">
                Você está vendo apenas a própria linha + média anônima do time.
              </p>
            )}
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-neutral-500">
                <tr>
                  <th className="py-2">Responsável</th>
                  <th className="text-right">Em aberto</th>
                  <th className="text-right">Ganhas</th>
                  <th className="text-right">Win rate</th>
                  <th className="text-right">Valor ganho</th>
                </tr>
              </thead>
              <tbody>
                {perf.data.rows.map((r) => (
                  <tr key={r.ownerId} className="border-t border-neutral-100">
                    <td className="py-2">{r.ownerName}</td>
                    <td className="text-right">{r.active}</td>
                    <td className="text-right">{r.won}</td>
                    <td className="text-right">{r.winRatePct}%</td>
                    <td className="text-right">{brl(r.wonValue)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-neutral-300 font-medium">
                  <td className="py-2">Média do time</td>
                  <td className="text-right">{perf.data.teamAverage.active}</td>
                  <td className="text-right">{perf.data.teamAverage.won}</td>
                  <td className="text-right">{perf.data.teamAverage.winRatePct}%</td>
                  <td className="text-right">{brl(perf.data.teamAverage.wonValue)}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </section>

      {winLoss.data && winLoss.data.byLossReason.length > 0 && (
        <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-700">
            Motivos de perda
          </h2>
          <ul className="space-y-1 text-sm">
            {winLoss.data.byLossReason.map((r) => (
              <li key={r.reason} className="flex justify-between border-b border-neutral-100 py-1">
                <span>{r.reason.replace(/_/g, ' ').toLowerCase()}</span>
                <span className="text-neutral-600">
                  {r.count} · {brl(r.sumValue)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {proj.data && (
        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-700">
            Projeção por estágio
          </h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="py-2">Estágio</th>
                <th className="text-right">Valor base</th>
                <th className="text-right">Taxa</th>
                <th className="text-right">Ponderado</th>
              </tr>
            </thead>
            <tbody>
              {proj.data.byStage.map((s) => (
                <tr key={s.stage} className="border-t border-neutral-100">
                  <td className="py-2">{STAGE_LABELS[s.stage]}</td>
                  <td className="text-right">{brl(s.base)}</td>
                  <td className="text-right">{s.rate}%</td>
                  <td className="text-right">{brl(s.weightedValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <p className="text-xs text-neutral-600">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}
