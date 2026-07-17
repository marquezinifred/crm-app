'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { Button } from '@/components/ui/button';
import { brl } from '@/lib/utils/hooks';
import { PageHeader } from '@/components/layout/PageHeader';
import { useToast } from '@/components/ui/toast';

export default function ApprovalsPage() {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const { data, isLoading, error } = trpc.approvals.myPending.useQuery();
  const decide = trpc.approvals.decide.useMutation({
    onSuccess: () => utils.approvals.myPending.invalidate(),
    onError: (err) => toast({ kind: 'error', title: friendlyTrpcError(err) }),
  });
  const [comments, setComments] = useState<Record<string, string>>({});

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Aprovações"
        description="Propostas aguardando sua decisão."
        meta={data && `${data.length} pendente${data.length === 1 ? '' : 's'}`}
      />

      {isLoading && <p className="text-sm text-text-2">Carregando…</p>}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {friendlyTrpcError(error)}
        </p>
      )}
      {data && data.length === 0 && (
        <p className="rounded border border-dashed border-border-strong p-6 text-center text-sm text-text-2">
          Nada pendente para você.
        </p>
      )}

      <ul className="space-y-3">
        {data?.map((a) => (
          <li key={a.id} className="rounded-lg border border-border bg-card p-4">
            <header className="mb-2">
              <h2 className="font-medium">
                {a.proposalVersion.proposal.opportunity.title}
              </h2>
              <p className="text-xs text-text-2">
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
                className="text-info-text hover:underline"
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
    </div>
  );
}
