'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { brl, initials } from '@/lib/utils/hooks';
import { formatBRLInput, unformatBRLInput } from '@/lib/utils/format';
import { STAGES, STAGE_LABELS } from '@/components/pipeline/types';
import { STAGE_INTENT_LABEL } from '@/lib/constants/pipeline-stages';
import { CommunicationIntake } from '@/components/pipeline/CommunicationIntake';
import { DocumentsSection } from '@/components/pipeline/DocumentsSection';
import { ProposalsSection } from '@/components/pipeline/ProposalsSection';
import { TasksSection } from '@/components/pipeline/TasksSection';
import { TransferBadge } from '@/components/transfers/TransferBadge';
import { TransferActionButton } from '@/components/transfers/TransferActionButton';
import { CancelTransferButton } from '@/components/transfers/CancelTransferButton';
import { TransferHistorySection } from '@/components/transfers/TransferHistorySection';
import { useToast } from '@/components/ui/toast';
import { ErrorState } from '@/components/ui/empty-state';
import { OpportunityLossReason } from '@prisma/client';

export default function OpportunityDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const { data: opp, isLoading, error, refetch } = trpc.opportunities.byId.useQuery({ id: params.id });
  const { data: me } = trpc.users.me.useQuery();

  const [showCancel, setShowCancel] = useState(false);
  const [cancelForm, setCancelForm] = useState({ reason: '', lossReason: '' as string });
  const [editStageFields, setEditStageFields] = useState<Record<string, string>>({});

  const update = trpc.opportunities.update.useMutation({
    onSuccess: () => {
      utils.opportunities.byId.invalidate({ id: params.id });
      setEditStageFields({});
      toast({ kind: 'success', title: 'Alterações salvas.' });
    },
    onError: (err) => toast({ kind: 'error', title: friendlyTrpcError(err) }),
  });
  const advance = trpc.opportunities.advanceStage.useMutation({
    onSuccess: () => {
      utils.opportunities.byId.invalidate({ id: params.id });
      setEditStageFields({});
      toast({ kind: 'success', title: 'Estágio avançado.' });
    },
    onError: (err) => toast({ kind: 'error', title: friendlyTrpcError(err) }),
  });
  const cancel = trpc.opportunities.cancel.useMutation({
    onSuccess: () => {
      utils.opportunities.byId.invalidate({ id: params.id });
      router.push('/pipeline');
    },
    onError: (err) => toast({ kind: 'error', title: friendlyTrpcError(err) }),
  });

  if (isLoading) return <main className="p-6">Carregando…</main>;
  if (error) {
    // P-95 — nunca renderizar o erro Zod/TRPC cru na tela.
    const notFound = error.data?.code === 'NOT_FOUND';
    return (
      <main className="p-6">
        <ErrorState
          title={notFound ? 'Oportunidade não encontrada.' : 'Algo saiu errado.'}
          description={
            notFound
              ? 'Ela pode ter sido removida ou o link está incorreto.'
              : friendlyTrpcError(error)
          }
          onRetry={notFound ? undefined : () => void refetch()}
        />
      </main>
    );
  }
  if (!opp) return null;

  const currentIdx = STAGES.indexOf(opp.stage);
  const next = STAGES[currentIdx + 1];
  const prev = STAGES[currentIdx - 1];

  // Sprint 15G.5 Fase 3a — transferência PENDING congela a edição da opp
  // (fonte da verdade é o guard 2c; a UI só reflete + explica). `activeTransfer`
  // já vem flag-gated do byId (T16 — null no rollback), então `frozen` some
  // sozinho quando a flag desliga.
  const activeTransfer = opp.activeTransfer;
  const frozen = activeTransfer != null;
  const iAmRequester =
    activeTransfer != null && me?.id != null && me.id === activeTransfer.requestedById;

  return (
    <main className="mx-auto max-w-4xl p-4 md:p-6">
      <button
        type="button"
        onClick={() => router.back()}
        className="mb-3 text-sm text-text-2 hover:text-text-1"
      >
        ← Voltar
      </button>

      <header className="mb-4 rounded-lg border border-border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{opp.title}</h1>
            <p className="text-sm text-text-2">{opp.clientCompany.razaoSocial}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold">{brl(Number(opp.estimatedValue ?? 0))}</p>
            <p className="text-xs text-text-2">{STAGE_LABELS[opp.stage]} · {opp.status}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm">
          {opp.owner ? (
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-hover text-xs font-medium">
                {initials(opp.owner.fullName)}
              </span>
              <span>{opp.owner.fullName}</span>
            </div>
          ) : (
            <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs text-warning-text">
              Aguardando alocação
            </span>
          )}
          {opp.partnerCompany && (
            <span className="rounded-full bg-info-bg px-2 py-0.5 text-xs text-info-text">
              Parceiro: {opp.partnerCompany.razaoSocial}
            </span>
          )}
          {opp.team.length > 0 && (
            <span className="text-xs text-text-2">+{opp.team.length} no time</span>
          )}
        </div>

        {activeTransfer ? (
          <div className="mt-4 rounded-md border border-warning bg-warning-bg/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <TransferBadge toName={activeTransfer.toName} />
              {iAmRequester && (
                <CancelTransferButton
                  transferId={activeTransfer.transferId}
                  opportunityId={opp.id}
                />
              )}
            </div>
            <p className="mt-2 text-xs text-warning-text">
              Edição bloqueada enquanto a transferência estiver pendente.
            </p>
          </div>
        ) : (
          opp.status === 'ACTIVE' && (
            <div className="mt-4">
              <TransferActionButton opportunityId={opp.id} />
            </div>
          )
        )}

        {opp.status === 'ACTIVE' && !frozen && (
          <div className="mt-4 flex flex-wrap gap-2">
            {prev && (
              <button
                type="button"
                onClick={() =>
                  advance.mutate({ id: opp.id, fromStage: opp.stage, toStage: prev })
                }
                className="rounded border border-border-strong px-3 py-1.5 text-sm"
              >
                ← Voltar para {STAGE_LABELS[prev]}
              </button>
            )}
            {next && (
              <button
                type="button"
                onClick={() =>
                  advance.mutate({ id: opp.id, fromStage: opp.stage, toStage: next })
                }
                className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white"
              >
                Avançar para {STAGE_LABELS[next]} →
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowCancel(true)}
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-danger"
            >
              Cancelar oportunidade
            </button>
          </div>
        )}

        {advance.error && (
          <p className="mt-3 rounded bg-warning-bg p-2 text-sm text-warning-text">
            {friendlyTrpcError(advance.error)}
          </p>
        )}
      </header>

      <section className="mb-4 rounded-lg border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-text-1">
          {STAGE_INTENT_LABEL[opp.stage]}
        </h2>
        <p className="mb-3 text-xs text-text-3">
          Estágio: {STAGE_LABELS[opp.stage]}
        </p>
        <StageFields
          opp={opp}
          edits={editStageFields}
          setEdits={setEditStageFields}
          disabled={frozen}
        />
        {!frozen && Object.keys(editStageFields).length > 0 && (
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditStageFields({})}
              className="rounded border border-border-strong px-3 py-1.5 text-sm"
            >
              Descartar
            </button>
            <button
              type="button"
              onClick={() =>
                update.mutate({
                  id: opp.id,
                  ...coerceFields(editStageFields),
                })
              }
              className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white"
            >
              Salvar alterações
            </button>
          </div>
        )}
      </section>

      <section className="mb-4">
        <CommunicationIntake
          opportunityId={opp.id}
          stageHasDirtyChanges={Object.keys(editStageFields).length > 0}
          onConfirmed={() => utils.opportunities.byId.invalidate({ id: opp.id })}
        />
      </section>

      <TasksSection opportunityId={opp.id} />

      <ActivitiesTimeline opportunityId={opp.id} />

      <ProposalsSection opportunityId={opp.id} />

      <DocumentsSection opportunityId={opp.id} />

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-1">
          Histórico de estágios
        </h2>
        <ol className="space-y-2">
          {opp.stageHistory.map((h) => (
            <li key={h.id} className="text-sm">
              <span className="text-text-2">
                {new Date(h.at).toLocaleString('pt-BR')}
              </span>{' '}
              — {h.fromStage ? `${STAGE_LABELS[h.fromStage]} → ` : ''}
              <span className="font-medium">{STAGE_LABELS[h.toStage]}</span>
              {h.note && <span className="text-text-2"> · {h.note}</span>}
            </li>
          ))}
        </ol>
      </section>

      <TransferHistorySection opportunityId={opp.id} />

      {showCancel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowCancel(false)}
        >
          <div
            className="max-w-md rounded-lg bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 text-base font-semibold">Cancelar oportunidade</h2>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Motivo</span>
              <select
                value={cancelForm.lossReason}
                onChange={(e) => setCancelForm({ ...cancelForm, lossReason: e.target.value })}
                className="mb-2 w-full rounded border px-3 py-2"
              >
                <option value="">Selecione…</option>
                {Object.values(OpportunityLossReason).map((r) => (
                  <option key={r} value={r}>
                    {r.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </select>
              <textarea
                placeholder="Justificativa (obrigatória)"
                value={cancelForm.reason}
                onChange={(e) => setCancelForm({ ...cancelForm, reason: e.target.value })}
                rows={3}
                className="w-full rounded border px-3 py-2"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCancel(false)}
                className="rounded border border-border-strong px-3 py-1.5 text-sm"
              >
                Fechar
              </button>
              <button
                type="button"
                disabled={cancelForm.reason.length < 3}
                onClick={() =>
                  cancel.mutate({
                    id: opp.id,
                    reason: cancelForm.reason,
                    lossReason: (cancelForm.lossReason || undefined) as never,
                  })
                }
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                Confirmar cancelamento
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function StageFields({
  opp,
  edits,
  setEdits,
  disabled = false,
}: {
  opp: { stage: string; meetingScheduledAt: Date | null; meetingHappened: boolean | null; briefing: string | null; estimatedValue: unknown; expectedCloseDate: Date | null; proposalPresentedAt: Date | null; decisionExpectedAt: Date | null; acceptedAt: Date | null };
  edits: Record<string, string>;
  setEdits: (e: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const v = (k: string, fallback: unknown): string => {
    if (k in edits) return edits[k]!;
    if (fallback instanceof Date) return fallback.toISOString().slice(0, 16);
    return fallback != null ? String(fallback) : '';
  };
  const set = (k: string, val: string) => setEdits({ ...edits, [k]: val });

  switch (opp.stage) {
    case 'LEAD':
      return (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label>
            <span className="mb-1 block font-medium">Reunião agendada para</span>
            <input
              type="datetime-local"
              value={v('meetingScheduledAt', opp.meetingScheduledAt)}
              onChange={(e) => set('meetingScheduledAt', e.target.value)}
              disabled={disabled}
              className="w-full rounded border px-2 py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
          <label>
            <span className="mb-1 block font-medium">Reunião aconteceu?</span>
            <select
              value={v('meetingHappened', opp.meetingHappened)}
              onChange={(e) => set('meetingHappened', e.target.value)}
              disabled={disabled}
              className="w-full rounded border px-2 py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">—</option>
              <option value="true">Sim</option>
              <option value="false">Não</option>
            </select>
          </label>
        </div>
      );
    case 'OPORTUNIDADE':
      return (
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block font-medium">Briefing detalhado</span>
            <textarea
              rows={4}
              value={v('briefing', opp.briefing)}
              onChange={(e) => set('briefing', e.target.value)}
              disabled={disabled}
              className="w-full rounded border px-2 py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="mb-1 block font-medium">Valor estimado (R$)</span>
              <input
                type="text"
                inputMode="decimal"
                value={formatBRLInput(v('estimatedValue', opp.estimatedValue))}
                onChange={(e) => set('estimatedValue', formatBRLInput(e.target.value))}
                disabled={disabled}
                className="w-full rounded border px-2 py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
            <label>
              <span className="mb-1 block font-medium">Data prevista de fechamento</span>
              <input
                type="date"
                value={v('expectedCloseDate', opp.expectedCloseDate)?.slice(0, 10)}
                onChange={(e) => set('expectedCloseDate', e.target.value)}
                disabled={disabled}
                className="w-full rounded border px-2 py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
          </div>
        </div>
      );
    case 'PROPOSTA':
      return (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label>
            <span className="mb-1 block font-medium">Data de apresentação</span>
            <input
              type="date"
              value={v('proposalPresentedAt', opp.proposalPresentedAt)?.slice(0, 10)}
              onChange={(e) => set('proposalPresentedAt', e.target.value)}
              disabled={disabled}
              className="w-full rounded border px-2 py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
          <label>
            <span className="mb-1 block font-medium">Decisão esperada em</span>
            <input
              type="date"
              value={v('decisionExpectedAt', opp.decisionExpectedAt)?.slice(0, 10)}
              onChange={(e) => set('decisionExpectedAt', e.target.value)}
              disabled={disabled}
              className="w-full rounded border px-2 py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
        </div>
      );
    case 'ACEITE':
      return (
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Data do aceite do cliente</span>
          <input
            type="datetime-local"
            value={v('acceptedAt', opp.acceptedAt)}
            onChange={(e) => set('acceptedAt', e.target.value)}
            disabled={disabled}
            className="w-full rounded border px-2 py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
      );
    default:
      return (
        <p className="text-sm text-text-2">
          Sem campos específicos para este estágio. Use a barra de ações para avançar ou voltar.
        </p>
      );
  }
}

function ActivitiesTimeline({ opportunityId }: { opportunityId: string }) {
  const activities = trpc.activities.list.useQuery({ opportunityId });

  return (
    <section className="mb-4 rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-1">
        Linha do tempo
      </h2>
      {activities.data && activities.data.length === 0 && (
        <p className="text-sm text-text-2">Sem atividades registradas.</p>
      )}
      <ol className="space-y-3">
        {activities.data?.map((a) => (
          <li key={a.id} className="border-l-2 border-border pl-3">
            <p className="text-xs text-text-2">
              {new Date(a.occurredAt).toLocaleString('pt-BR')} · {a.type}
              {a.author && ` · ${a.author.fullName}`}
            </p>
            {a.title && <p className="text-sm font-medium">{a.title}</p>}
            <p className="whitespace-pre-line text-sm text-text-1">{a.content}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function coerceFields(edits: Record<string, string>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(edits)) {
    if (v === '') {
      out[k] = null;
    } else if (k === 'meetingHappened') {
      out[k] = v === 'true';
    } else if (k === 'estimatedValue') {
      out[k] = unformatBRLInput(v);
    } else if (['meetingScheduledAt', 'acceptedAt'].includes(k)) {
      out[k] = new Date(v);
    } else if (['expectedCloseDate', 'proposalPresentedAt', 'decisionExpectedAt'].includes(k)) {
      out[k] = new Date(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
