'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { brl } from '@/lib/utils/hooks';

const STATUS_COLORS = {
  PENDING: 'bg-warning-bg text-warning-text',
  APPROVED: 'bg-success-bg text-success-text',
  REJECTED: 'bg-red-100 text-red-800',
  CHANGES_REQUESTED: 'bg-info-bg text-info-text',
} as const;

export function ProposalsSection({ opportunityId }: { opportunityId: string }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.proposals.listByOpportunity.useQuery({ opportunityId });
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('Proposta comercial');
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [versionForm, setVersionForm] = useState({
    totalValue: '',
    marginPct: '',
    summary: '',
  });

  const createProposal = trpc.proposals.create.useMutation({
    onSuccess: () => {
      setShowCreate(false);
      setTitle('Proposta comercial');
      utils.proposals.listByOpportunity.invalidate({ opportunityId });
    },
  });

  const addVersion = trpc.proposals.addVersion.useMutation({
    onSuccess: () => {
      setAddingTo(null);
      setVersionForm({ totalValue: '', marginPct: '', summary: '' });
      utils.proposals.listByOpportunity.invalidate({ opportunityId });
    },
  });

  if (isLoading) return null;

  return (
    <section className="mb-4 rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-1">
          Propostas ({data?.length ?? 0})
        </h2>
        <Button type="button" size="sm" variant="outline" onClick={() => setShowCreate(true)}>
          + Nova proposta
        </Button>
      </div>

      {showCreate && (
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            createProposal.mutate({ opportunityId, title });
          }}
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 rounded border px-2 py-1 text-sm"
          />
          <Button type="submit" size="sm" disabled={createProposal.isPending}>
            Criar
          </Button>
        </form>
      )}

      {data && data.length === 0 && (
        <p className="text-sm text-text-2">Nenhuma proposta. Crie a primeira.</p>
      )}

      <ul className="space-y-3">
        {data?.map((p) => (
          <li key={p.id} className="rounded border border-border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{p.title}</h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAddingTo(addingTo === p.id ? null : p.id)}
              >
                {addingTo === p.id ? 'Fechar' : '+ Nova versão'}
              </Button>
            </div>

            {addingTo === p.id && (
              <form
                className="mb-3 space-y-2 rounded border border-border bg-page p-3 text-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  addVersion.mutate({
                    proposalId: p.id,
                    totalValue: Number(versionForm.totalValue),
                    marginPct: versionForm.marginPct ? Number(versionForm.marginPct) : null,
                    contentJson: { summary: versionForm.summary },
                  });
                }}
              >
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    <span className="mb-0.5 block text-xs">Valor total (R$)</span>
                    <input
                      required
                      type="number"
                      min="0"
                      step="100"
                      value={versionForm.totalValue}
                      onChange={(e) => setVersionForm({ ...versionForm, totalValue: e.target.value })}
                      className="w-full rounded border px-2 py-1"
                    />
                  </label>
                  <label>
                    <span className="mb-0.5 block text-xs">Margem (%)</span>
                    <input
                      type="number"
                      step="0.1"
                      value={versionForm.marginPct}
                      onChange={(e) => setVersionForm({ ...versionForm, marginPct: e.target.value })}
                      className="w-full rounded border px-2 py-1"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="mb-0.5 block text-xs">Sumário da versão</span>
                  <textarea
                    rows={2}
                    value={versionForm.summary}
                    onChange={(e) => setVersionForm({ ...versionForm, summary: e.target.value })}
                    className="w-full rounded border px-2 py-1"
                  />
                </label>
                <Button type="submit" size="sm" disabled={addVersion.isPending}>
                  {addVersion.isPending ? 'Salvando…' : 'Salvar versão'}
                </Button>
                {addVersion.data?.approvals.rulesMatched ? (
                  <p className="text-xs text-warning-text">
                    {addVersion.data.approvals.approvalsCreated} aprovação(ões) criada(s)
                    {addVersion.data.approvals.noApproverFor.length > 0 &&
                      ` · ⚠ sem aprovador para: ${addVersion.data.approvals.noApproverFor.join(', ')}`}
                  </p>
                ) : null}
              </form>
            )}

            <ul className="space-y-1.5 text-sm">
              {p.versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 border-t border-border pt-2">
                  <div>
                    <p>
                      <span className="font-medium">v{v.version}</span> · {brl(Number(v.totalValue))}
                      {v.marginPct != null && ` · margem ${Number(v.marginPct)}%`}
                    </p>
                    <p className="text-xs text-text-2">
                      {new Date(v.createdAt).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {v.approvals.length === 0 ? (
                      <span className="rounded bg-hover px-2 py-0.5 text-xs text-text-2">
                        sem regra aplicável
                      </span>
                    ) : (
                      v.approvals.map((a) => (
                        <span
                          key={a.id}
                          className={`rounded px-2 py-0.5 text-xs ${STATUS_COLORS[a.status]}`}
                        >
                          {a.approver?.role}: {a.status}
                        </span>
                      ))
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
