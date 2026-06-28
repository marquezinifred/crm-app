'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { brl } from '@/lib/utils/hooks';

export default function ApprovalsPage() {
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.approvals.myPending.useQuery();
  const decide = trpc.approvals.decide.useMutation({
    onSuccess: () => utils.approvals.myPending.invalidate(),
  });
  const [comments, setComments] = useState<Record<string, string>>({});

  return (
    <main className="mx-auto max-w-3xl p-4 md:p-6">
      <h1 className="mb-1 text-2xl font-bold">Aprovações pendentes</h1>
      <p className="mb-4 text-sm text-neutral-600">
        Propostas aguardando sua decisão.
      </p>

      {isLoading && <p className="text-sm text-neutral-600">Carregando…</p>}
      {error && <p className="text-sm text-red-600">{error.message}</p>}
      {data && data.length === 0 && (
        <p className="rounded border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
          Nada pendente para você.
        </p>
      )}

      <ul className="space-y-3">
        {data?.map((a) => (
          <li key={a.id} className="rounded-lg border border-neutral-200 bg-white p-4">
            <header className="mb-2">
              <h2 className="font-medium">
                {a.proposalVersion.proposal.opportunity.title}
              </h2>
              <p className="text-xs text-neutral-600">
                {a.proposalVersion.proposal.opportunity.clientCompany.razaoSocial} ·{' '}
                {a.proposalVersion.proposal.title} · v{a.proposalVersion.version}
              </p>
            </header>

            <div className="mb-3 flex flex-wrap gap-3 text-sm">
              <span>
                <strong>{brl(Number(a.proposalVersion.totalValue))}</strong>
              </span>
              {a.proposalVersion.marginPct != null && (
                <span>margem {Number(a.proposalVersion.marginPct)}%</span>
              )}
              <a
                href={`/pipeline/${a.proposalVersion.proposal.opportunity.id}`}
                className="text-blue-700 hover:underline"
              >
                abrir oportunidade →
              </a>
            </div>

            <textarea
              value={comments[a.id] ?? ''}
              onChange={(e) => setComments({ ...comments, [a.id]: e.target.value })}
              placeholder="Comentário (opcional para aprovar; obrigatório para rejeitar)"
              rows={2}
              className="mb-2 w-full rounded border px-2 py-1 text-sm"
            />

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  decide.mutate({
                    id: a.id,
                    decision: 'APPROVED',
                    comment: comments[a.id] || undefined,
                  })
                }
              >
                Aprovar
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  decide.mutate({
                    id: a.id,
                    decision: 'CHANGES_REQUESTED',
                    comment: comments[a.id] || undefined,
                  })
                }
              >
                Solicitar mudanças
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={!comments[a.id] || comments[a.id]!.length < 3}
                onClick={() =>
                  decide.mutate({
                    id: a.id,
                    decision: 'REJECTED',
                    comment: comments[a.id] || undefined,
                  })
                }
              >
                Reprovar
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
