'use client';

import * as React from 'react';
import { trpc, type RouterOutputs } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { AlertDialog } from '@/components/ui/alert-dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';

type Task = RouterOutputs['tasks']['list'][number];

type FormState = {
  title: string;
  description: string;
  dueDate: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  assigneeId: string;
};

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  dueDate: '',
  priority: 'MEDIUM',
  assigneeId: '',
};

function taskToForm(t: Task): FormState {
  return {
    title: t.title,
    description: t.description ?? '',
    dueDate: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : '',
    priority: t.priority,
    assigneeId: t.assignee?.id ?? '',
  };
}

export function TasksSection({ opportunityId }: { opportunityId: string }) {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const tasks = trpc.tasks.list.useQuery({ opportunityId });
  const users = trpc.users.list.useQuery({ active: true });

  const invalidate = () => utils.tasks.list.invalidate({ opportunityId });

  const create = trpc.tasks.create.useMutation({
    onSuccess: () => {
      invalidate();
      toast({ kind: 'success', title: 'Tarefa criada.' });
    },
    onError: (e) => toast({ kind: 'error', title: 'Falha ao criar tarefa.', description: e.message }),
  });
  const update = trpc.tasks.update.useMutation({
    onSuccess: () => {
      invalidate();
      toast({ kind: 'success', title: 'Tarefa atualizada.' });
    },
    onError: (e) => toast({ kind: 'error', title: 'Falha ao salvar tarefa.', description: e.message }),
  });
  const remove = trpc.tasks.delete.useMutation({
    onSuccess: () => {
      invalidate();
      toast({ kind: 'success', title: 'Tarefa removida.' });
    },
    onError: (e) => toast({ kind: 'error', title: 'Falha ao remover tarefa.', description: e.message }),
  });
  const updateStatus = trpc.tasks.updateStatus.useMutation({ onSuccess: invalidate });

  const [editing, setEditing] = React.useState<Task | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<Task | null>(null);

  return (
    <section className="mb-4 rounded-lg border border-border bg-card p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-1">
          Tarefas ({tasks.data?.length ?? 0})
        </h2>
        <Button variant="secondary" size="sm" onClick={() => setEditing('new')}>
          + Nova tarefa
        </Button>
      </header>

      {tasks.isLoading && <p className="text-sm text-text-2">Carregando…</p>}
      {tasks.data && tasks.data.length === 0 && (
        <p className="text-sm text-text-2">Sem tarefas vinculadas a esta oportunidade.</p>
      )}

      <ul className="space-y-2">
        {tasks.data?.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between gap-2 rounded border border-border p-2 text-sm hover:bg-hover"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <input
                type="checkbox"
                aria-label={`Marcar tarefa ${t.title} como ${t.status === 'DONE' ? 'não concluída' : 'concluída'}`}
                checked={t.status === 'DONE'}
                onChange={(e) =>
                  updateStatus.mutate({ id: t.id, status: e.target.checked ? 'DONE' : 'TODO' })
                }
              />
              <button
                type="button"
                onClick={() => setEditing(t)}
                className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary rounded"
              >
                <p className={t.status === 'DONE' ? 'line-through text-text-2' : 'text-text-1'}>
                  {t.title}
                </p>
                <p className="text-xs text-text-2">
                  {t.assignee?.fullName ?? 'sem responsável'}
                  {t.dueDate && ` · vence ${new Date(t.dueDate).toLocaleDateString('pt-BR')}`}
                </p>
              </button>
            </div>
            <span className="text-xs uppercase text-text-2">{t.priority}</span>
            <button
              type="button"
              aria-label={`Remover tarefa ${t.title}`}
              onClick={() => setConfirmDelete(t)}
              className="rounded p-1 text-text-3 hover:bg-hover hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </li>
        ))}
      </ul>

      {editing && (
        <TaskModal
          task={editing === 'new' ? null : editing}
          users={users.data ?? []}
          pending={create.isPending || update.isPending}
          onClose={() => setEditing(null)}
          onSubmit={async (values) => {
            if (editing === 'new') {
              await create.mutateAsync({
                opportunityId,
                title: values.title,
                description: values.description || null,
                dueDate: values.dueDate ? new Date(values.dueDate) : null,
                priority: values.priority,
                assigneeId: values.assigneeId || null,
              });
            } else {
              await update.mutateAsync({
                id: editing.id,
                title: values.title,
                description: values.description || null,
                dueDate: values.dueDate ? new Date(values.dueDate) : null,
                priority: values.priority,
                assigneeId: values.assigneeId || null,
              });
            }
            setEditing(null);
          }}
        />
      )}

      {confirmDelete && (
        <AlertDialog
          open
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            await remove.mutateAsync({ id: confirmDelete.id });
            setConfirmDelete(null);
          }}
          title="Remover tarefa"
          description={`Tem certeza que quer remover “${confirmDelete.title}”? Isso não pode ser desfeito pela interface.`}
          confirmLabel="Remover"
          tone="danger"
          loading={remove.isPending}
        />
      )}
    </section>
  );
}

function TaskModal({
  task,
  users,
  pending,
  onClose,
  onSubmit,
}: {
  task: Task | null;
  users: Array<{ id: string; fullName: string }>;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: FormState) => Promise<void>;
}) {
  const [form, setForm] = React.useState<FormState>(task ? taskToForm(task) : EMPTY_FORM);
  const [error, setError] = React.useState<string | null>(null);

  const isEdit = task !== null;
  const titleTrimmed = form.title.trim();
  const canSubmit = titleTrimmed.length >= 2 && !pending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    try {
      await onSubmit({ ...form, title: titleTrimmed });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido.');
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Editar tarefa' : 'Nova tarefa'}
      description={isEdit ? undefined : 'Vincule uma ação a esta oportunidade.'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Título" required>
          <Input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Ex.: Enviar proposta revisada"
            maxLength={200}
          />
        </Field>

        <Field label="Descrição">
          <Textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Contexto ou próximos passos (opcional)"
            rows={3}
            maxLength={4000}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Prazo">
            <Input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </Field>
          <Field label="Prioridade">
            <Select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as FormState['priority'] })}
            >
              <option value="LOW">Baixa</option>
              <option value="MEDIUM">Média</option>
              <option value="HIGH">Alta</option>
              <option value="URGENT">Urgente</option>
            </Select>
          </Field>
        </div>

        <Field label="Responsável">
          <Select
            value={form.assigneeId}
            onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
          >
            <option value="">Sem responsável definido</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </Select>
        </Field>

        {error && (
          <p role="alert" className="rounded bg-danger-bg p-2 text-sm text-danger-text">
            {error}
          </p>
        )}

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit} loading={pending}>
            {isEdit ? 'Salvar' : 'Criar tarefa'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
