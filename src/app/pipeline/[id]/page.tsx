'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { brl, initials } from '@/lib/utils/hooks';
import { STAGES, STAGE_LABELS } from '@/components/pipeline/types';
import { CommunicationIntake } from '@/components/pipeline/CommunicationIntake';
import { DocumentsSection } from '@/components/pipeline/DocumentsSection';
import { OpportunityLossReason } from '@prisma/client';

export default function OpportunityDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: opp, isLoading, error } = trpc.opportunities.byId.useQuery({ id: params.id });

  const update = trpc.opportunities.update.useMutation({
    onSuccess: () => utils.opportunities.byId.invalidate({ id: params.id }),
  });
  const advance = trpc.opportunities.advanceStage.useMutation({
    onSuccess: () => utils.opportunities.byId.invalidate({ id: params.id }),
  });
  const cancel = trpc.opportunities.cancel.useMutation({
    onSuccess: () => {
      utils.opportunities.byId.invalidate({ id: params.id });
      router.push('/pipeline');
    },
  });

  const [showCancel, setShowCancel] = useState(false);
  const [cancelForm, setCancelForm] = useState({ reason: '', lossReason: '' as string });
  const [editStageFields, setEditStageFields] = useState<Record<string, string>>({});

  if (isLoading) return <main className="p-6">Carregando…</main>;
  if (error) return <main className="p-6 text-red-600">{error.message}</main>;
  if (!opp) return null;

  const currentIdx = STAGES.indexOf(opp.stage);
  const next = STAGES[currentIdx + 1];
  const prev = STAGES[currentIdx - 1];

  return (
    <main className="mx-auto max-w-4xl p-4 md:p-6">
      <button
        type="button"
        onClick={() => router.back()}
        className="mb-3 text-sm text-neutral-600 hover:text-neutral-900"
      >
        ← Voltar
      </button>

      <header className="mb-4 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{opp.title}</h1>
            <p className="text-sm text-neutral-600">{opp.clientCompany.razaoSocial}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold">{brl(Number(opp.estimatedValue ?? 0))}</p>
            <p className="text-xs text-neutral-600">{STAGE_LABELS[opp.stage]} · {opp.status}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-100 text-xs font-medium">
              {initials(opp.owner.fullName)}
            </span>
            <span>{opp.owner.fullName}</span>
          </div>
          {opp.partnerCompany && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
              Parceiro: {opp.partnerCompany.razaoSocial}
            </span>
          )}
          {opp.team.length > 0 && (
            <span className="text-xs text-neutral-600">+{opp.team.length} no time</span>
          )}
        </div>

        {opp.status === 'ACTIVE' && (
          <div className="mt-4 flex flex-wrap gap-2">
            {prev && (
              <button
                type="button"
                onClick={() =>
                  advance.mutate({ id: opp.id, fromStage: opp.stage, toStage: prev })
                }
                className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
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
                className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
              >
                Avançar para {STAGE_LABELS[next]} →
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowCancel(true)}
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700"
            >
              Cancelar oportunidade
            </button>
          </div>
        )}

        {advance.error && (
          <p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-800">
            {advance.error.message}
          </p>
        )}
      </header>

      <section className="mb-4 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-700">
          Campos do estágio atual ({STAGE_LABELS[opp.stage]})
        </h2>
        <StageFields opp={opp} edits={editStageFields} setEdits={setEditStageFields} />
        {Object.keys(editStageFields).length > 0 && (
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditStageFields({})}
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
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
              className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
            >
              Salvar alterações
            </button>
          </div>
        )}
      </section>

      <section className="mb-4">
        <CommunicationIntake opportunityId={opp.id} onConfirmed={() => utils.opportunities.byId.invalidate({ id: opp.id })} />
      </section>

      <ActivitiesAndTasks opportunityId={opp.id} />

      <DocumentsSection opportunityId={opp.id} />

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-700">
          Histórico de estágios
        </h2>
        <ol className="space-y-2">
          {opp.stageHistory.map((h) => (
            <li key={h.id} className="text-sm">
              <span className="text-neutral-500">
                {new Date(h.at).toLocaleString('pt-BR')}
              </span>{' '}
              — {h.fromStage ? `${STAGE_LABELS[h.fromStage]} → ` : ''}
              <span className="font-medium">{STAGE_LABELS[h.toStage]}</span>
              {h.note && <span className="text-neutral-600"> · {h.note}</span>}
            </li>
          ))}
        </ol>
      </section>

      {showCancel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowCancel(false)}
        >
          <div
            className="max-w-md rounded-lg bg-white p-5 shadow-xl"
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
                className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
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
}: {
  opp: { stage: string; meetingScheduledAt: Date | null; meetingHappened: boolean | null; briefing: string | null; estimatedValue: unknown; expectedCloseDate: Date | null; proposalPresentedAt: Date | null; decisionExpectedAt: Date | null; acceptedAt: Date | null };
  edits: Record<string, string>;
  setEdits: (e: Record<string, string>) => void;
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
              className="w-full rounded border px-2 py-1.5"
            />
          </label>
          <label>
            <span className="mb-1 block font-medium">Reunião aconteceu?</span>
            <select
              value={v('meetingHappened', opp.meetingHappened)}
              onChange={(e) => set('meetingHappened', e.target.value)}
              className="w-full rounded border px-2 py-1.5"
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
              className="w-full rounded border px-2 py-1.5"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="mb-1 block font-medium">Valor estimado (R$)</span>
              <input
                type="number"
                value={v('estimatedValue', opp.estimatedValue)}
                onChange={(e) => set('estimatedValue', e.target.value)}
                className="w-full rounded border px-2 py-1.5"
              />
            </label>
            <label>
              <span className="mb-1 block font-medium">Data prevista de fechamento</span>
              <input
                type="date"
                value={v('expectedCloseDate', opp.expectedCloseDate)?.slice(0, 10)}
                onChange={(e) => set('expectedCloseDate', e.target.value)}
                className="w-full rounded border px-2 py-1.5"
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
              className="w-full rounded border px-2 py-1.5"
            />
          </label>
          <label>
            <span className="mb-1 block font-medium">Decisão esperada em</span>
            <input
              type="date"
              value={v('decisionExpectedAt', opp.decisionExpectedAt)?.slice(0, 10)}
              onChange={(e) => set('decisionExpectedAt', e.target.value)}
              className="w-full rounded border px-2 py-1.5"
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
            className="w-full rounded border px-2 py-1.5"
          />
        </label>
      );
    default:
      return (
        <p className="text-sm text-neutral-500">
          Sem campos específicos para este estágio. Use a barra de ações para avançar ou voltar.
        </p>
      );
  }
}

function ActivitiesAndTasks({ opportunityId }: { opportunityId: string }) {
  const activities = trpc.activities.list.useQuery({ opportunityId });
  const tasks = trpc.tasks.list.useQuery({ opportunityId });
  const utils = trpc.useUtils();
  const updateStatus = trpc.tasks.updateStatus.useMutation({
    onSuccess: () => utils.tasks.list.invalidate({ opportunityId }),
  });

  return (
    <>
      <section className="mb-4 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-700">
          Tarefas ({tasks.data?.length ?? 0})
        </h2>
        {tasks.data && tasks.data.length === 0 && (
          <p className="text-sm text-neutral-500">Sem tarefas vinculadas a esta oportunidade.</p>
        )}
        <ul className="space-y-2">
          {tasks.data?.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 rounded border border-neutral-100 p-2 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  checked={t.status === 'DONE'}
                  onChange={(e) =>
                    updateStatus.mutate({ id: t.id, status: e.target.checked ? 'DONE' : 'TODO' })
                  }
                />
                <div className="min-w-0">
                  <p className={t.status === 'DONE' ? 'line-through text-neutral-500' : ''}>{t.title}</p>
                  <p className="text-xs text-neutral-500">
                    {t.assignee?.fullName ?? 'sem responsável'}
                    {t.dueDate && ` · vence ${new Date(t.dueDate).toLocaleDateString('pt-BR')}`}
                  </p>
                </div>
              </div>
              <span className="text-xs uppercase text-neutral-500">{t.priority}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-4 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-700">
          Linha do tempo
        </h2>
        {activities.data && activities.data.length === 0 && (
          <p className="text-sm text-neutral-500">Sem atividades registradas.</p>
        )}
        <ol className="space-y-3">
          {activities.data?.map((a) => (
            <li key={a.id} className="border-l-2 border-neutral-200 pl-3">
              <p className="text-xs text-neutral-500">
                {new Date(a.occurredAt).toLocaleString('pt-BR')} · {a.type}
                {a.author && ` · ${a.author.fullName}`}
              </p>
              {a.title && <p className="text-sm font-medium">{a.title}</p>}
              <p className="whitespace-pre-line text-sm text-neutral-700">{a.content}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
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
      out[k] = Number(v);
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
