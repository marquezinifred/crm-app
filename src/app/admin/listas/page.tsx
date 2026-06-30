'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { trpc } from '@/lib/trpc/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/controls';
import { useToast } from '@/components/ui/toast';
import { AlertDialog } from '@/components/ui/alert-dialog';

type Tab =
  | 'territorios'
  | 'segmentos'
  | 'origens'
  | 'setores'
  | 'cargos';

const TABS: { id: Tab; label: string; description: string }[] = [
  {
    id: 'territorios',
    label: 'Territórios',
    description: 'Regiões comerciais usadas em filtros e visibilidade.',
  },
  {
    id: 'segmentos',
    label: 'Segmentos',
    description: 'Verticais de negócio que organizam empresas e oportunidades.',
  },
  {
    id: 'origens',
    label: 'Origens',
    description: 'De onde vieram seus leads (indicação, evento, inbound…).',
  },
  {
    id: 'setores',
    label: 'Setores',
    description: 'Indústrias dos seus clientes — opcional, mas ajuda a segmentar.',
  },
  {
    id: 'cargos',
    label: 'Cargos',
    description: 'Papéis de contato com peso decisório (decisor / influenciador / etc).',
  },
];

export default function ListasAdminPage() {
  const [tab, setTab] = useState<Tab>('territorios');
  const meta = TABS.find((t) => t.id === tab)!;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Listas do CRM"
        description="Tudo o que aparece em selects e filtros do CRM mora aqui. Reordene, ative/desative, exclua quando não usar mais."
      />

      <nav className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-body whitespace-nowrap border-b-2 transition-colors ${
              t.id === tab
                ? 'border-brand-primary text-text-1 font-medium'
                : 'border-transparent text-text-2 hover:text-text-1'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <p className="text-caption text-text-2 -mt-3">{meta.description}</p>

      {tab === 'territorios' && <TerritoriesTab />}
      {tab === 'segmentos' && <SegmentsTab />}
      {tab === 'origens' && <LeadSourcesTab />}
      {tab === 'setores' && <IndustriesTab />}
      {tab === 'cargos' && <ContactRolesTab />}
    </div>
  );
}

// ─── Territories / Segments (sem position/isActive — schema simples) ────

function TerritoriesTab() {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const list = trpc.territories.list.useQuery();
  const create = trpc.territories.create.useMutation({
    onSuccess: () => {
      utils.territories.list.invalidate();
      setName('');
      toast({ kind: 'success', title: 'Território criado.' });
    },
  });
  const remove = trpc.territories.remove.useMutation({
    onSuccess: () => utils.territories.list.invalidate(),
  });
  const [name, setName] = useState('');

  return (
    <SimpleSection
      items={list.data ?? []}
      addLabel="Adicionar território"
      placeholder="Ex: Sudeste, Nordeste, Capital…"
      name={name}
      setName={setName}
      onCreate={() => name.length >= 2 && create.mutate({ name: name.trim() })}
      onRemove={(id) => remove.mutate({ id })}
      creating={create.isPending}
    />
  );
}

function SegmentsTab() {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const list = trpc.segments.list.useQuery();
  const create = trpc.segments.create.useMutation({
    onSuccess: () => {
      utils.segments.list.invalidate();
      setName('');
      toast({ kind: 'success', title: 'Segmento criado.' });
    },
  });
  const remove = trpc.segments.remove.useMutation({
    onSuccess: () => utils.segments.list.invalidate(),
  });
  const [name, setName] = useState('');

  return (
    <SimpleSection
      items={list.data ?? []}
      addLabel="Adicionar segmento"
      placeholder="Ex: SaaS B2B, E-commerce, Indústria…"
      name={name}
      setName={setName}
      onCreate={() => name.length >= 2 && create.mutate({ name: name.trim() })}
      onRemove={(id) => remove.mutate({ id })}
      creating={create.isPending}
    />
  );
}

function SimpleSection({
  items,
  addLabel,
  placeholder,
  name,
  setName,
  onCreate,
  onRemove,
  creating,
}: {
  items: Array<{ id: string; name: string }>;
  addLabel: string;
  placeholder: string;
  name: string;
  setName: (v: string) => void;
  onCreate: () => void;
  onRemove: (id: string) => void;
  creating: boolean;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  return (
    <section className="space-y-3 max-w-2xl">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onCreate();
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={placeholder}
          required
          minLength={2}
          maxLength={80}
        />
        <Button type="submit" variant="primary" loading={creating}>
          + Adicionar
        </Button>
      </form>

      <ul className="divide-y divide-border rounded-md border border-border bg-card" aria-label={addLabel}>
        {items.length === 0 && (
          <li className="p-4 text-caption text-text-2">
            Vazio. Use o campo acima para começar.
          </li>
        )}
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between p-3">
            <span className="text-body text-text-1">{item.name}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingId(item.id)}
            >
              Excluir
            </Button>
          </li>
        ))}
      </ul>
      <AlertDialog
        open={Boolean(confirmingId)}
        onCancel={() => setConfirmingId(null)}
        onConfirm={() => {
          if (confirmingId) onRemove(confirmingId);
          setConfirmingId(null);
        }}
        title="Excluir este item?"
        description="O registro vira inativo mas continua referenciado nos cadastros existentes."
        confirmLabel="Excluir"
      />
    </section>
  );
}

// ─── Lead Sources / Industries / Contact Roles (com reorder + active) ──

function LeadSourcesTab() {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const list = trpc.leadSources.list.useQuery({ includeInactive: true });
  const create = trpc.leadSources.create.useMutation({
    onSuccess: () => {
      utils.leadSources.list.invalidate();
      toast({ kind: 'success', title: 'Origem criada.' });
    },
  });
  const update = trpc.leadSources.update.useMutation({
    onSuccess: () => utils.leadSources.list.invalidate(),
  });
  const remove = trpc.leadSources.remove.useMutation({
    onSuccess: () => {
      utils.leadSources.list.invalidate();
      toast({ kind: 'success', title: 'Origem desligada.' });
    },
    onError: (e) => toast({ kind: 'error', title: e.message }),
  });
  const reorder = trpc.leadSources.reorder.useMutation({
    onSuccess: () => utils.leadSources.list.invalidate(),
  });

  return (
    <ConfigurableSection
      items={list.data ?? []}
      addLabel="Adicionar origem"
      placeholder="Ex: Indicação, LinkedIn, Inbound, Evento…"
      onCreate={(name) => create.mutate({ name })}
      onUpdate={(id, patch) => update.mutate({ id, ...patch })}
      onRemove={(id) => remove.mutate({ id })}
      onReorder={(ids) => reorder.mutate({ ids })}
      creating={create.isPending}
    />
  );
}

function IndustriesTab() {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const list = trpc.industries.list.useQuery({ includeInactive: true });
  const create = trpc.industries.create.useMutation({
    onSuccess: () => {
      utils.industries.list.invalidate();
      toast({ kind: 'success', title: 'Setor criado.' });
    },
  });
  const update = trpc.industries.update.useMutation({
    onSuccess: () => utils.industries.list.invalidate(),
  });
  const remove = trpc.industries.remove.useMutation({
    onSuccess: () => utils.industries.list.invalidate(),
    onError: (e) => toast({ kind: 'error', title: e.message }),
  });
  const reorder = trpc.industries.reorder.useMutation({
    onSuccess: () => utils.industries.list.invalidate(),
  });

  return (
    <ConfigurableSection
      items={list.data ?? []}
      addLabel="Adicionar setor"
      placeholder="Ex: Tecnologia, Saúde, Construção, Agronegócio…"
      onCreate={(name) => create.mutate({ name })}
      onUpdate={(id, patch) => update.mutate({ id, ...patch })}
      onRemove={(id) => remove.mutate({ id })}
      onReorder={(ids) => reorder.mutate({ ids })}
      creating={create.isPending}
    />
  );
}

function ContactRolesTab() {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const list = trpc.contactRoles.list.useQuery({ includeInactive: true });
  const create = trpc.contactRoles.create.useMutation({
    onSuccess: () => {
      utils.contactRoles.list.invalidate();
      toast({ kind: 'success', title: 'Cargo criado.' });
    },
  });
  const update = trpc.contactRoles.update.useMutation({
    onSuccess: () => utils.contactRoles.list.invalidate(),
  });
  const remove = trpc.contactRoles.remove.useMutation({
    onSuccess: () => utils.contactRoles.list.invalidate(),
    onError: (e) => toast({ kind: 'error', title: e.message }),
  });
  const reorder = trpc.contactRoles.reorder.useMutation({
    onSuccess: () => utils.contactRoles.list.invalidate(),
  });

  return (
    <ConfigurableSection
      items={list.data ?? []}
      addLabel="Adicionar cargo"
      placeholder="Ex: Decisor, Influenciador, Técnico, Financeiro…"
      onCreate={(name) => create.mutate({ name })}
      onUpdate={(id, patch) => update.mutate({ id, ...patch })}
      onRemove={(id) => remove.mutate({ id })}
      onReorder={(ids) => reorder.mutate({ ids })}
      creating={create.isPending}
    />
  );
}

interface ConfigurableItem {
  id: string;
  name: string;
  position: number;
  isActive: boolean;
}

function ConfigurableSection({
  items,
  addLabel,
  placeholder,
  onCreate,
  onUpdate,
  onRemove,
  onReorder,
  creating,
}: {
  items: ConfigurableItem[];
  addLabel: string;
  placeholder: string;
  onCreate: (name: string) => void;
  onUpdate: (id: string, patch: { isActive?: boolean; name?: string }) => void;
  onRemove: (id: string) => void;
  onReorder: (ids: string[]) => void;
  creating: boolean;
}) {
  const sorted = useMemo(
    () => [...items].sort((a, b) => a.position - b.position),
    [items],
  );
  const ids = sorted.map((i) => i.id);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const [name, setName] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = ids.indexOf(active.id as string);
    const newIdx = ids.indexOf(over.id as string);
    onReorder(arrayMove(ids, oldIdx, newIdx));
  }

  return (
    <section className="space-y-3 max-w-3xl">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim().length >= 2) {
            onCreate(name.trim());
            setName('');
          }
        }}
      >
        <Field label={addLabel} required className="flex-1">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder}
            required
            minLength={2}
            maxLength={80}
          />
        </Field>
        <div className="flex items-end">
          <Button type="submit" variant="primary" loading={creating}>
            + Adicionar
          </Button>
        </div>
      </form>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="divide-y divide-border rounded-md border border-border bg-card" role="list">
            {sorted.length === 0 && (
              <li className="p-4 text-caption text-text-2">
                Vazio. Crie seu primeiro item acima.
              </li>
            )}
            {sorted.map((item) => (
              <ConfigurableRow
                key={item.id}
                item={item}
                onToggleActive={(active) => onUpdate(item.id, { isActive: active })}
                onRename={(newName) => onUpdate(item.id, { name: newName })}
                onAskDelete={() => setConfirmingId(item.id)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <AlertDialog
        open={Boolean(confirmingId)}
        onCancel={() => setConfirmingId(null)}
        onConfirm={() => {
          if (confirmingId) onRemove(confirmingId);
          setConfirmingId(null);
        }}
        title="Excluir este item?"
        description="Se estiver em uso, o sistema sugere desativar em vez de excluir."
        confirmLabel="Excluir"
      />
    </section>
  );
}

function ConfigurableRow({
  item,
  onToggleActive,
  onRename,
  onAskDelete,
}: {
  item: ConfigurableItem;
  onToggleActive: (active: boolean) => void;
  onRename: (newName: string) => void;
  onAskDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.name);

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.7 : 1,
      }}
      className="flex items-center gap-3 p-3"
    >
      <button
        type="button"
        aria-label="Arrastar para reordenar"
        className="cursor-grab text-text-3 hover:text-text-1 active:cursor-grabbing px-1"
        {...attributes}
        {...listeners}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="6" r="1.5" />
          <circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" />
          <circle cx="15" cy="18" r="1.5" />
        </svg>
      </button>
      {editing ? (
        <form
          className="flex-1 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim().length >= 2 && draft.trim() !== item.name) {
              onRename(draft.trim());
            }
            setEditing(false);
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            onBlur={() => setEditing(false)}
            className="flex-1"
          />
          <Button type="submit" size="sm" variant="primary">Salvar</Button>
        </form>
      ) : (
        <button
          type="button"
          className="flex-1 text-left text-body text-text-1 hover:text-brand-primary-light"
          onClick={() => {
            setDraft(item.name);
            setEditing(true);
          }}
        >
          {item.name}
          {!item.isActive && (
            <Badge variant="default" className="ml-2">Inativo</Badge>
          )}
        </button>
      )}
      <Switch
        checked={item.isActive}
        onChange={(e) => onToggleActive(e.target.checked)}
        aria-label={item.isActive ? 'Desativar' : 'Ativar'}
      />
      <Button variant="ghost" size="sm" onClick={onAskDelete}>
        Excluir
      </Button>
    </li>
  );
}
