'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';

interface Props {
  opportunityId: string;
  onConfirmed?: () => void;
}

interface ProposedTask {
  title: string;
  dueDate: string | null;
  assigneeHint: string | null;
  selected: boolean;
}

interface EditableSummary {
  themes: string[];
  adjustments: string[];
  decisions: string[];
}

export function CommunicationIntake({ opportunityId, onConfirmed }: Props) {
  const [rawText, setRawText] = useState('');
  const [summary, setSummary] = useState<EditableSummary | null>(null);
  const [tasks, setTasks] = useState<ProposedTask[]>([]);
  const [aiFailed, setAiFailed] = useState(false);

  const summarize = trpc.activities.summarize.useMutation({
    onSuccess: (data) => {
      if (!data.aiGenerated) {
        setAiFailed(true);
        setSummary({ themes: [], adjustments: [], decisions: [] });
        setTasks([]);
        return;
      }
      setAiFailed(false);
      setSummary({
        themes: data.themes,
        adjustments: data.adjustments,
        decisions: data.decisions,
      });
      setTasks(
        data.nextSteps.map((t) => ({
          title: t.title,
          dueDate: t.dueDate,
          assigneeHint: t.assigneeHint,
          selected: true,
        })),
      );
    },
  });

  const confirm = trpc.activities.confirmSummary.useMutation({
    onSuccess: () => {
      setRawText('');
      setSummary(null);
      setTasks([]);
      onConfirmed?.();
    },
  });

  if (!summary) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold">Receptor de comunicações</h3>
        <p className="mb-3 text-xs text-neutral-600">
          Cole o e-mail ou WhatsApp aqui. A IA gera um resumo em 4 blocos + sugere
          tarefas. PII é mascarada antes de ir para o provedor.
        </p>
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={6}
          placeholder="Cole o texto da comunicação…"
          className="mb-3 w-full rounded border px-3 py-2 text-sm"
        />
        <Button
          type="button"
          disabled={rawText.length < 10 || summarize.isLoading}
          onClick={() => summarize.mutate({ opportunityId, text: rawText })}
        >
          {summarize.isLoading ? 'Processando…' : 'Resumir com IA'}
        </Button>
        {summarize.error && (
          <p className="mt-2 text-sm text-red-600">{summarize.error.message}</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Resumo gerado pela IA</h3>
        <button
          type="button"
          onClick={() => setSummary(null)}
          className="text-xs text-neutral-600 hover:text-neutral-900"
        >
          ← Voltar para o texto
        </button>
      </div>

      {aiFailed && (
        <p className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-800">
          IA indisponível no momento. Você pode editar manualmente e confirmar.
        </p>
      )}

      <BlockList
        label="Temas"
        items={summary.themes}
        onChange={(items) => setSummary({ ...summary, themes: items })}
      />
      <BlockList
        label="Ajustes"
        items={summary.adjustments}
        onChange={(items) => setSummary({ ...summary, adjustments: items })}
      />
      <BlockList
        label="Decisões"
        items={summary.decisions}
        onChange={(items) => setSummary({ ...summary, decisions: items })}
      />

      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-700">
          Próximos passos sugeridos
        </p>
        {tasks.length === 0 ? (
          <p className="text-xs text-neutral-500">Nenhuma tarefa sugerida.</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((t, i) => (
              <li key={i} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={t.selected}
                  onChange={(e) =>
                    setTasks(
                      tasks.map((x, idx) =>
                        idx === i ? { ...x, selected: e.target.checked } : x,
                      ),
                    )
                  }
                  className="mt-1"
                />
                <div className="flex-1 space-y-1">
                  <input
                    value={t.title}
                    onChange={(e) =>
                      setTasks(
                        tasks.map((x, idx) =>
                          idx === i ? { ...x, title: e.target.value } : x,
                        ),
                      )
                    }
                    className="w-full rounded border px-2 py-1 text-sm"
                  />
                  <div className="flex gap-2 text-xs">
                    <input
                      type="date"
                      value={t.dueDate ?? ''}
                      onChange={(e) =>
                        setTasks(
                          tasks.map((x, idx) =>
                            idx === i ? { ...x, dueDate: e.target.value || null } : x,
                          ),
                        )
                      }
                      className="rounded border px-2 py-1"
                    />
                    {t.assigneeHint && (
                      <span className="text-neutral-500">sugerido: {t.assigneeHint}</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button
          type="button"
          disabled={confirm.isLoading}
          onClick={() =>
            confirm.mutate({
              opportunityId,
              rawText,
              summary,
              confirmedTasks: tasks
                .filter((t) => t.selected && t.title.length >= 2)
                .map((t) => ({
                  title: t.title,
                  dueDate: t.dueDate ? new Date(t.dueDate) : null,
                })),
            })
          }
        >
          {confirm.isLoading ? 'Salvando…' : 'Confirmar e criar tarefas'}
        </Button>
      </div>
    </div>
  );
}

function BlockList({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  return (
    <div className="mb-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-700">
        {label}
      </p>
      {items.length === 0 && <p className="text-xs text-neutral-400">Nenhum item</p>}
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-2">
            <input
              value={it}
              onChange={(e) =>
                onChange(items.map((x, idx) => (idx === i ? e.target.value : x)))
              }
              className="w-full rounded border px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              className="text-neutral-400 hover:text-red-600"
              aria-label={`Remover ${label} ${i + 1}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onChange([...items, ''])}
        className="mt-1 text-xs text-neutral-600 hover:text-neutral-900"
      >
        + adicionar
      </button>
    </div>
  );
}
