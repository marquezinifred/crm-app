'use client';

import { useState } from 'react';
import { TransferStatus } from '@prisma/client';
import { trpc, type RouterOutputs } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { AlertDialog } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/toast';
import { formatBRL, formatRelativeDate } from '@/lib/utils/format';
import {
  TransferStatusBadge,
  transferStatusLabel,
  TRANSFER_STATUS_ORDER,
} from './transfer-status-badge';

/**
 * /pipeline/transferencias-em-andamento — Sprint 15G.5 Fase 3c (P-87).
 *
 * Acompanhamento do DISPARADOR: as transferências que ele iniciou
 * (`opportunityTransfers.myOutgoing`). Filtro por status client-side.
 * Botão "Cancelar" só nas PENDING → AlertDialog → `cancel`.
 *
 * Kill-switch: `myOutgoing` é gateada no backend (flag OFF → FORBIDDEN).
 * A tela degrada graciosamente pelo `ErrorState` (não lê a flag no client).
 */

type TransferRow = RouterOutputs['opportunityTransfers']['myOutgoing'][number];
type StatusFilter = TransferStatus | 'ALL';

function userLabel(u: { fullName: string | null; email: string }): string {
  return u.fullName?.trim() || u.email;
}

export default function OutgoingTransfersPage() {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [cancelFor, setCancelFor] = useState<TransferRow | null>(null);

  const q = trpc.opportunityTransfers.myOutgoing.useQuery();

  const cancel = trpc.opportunityTransfers.cancel.useMutation({
    onSuccess: () => {
      toast({
        kind: 'success',
        title: 'Transferência cancelada.',
        description: 'A oportunidade permanece com você.',
      });
      utils.opportunityTransfers.myOutgoing.invalidate();
      setCancelFor(null);
    },
    onError: (err) => {
      toast({
        kind: 'error',
        title: 'Não foi possível cancelar.',
        description: friendlyTrpcError(err),
      });
      setCancelFor(null);
    },
  });

  const rows = q.data ?? [];
  const filtered =
    statusFilter === 'ALL' ? rows : rows.filter((t) => t.status === statusFilter);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Transferências em andamento"
        description="Acompanhe as transferências de oportunidade que você iniciou."
        meta={q.data ? `${rows.length} transferência(s) no total` : undefined}
      />

      {/* Filtro por status (client-side sobre o resultado). */}
      <div className="mb-5 max-w-xs">
        <Field label="Filtrar por status">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="ALL">Todas</option>
            {TRANSFER_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {transferStatusLabel(s)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {q.error ? (
        <ErrorState
          title="Não foi possível carregar as transferências."
          description={friendlyTrpcError(q.error)}
          onRetry={() => q.refetch()}
        />
      ) : !q.data ? (
        <p className="py-12 text-center text-body text-text-3">Carregando…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Você não iniciou transferências."
          description="Quando transferir uma oportunidade para outra equipe, ela aparecerá aqui para acompanhamento."
        />
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-body text-text-3">
          Nenhuma transferência com o status selecionado.
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((t) => (
            <li key={t.id}>
              <TransferCard transfer={t} onCancel={setCancelFor} />
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={cancelFor !== null}
        onCancel={() => setCancelFor(null)}
        onConfirm={() => {
          if (cancelFor) cancel.mutate({ transferId: cancelFor.id });
        }}
        title="Cancelar transferência?"
        description={
          cancelFor
            ? `A transferência de "${cancelFor.opportunity.title}" será cancelada e a oportunidade permanece com você.`
            : undefined
        }
        confirmLabel="Cancelar transferência"
        cancelLabel="Voltar"
        tone="danger"
        loading={cancel.isPending}
      />
    </div>
  );
}

function TransferCard({
  transfer,
  onCancel,
}: {
  transfer: TransferRow;
  onCancel: (t: TransferRow) => void;
}) {
  const company = transfer.opportunity.clientCompany?.razaoSocial ?? null;
  const value = formatBRL(Number(transfer.opportunity.estimatedValue ?? 0));
  const isPending = transfer.status === TransferStatus.PENDING;

  const timeline: string[] = [
    `Solicitada ${formatRelativeDate(new Date(transfer.requestedAt))}`,
  ];
  if (isPending) {
    timeline.push(`expira ${formatRelativeDate(new Date(transfer.expiresAt))}`);
  } else if (transfer.decidedAt) {
    timeline.push(`decidida ${formatRelativeDate(new Date(transfer.decidedAt))}`);
  }

  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-body font-semibold text-text-1">
            {transfer.opportunity.title}
          </h3>
          {company && <p className="truncate text-caption text-text-3">{company}</p>}
        </div>
        <TransferStatusBadge status={transfer.status} />
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-caption sm:grid-cols-2">
        <InfoRow label="Destino" value={userLabel(transfer.targetManager)} />
        <InfoRow label="Responsável original" value={userLabel(transfer.originalOwner)} />
        {transfer.newOwner && (
          <InfoRow label="Novo responsável" value={userLabel(transfer.newOwner)} />
        )}
        <InfoRow label="Valor estimado" value={value} />
      </dl>

      {transfer.reason && (
        <p className="mt-2 text-caption text-text-2">
          <span className="text-text-3">Motivo: </span>
          {transfer.reason}
        </p>
      )}
      {transfer.decisionReason && (
        <p className="mt-1 text-caption text-text-2">
          <span className="text-text-3">Decisão: </span>
          {transfer.decisionReason}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-caption text-text-3">{timeline.join(' · ')}</span>
        {isPending && (
          <Button
            variant="danger"
            size="sm"
            type="button"
            onClick={() => onCancel(transfer)}
          >
            Cancelar
          </Button>
        )}
      </div>
    </article>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-text-3">{label}:</dt>
      <dd className="min-w-0 truncate text-text-1">{value}</dd>
    </div>
  );
}
