'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Select, Textarea } from '@/components/ui/input';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { formatBRL, formatBRLCompact } from '@/lib/utils/format';

/**
 * /inbox/transferencias-recebidas — Sprint 15G.5 Fase 3b.
 *
 * Fila do gestor destinatário: transferências de oportunidade PENDING onde
 * ele é o `target_manager`. Consome `opportunityTransfers.pendingForMe`
 * (query sem input). Cada card mostra a opp (título/valor/empresa), o
 * disparador, o dono original, o motivo e o prazo restante — com destaque
 * quando perto do timeout.
 *
 * Ações:
 *  - Aceitar → sub-modal com Select do novo owner (populado por
 *    `newOwnerCandidates` — já é a subárvore do destinatário; o Select nunca
 *    oferece alguém que o `approve` rejeitaria via `canReceiveAsNewOwner`) +
 *    motivo opcional → `approve`.
 *  - Rejeitar → modal com motivo opcional → `reject`.
 *
 * Kill-switch (T3): `pendingForMe` é gateada por `assertFeatureEnabled()` no
 * backend. Flag OFF → FORBIDDEN → a tela degrada pra ErrorState. `retry:
 * false` evita re-tentativas inúteis num FORBIDDEN.
 */

type PendingTransfer = NonNullable<
  ReturnType<typeof usePendingForMe>['data']
>[number];

function usePendingForMe() {
  return trpc.opportunityTransfers.pendingForMe.useQuery(undefined, {
    retry: false,
    staleTime: 30_000,
  });
}

type Decision = { mode: 'approve' | 'reject'; transfer: PendingTransfer } | null;

export default function TransferenciasRecebidasPage() {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const query = usePendingForMe();
  const transfers = useMemo(() => query.data ?? [], [query.data]);

  const [decision, setDecision] = useState<Decision>(null);
  const [newOwnerId, setNewOwnerId] = useState('');
  const [reasonText, setReasonText] = useState('');

  // Só busca candidatos quando o modal de aceite abre. A subárvore é a mesma
  // pra todos os transfers (é do destinatário), então uma query basta.
  const candidatesQuery = trpc.opportunityTransfers.newOwnerCandidates.useQuery(
    undefined,
    { enabled: decision?.mode === 'approve', staleTime: 30_000 },
  );

  function closeDecision() {
    setDecision(null);
    setNewOwnerId('');
    setReasonText('');
  }

  const approve = trpc.opportunityTransfers.approve.useMutation({
    onSuccess: () => {
      toast({ title: 'Transferência aceita.', description: 'A oportunidade foi atribuída ao novo responsável.', kind: 'success' });
      utils.opportunityTransfers.pendingForMe.invalidate();
      closeDecision();
    },
    onError: (err) =>
      toast({ title: 'Não foi possível aceitar.', description: friendlyTrpcError(err), kind: 'error' }),
  });

  const reject = trpc.opportunityTransfers.reject.useMutation({
    onSuccess: () => {
      toast({ title: 'Transferência recusada.', description: 'A oportunidade permanece com o disparador.', kind: 'success' });
      utils.opportunityTransfers.pendingForMe.invalidate();
      closeDecision();
    },
    onError: (err) =>
      toast({ title: 'Não foi possível recusar.', description: friendlyTrpcError(err), kind: 'error' }),
  });

  function openApprove(transfer: PendingTransfer) {
    setNewOwnerId('');
    setReasonText('');
    setDecision({ mode: 'approve', transfer });
  }
  function openReject(transfer: PendingTransfer) {
    setReasonText('');
    setDecision({ mode: 'reject', transfer });
  }

  function submitApprove() {
    if (!decision || decision.mode !== 'approve' || !newOwnerId) return;
    approve.mutate({
      transferId: decision.transfer.id,
      newOwnerId,
      decisionReason: reasonText.trim() || undefined,
    });
  }
  function submitReject() {
    if (!decision || decision.mode !== 'reject') return;
    reject.mutate({
      transferId: decision.transfer.id,
      decisionReason: reasonText.trim() || undefined,
    });
  }

  const candidates = candidatesQuery.data ?? [];

  return (
    <main className="mx-auto max-w-3xl p-4 md:p-6">
      <PageHeader
        title={`Transferências recebidas${transfers.length > 0 ? ` (${transfers.length})` : ''}`}
        description="Oportunidades que outro gestor quer passar pra sua equipe. Aceite escolhendo um responsável da sua subárvore, ou recuse — o prazo aparece em cada card."
      />

      {query.isLoading && <p className="text-sm text-text-2">Carregando fila…</p>}

      {query.error && (
        <ErrorState
          title="Não foi possível carregar as transferências."
          description={friendlyTrpcError(query.error)}
          onRetry={() => query.refetch()}
        />
      )}

      {query.data && transfers.length === 0 && (
        <EmptyState
          title="Sem transferências aguardando você."
          description="Fila limpa. Quando outro gestor solicitar uma transferência pra sua equipe, ela aparece aqui."
        />
      )}

      <ul className="space-y-3">
        {transfers.map((t) => {
          const expiry = expiryInfo(new Date(t.expiresAt));
          const value = t.opportunity.estimatedValue != null ? Number(t.opportunity.estimatedValue) : null;
          return (
            <li key={t.id} className="rounded-lg border border-border bg-card p-4">
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h2 className="text-h4 text-text-1">{t.opportunity.title}</h2>
                  {t.opportunity.clientCompany && (
                    <p className="mt-0.5 text-sm text-text-2">
                      {t.opportunity.clientCompany.razaoSocial}
                    </p>
                  )}
                </div>
                <span
                  className={
                    'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ' +
                    (expiry.urgency === 'danger'
                      ? 'bg-danger-bg text-danger-text'
                      : expiry.urgency === 'warning'
                        ? 'bg-warning-bg text-warning-text'
                        : 'bg-hover text-text-2')
                  }
                  title={`Prazo: ${new Date(t.expiresAt).toLocaleString('pt-BR')}`}
                >
                  {expiry.label}
                </span>
              </div>

              {value != null && (
                <div className="mb-2 text-sm">
                  <span className="tabular-nums text-brand-accent" title={formatBRL(value)}>
                    {formatBRLCompact(value)}
                  </span>
                  <span className="text-text-3"> · valor estimado</span>
                </div>
              )}

              <dl className="mb-3 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex gap-1.5">
                  <dt className="text-text-3">Solicitado por:</dt>
                  <dd className="text-text-2">{t.requestedBy.fullName}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-text-3">Dono atual:</dt>
                  <dd className="text-text-2">{t.originalOwner.fullName}</dd>
                </div>
                <div className="flex gap-1.5 sm:col-span-2">
                  <dt className="text-text-3">Recebida:</dt>
                  <dd className="text-text-2">{relativeTime(new Date(t.requestedAt))}</dd>
                </div>
              </dl>

              {t.reason && (
                <p className="mb-3 rounded border border-border bg-hover/40 p-2 text-sm text-text-2">
                  <span className="text-text-3">Motivo: </span>
                  {t.reason}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" size="sm" onClick={() => openApprove(t)}>
                  Aceitar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => openReject(t)}>
                  Rejeitar
                </Button>
                <a
                  href={`/pipeline/${t.opportunity.id}`}
                  className="ml-auto text-sm text-text-2 hover:text-brand-primary hover:underline"
                >
                  Ver oportunidade →
                </a>
              </div>
            </li>
          );
        })}
      </ul>

      {decision?.mode === 'approve' && (
        <Modal
          open
          onClose={closeDecision}
          title="Aceitar transferência"
          description={`Escolha quem da sua equipe assume "${decision.transfer.opportunity.title}". O estágio da oportunidade é preservado.`}
        >
          <div className="space-y-4">
            <Field label="Novo responsável" required>
              <Select
                value={newOwnerId}
                onChange={(e) => setNewOwnerId(e.target.value)}
                disabled={candidatesQuery.isLoading}
                aria-label="Novo responsável"
              >
                <option value="">
                  {candidatesQuery.isLoading ? 'Carregando…' : 'Selecione um responsável'}
                </option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName} — {c.role}
                  </option>
                ))}
              </Select>
            </Field>

            {candidatesQuery.data && candidates.length === 0 && (
              <p className="text-sm text-warning-text">
                Sua subárvore não tem ninguém disponível pra receber. Cadastre ou
                ative um membro na estrutura comercial antes de aceitar.
              </p>
            )}

            <Field label="Motivo (opcional)">
              <Textarea
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="Contexto da decisão, se quiser registrar."
                rows={3}
              />
            </Field>
          </div>

          <ModalFooter>
            <Button variant="ghost" onClick={closeDecision} disabled={approve.isPending}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={submitApprove}
              disabled={!newOwnerId || approve.isPending}
              loading={approve.isPending}
            >
              Aceitar transferência
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {decision?.mode === 'reject' && (
        <Modal
          open
          onClose={closeDecision}
          title="Rejeitar transferência"
          description={`A oportunidade "${decision.transfer.opportunity.title}" continua com ${decision.transfer.originalOwner.fullName}.`}
        >
          <div className="space-y-4">
            <Field label="Motivo (opcional)">
              <Textarea
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="Explique por que está recusando, se quiser."
                rows={3}
              />
            </Field>
          </div>

          <ModalFooter>
            <Button variant="ghost" onClick={closeDecision} disabled={reject.isPending}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={submitReject}
              disabled={reject.isPending}
              loading={reject.isPending}
            >
              Rejeitar transferência
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </main>
  );
}

/** Prazo restante até o timeout, com nível de urgência pro destaque visual. */
function expiryInfo(expiresAt: Date): {
  label: string;
  urgency: 'ok' | 'warning' | 'danger';
} {
  const ms = expiresAt.getTime() - Date.now();
  if (ms <= 0) return { label: 'Prazo expirado', urgency: 'danger' };
  const hours = ms / 3_600_000;
  const label =
    hours < 1
      ? `Expira em ${Math.max(1, Math.round(ms / 60_000))}min`
      : hours < 24
        ? `Expira em ${Math.round(hours)}h`
        : `Expira em ${Math.round(hours / 24)}d`;
  const urgency = hours < 12 ? 'danger' : hours < 24 ? 'warning' : 'ok';
  return { label, urgency };
}

function relativeTime(d: Date): string {
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `há ${days}d`;
  return d.toLocaleDateString('pt-BR');
}
