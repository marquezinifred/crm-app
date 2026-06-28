'use client';

import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { brl } from '@/lib/utils/hooks';

export default function ContractsPage() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.contractsConfig.activeContracts.useQuery();
  const renew = trpc.contractsConfig.renew.useMutation({
    onSuccess: ({ newOpportunityId }) => {
      utils.contractsConfig.activeContracts.invalidate();
      window.location.href = `/pipeline/${newOpportunityId}`;
    },
  });
  const handoff = trpc.contractsConfig.dispatchHandoff.useMutation({
    onSuccess: () => alert('Handoff enviado.'),
  });

  if (isLoading) return <main className="p-6">Carregando…</main>;

  return (
    <main className="mx-auto max-w-4xl p-4 md:p-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Contratos ativos</h1>
        <a href="/admin/contracts" className="text-sm text-neutral-600 hover:underline">
          Configurar handoff →
        </a>
      </header>

      {data && data.length === 0 && (
        <p className="rounded border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
          Nenhum contrato ativo no momento.
        </p>
      )}

      <ul className="space-y-3">
        {data?.map((c) => {
          const totalInstallments = c.installments.length;
          const paid = c.installments.filter((i) => i.status === 'PAID').length;
          return (
            <li key={c.id} className="rounded-lg border border-neutral-200 bg-white p-4">
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-medium">{c.opportunity.title}</h2>
                  <p className="text-xs text-neutral-600">
                    {c.opportunity.clientCompany.razaoSocial} · {c.number ?? 'sem nº'} · status {c.status}
                  </p>
                </div>
                <p className="text-lg font-semibold">{brl(Number(c.totalValue))}</p>
              </div>
              <div className="mb-3 grid grid-cols-2 gap-3 text-xs text-neutral-700 md:grid-cols-4">
                <span>Início: {c.startDate ? new Date(c.startDate).toLocaleDateString('pt-BR') : '—'}</span>
                <span>Fim: {c.endDate ? new Date(c.endDate).toLocaleDateString('pt-BR') : '—'}</span>
                <span>Parcelas: {paid}/{totalInstallments}</span>
                <span>NDA: {c.ndaSignedAt ? 'sim' : 'não'}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/pipeline/${c.opportunityId}`}
                  className="rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                >
                  Abrir oportunidade
                </a>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={handoff.isPending}
                  onClick={() => handoff.mutate({ contractId: c.id })}
                >
                  Reenviar handoff
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={renew.isPending}
                  onClick={() => renew.mutate({ contractId: c.id })}
                >
                  Renovar
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
