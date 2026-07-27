'use client';

import { trpc } from '@/lib/trpc/client';
import { TransferStatus } from '@prisma/client';

/**
 * Sprint 15G.5 Fase 3a — histórico de transferências de uma opp (P-87).
 *
 * `historyForOpportunity` é gated por `opportunity:transfer`: quem não tem a
 * permission (ex.: o dono ANALISTA) recebe FORBIDDEN. Nesse caso escondemos a
 * seção — a página NUNCA quebra pro dono. Com permissão mas sem transfers,
 * também escondemos (não polui). Espelha o layout de "Histórico de estágios".
 */

const STATUS_LABEL: Record<TransferStatus, string> = {
  [TransferStatus.PENDING]: 'Pendente',
  [TransferStatus.APPROVED]: 'Aprovada',
  [TransferStatus.REJECTED]: 'Recusada',
  [TransferStatus.CANCELLED]: 'Cancelada',
  [TransferStatus.TIMED_OUT]: 'Expirada',
};

export function TransferHistorySection({ opportunityId }: { opportunityId: string }) {
  const history = trpc.opportunityTransfers.historyForOpportunity.useQuery(
    { opportunityId },
    { retry: false },
  );

  // Sem permission → FORBIDDEN → esconde (não quebra a página pro dono).
  if (history.error) return null;
  const rows = history.data ?? [];
  if (rows.length === 0) return null;

  return (
    <section className="mb-4 rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-1">
        Histórico de transferências
      </h2>
      <ol className="space-y-3">
        {rows.map((t) => (
          <li key={t.id} className="border-l-2 border-border pl-3 text-sm">
            <p className="text-xs text-text-2">
              {new Date(t.requestedAt).toLocaleString('pt-BR')} ·{' '}
              <span className="font-medium">{STATUS_LABEL[t.status] ?? t.status}</span>
            </p>
            <p className="text-text-1">
              {t.requestedBy?.fullName ?? '—'} → {t.targetManager?.fullName ?? '—'}
              {t.newOwner ? ` · novo responsável: ${t.newOwner.fullName}` : ''}
            </p>
            {t.reason && <p className="text-text-2">Motivo: {t.reason}</p>}
            {t.decisionReason && <p className="text-text-2">Decisão: {t.decisionReason}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
