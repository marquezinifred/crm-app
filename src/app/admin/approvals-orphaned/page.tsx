'use client';

import { useState } from 'react';
import { trpc, type RouterOutputs } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/input';
import { AlertDialog } from '@/components/ui/alert-dialog';
import { ErrorState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { brl } from '@/lib/utils/hooks';

/**
 * Sprint 15H Bloco A (chip 2a) — /admin/approvals-orphaned
 *
 * Fila das approvals marcadas `ORPHANED` pelo worker de reconcile (P-77).
 * O admin reatribui cada uma a um approver válido (que satisfaz o critério
 * da rule) — a approval volta ao fluxo normal de /approvals do novo
 * responsável. Gated por `approval:reconcile` (leitura) + `approval:reassign`
 * (mutação); backend re-valida.
 */

const REASON_LABEL: Record<string, string> = {
  approver_inactive: 'Aprovador inativo',
  rule_deleted: 'Regra removida',
  rule_disabled: 'Regra desabilitada',
  approver_role_no_longer_matches_rule: 'Perfil não corresponde mais',
  approver_permission_revoked: 'Permissão revogada',
};

function reasonLabel(reason: string | null): string {
  if (!reason) return 'Motivo desconhecido';
  return REASON_LABEL[reason] ?? reason;
}

function reasonVariant(reason: string | null): 'danger' | 'warning' | 'info' {
  if (reason === 'approver_inactive' || reason === 'rule_deleted') return 'danger';
  if (reason === 'rule_disabled') return 'warning';
  if (
    reason === 'approver_role_no_longer_matches_rule' ||
    reason === 'approver_permission_revoked'
  )
    return 'warning';
  return 'info';
}

export default function ApprovalsOrphanedPage() {
  const listQuery = trpc.approvalsReconcile.listOrphaned.useQuery();

  return (
    <main className="mx-auto max-w-5xl p-6">
      <PageHeader
        title="Aprovações órfãs"
        description="Aprovações cujo responsável não satisfaz mais a regra. Reatribua a um aprovador válido."
        meta={listQuery.data && `${listQuery.data.length} órfã${listQuery.data.length === 1 ? '' : 's'}`}
      />

      {listQuery.error && !listQuery.data ? (
        <ErrorState
          title="Não foi possível carregar as aprovações órfãs."
          description={friendlyTrpcError(listQuery.error)}
          onRetry={() => void listQuery.refetch()}
        />
      ) : listQuery.isLoading ? (
        <p className="text-sm text-text-2">Carregando…</p>
      ) : listQuery.data && listQuery.data.length > 0 ? (
        <ul className="space-y-2">
          {listQuery.data.map((row) => (
            <OrphanedRow key={row.id} row={row} />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-2">
          Sem approvals órfãs. Fila limpa.
        </p>
      )}
    </main>
  );
}

type OrphanedApproval = RouterOutputs['approvalsReconcile']['listOrphaned'][number];

function OrphanedRow({ row }: { row: OrphanedApproval }) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState(false);
  const [newApproverId, setNewApproverId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const candidatesQuery = trpc.approvalsReconcile.candidatesForReassign.useQuery(
    { approvalId: row.id },
    { enabled: expanded },
  );

  const reassign = trpc.approvalsReconcile.reassign.useMutation({
    onSuccess: () => {
      toast({ kind: 'success', title: 'Aprovação reatribuída.' });
      utils.approvalsReconcile.listOrphaned.invalidate();
    },
    onError: (err) =>
      toast({ kind: 'error', title: 'Erro ao reatribuir.', description: friendlyTrpcError(err) }),
  });

  const opp = row.proposalVersion.proposal.opportunity;
  const candidates = candidatesQuery.data ?? [];
  const noCandidates = expanded && !candidatesQuery.isLoading && candidates.length === 0;

  return (
    <li className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-start justify-between gap-3 p-3 text-left hover:bg-hover"
        aria-expanded={expanded}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={reasonVariant(row.orphanedReason)}>
              {reasonLabel(row.orphanedReason)}
            </Badge>
            <span className="text-xs tabular-nums text-text-3">
              {brl(Number(row.proposalVersion.totalValue))}
            </span>
            {row.orphanedAt && (
              <span className="text-xs text-text-3">
                {new Date(row.orphanedAt).toLocaleString('pt-BR')}
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-sm font-medium">{opp.title}</p>
          <p className="truncate text-xs text-text-2">
            {opp.clientCompany?.razaoSocial ?? 'Empresa não informada'} ·{' '}
            {row.proposalVersion.proposal.title} · v{row.proposalVersion.version}
          </p>
          <p className="mt-0.5 text-xs text-text-3">
            Aprovador anterior: {row.approver.fullName} ({row.approver.role}
            {row.approver.active ? '' : ', inativo'})
          </p>
        </div>
        <span aria-hidden className="text-text-3">
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border p-3">
          <a
            href={`/pipeline/${opp.id}`}
            className="text-xs text-info-text hover:underline"
          >
            abrir oportunidade →
          </a>

          {candidatesQuery.isLoading ? (
            <p className="mt-3 text-sm text-text-2">Carregando aprovadores…</p>
          ) : noCandidates ? (
            <p className="mt-3 rounded border border-warning bg-warning-bg p-2 text-xs text-warning-text">
              Nenhum aprovador válido para esta regra. Se a regra foi removida ou
              desabilitada, a reatribuição não é possível.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label
                  className="text-xs font-medium uppercase text-text-2"
                  htmlFor={`approver-${row.id}`}
                >
                  Novo aprovador
                </label>
                <Select
                  id={`approver-${row.id}`}
                  value={newApproverId}
                  onChange={(e) => setNewApproverId(e.target.value)}
                >
                  <option value="">Selecione…</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName} ({c.role})
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={!newApproverId || reassign.isPending}
                onClick={() => setConfirmOpen(true)}
              >
                Reatribuir
              </Button>
            </div>
          )}

          <AlertDialog
            open={confirmOpen}
            onCancel={() => setConfirmOpen(false)}
            title="Reatribuir aprovação?"
            description="A aprovação volta a PENDING sob o novo responsável, que a verá na fila de aprovações."
            confirmLabel="Reatribuir"
            tone="primary"
            onConfirm={() => {
              if (newApproverId) {
                reassign.mutate({ approvalId: row.id, newApproverId });
              }
              setConfirmOpen(false);
            }}
          />
        </div>
      )}
    </li>
  );
}
