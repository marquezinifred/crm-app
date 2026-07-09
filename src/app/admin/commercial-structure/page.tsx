'use client';

import * as React from 'react';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { hasPermissionByRole } from '@/lib/auth/rbac';
import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { AlertDialog } from '@/components/ui/alert-dialog';
import { Sheet, SheetHeader, SheetBody } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/controls';
import { Table, THead, TH, TBody, TR, TD, TableEmpty } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';

/**
 * Sprint 15G Fase 4a — UI /admin/commercial-structure.
 *
 * 2 tabs:
 *  - Níveis: CRUD de SalesUnitType (tipos hierárquicos: nome, level 1-8,
 *    cor, ícone). Reflete UNIQUE(tenant_id, level) e UNIQUE(tenant_id, name)
 *    do schema (P2002 → CONFLICT no backend, mostrado como toast).
 *  - Organograma: árvore navegável (constrída client-side de `getTree`
 *    flat). Cada nó mostra tipo + membros; click abre Sheet detalhe.
 *
 * Convenções:
 *  - Sidebar item já gated por `permission: 'sales_structure:read'`
 *    — page assume que só quem tem read chega aqui.
 *  - Botões "manage" gated client-side via `hasPermissionByRole` como
 *    defesa em profundidade (backend re-valida em withPermission).
 *  - AlertDialog do design system substitui `confirm()` nativo (P-12 pattern).
 *  - toast success/error via `friendlyTrpcError` (P-21 pattern) — expande
 *    Zod fieldErrors, tenantIsolation, e mensagens estruturadas.
 */

type TabId = 'levels' | 'tree';

export default function CommercialStructurePage() {
  const [tab, setTab] = React.useState<TabId>('levels');
  const me = trpc.users.me.useQuery(undefined, { staleTime: 60_000 });
  const canManage = me.data?.role
    ? hasPermissionByRole(me.data.role, 'sales_structure:manage')
    : false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estrutura comercial"
        description="Defina níveis hierárquicos (equipes, gerências, diretorias) e monte o organograma que rege a visibilidade das oportunidades."
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
        <TabsList>
          <TabsTrigger value="levels">Níveis</TabsTrigger>
          <TabsTrigger value="tree">Organograma</TabsTrigger>
        </TabsList>

        <TabsContent value="levels">
          <UnitTypesTab canManage={canManage} />
        </TabsContent>

        <TabsContent value="tree">
          <OrgTreeTab canManage={canManage} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ─── Tab 1: Níveis (SalesUnitType) ────────────────────────────────── */

interface UnitTypeRow {
  id: string;
  name: string;
  level: number;
  color: string | null;
  icon: string | null;
}

function UnitTypesTab({ canManage }: { canManage: boolean }) {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const list = trpc.salesStructure.listUnitTypes.useQuery();
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UnitTypeRow | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = React.useState<string | null>(null);

  const remove = trpc.salesStructure.deleteUnitType.useMutation({
    onSuccess: () => {
      utils.salesStructure.listUnitTypes.invalidate();
      toast({ kind: 'success', title: 'Nível excluído.' });
    },
    onError: (e) => toast({ kind: 'error', title: friendlyTrpcError(e) }),
  });

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(row: UnitTypeRow) {
    setEditing(row);
    setModalOpen(true);
  }

  const rows = list.data ?? [];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-body text-text-2 max-w-prose">
          Cada nível representa uma camada da hierarquia (ex.: Equipe, Gerência,
          Diretoria). O `level` numérico ordena visualmente e é imutável após
          criado.
        </p>
        {canManage && (
          <Button variant="primary" onClick={openCreate}>
            + Novo nível
          </Button>
        )}
      </div>

      {rows.length === 0 && !list.isLoading ? (
        <EmptyState
          title="Nenhum nível cadastrado."
          description={
            canManage
              ? 'Comece criando o primeiro nível — por exemplo, "Equipe" no nível 1.'
              : 'Peça a um admin para configurar os níveis hierárquicos da estrutura.'
          }
          action={
            canManage ? (
              <Button variant="primary" onClick={openCreate}>
                + Novo nível
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Nome</TH>
              <TH>Nível</TH>
              <TH>Cor</TH>
              <TH>Ícone</TH>
              <TH className="text-right">Ações</TH>
            </tr>
          </THead>
          <TBody>
            {rows.length === 0 && (
              <TableEmpty colSpan={5}>Carregando…</TableEmpty>
            )}
            {rows.map((row) => (
              <TR key={row.id}>
                <TD className="font-medium">{row.name}</TD>
                <TD>
                  <Badge variant="default">Nível {row.level}</Badge>
                </TD>
                <TD>
                  {row.color ? (
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-4 w-4 rounded-full border border-border"
                        style={{ backgroundColor: row.color }}
                        aria-hidden="true"
                      />
                      <span className="text-caption text-text-2 font-mono">
                        {row.color}
                      </span>
                    </div>
                  ) : (
                    <span className="text-text-3">—</span>
                  )}
                </TD>
                <TD>
                  {row.icon ? (
                    <span className="text-caption text-text-2 font-mono">
                      {row.icon}
                    </span>
                  ) : (
                    <span className="text-text-3">—</span>
                  )}
                </TD>
                <TD className="text-right">
                  {canManage && (
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(row)}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Excluir ${row.name}`}
                        onClick={() => setConfirmingDeleteId(row.id)}
                      >
                        ×
                      </Button>
                    </div>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <UnitTypeModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editing={editing}
      />

      <AlertDialog
        open={Boolean(confirmingDeleteId)}
        onCancel={() => setConfirmingDeleteId(null)}
        onConfirm={() => {
          if (confirmingDeleteId) remove.mutate({ id: confirmingDeleteId });
          setConfirmingDeleteId(null);
        }}
        title="Excluir este nível?"
        description="Se houver unidades ativas usando este nível, a exclusão falha e o sistema pede reclassificação."
        confirmLabel="Excluir"
        loading={remove.isPending}
      />
    </section>
  );
}

function UnitTypeModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: UnitTypeRow | null;
}) {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const isEdit = Boolean(editing);
  const [name, setName] = React.useState('');
  const [level, setLevel] = React.useState<number>(1);
  const [color, setColor] = React.useState('');
  const [icon, setIcon] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setName(editing?.name ?? '');
      setLevel(editing?.level ?? 1);
      setColor(editing?.color ?? '');
      setIcon(editing?.icon ?? '');
    }
  }, [open, editing]);

  const create = trpc.salesStructure.createUnitType.useMutation({
    onSuccess: () => {
      utils.salesStructure.listUnitTypes.invalidate();
      toast({ kind: 'success', title: 'Nível criado.' });
      onClose();
    },
    onError: (e) => toast({ kind: 'error', title: friendlyTrpcError(e) }),
  });
  const update = trpc.salesStructure.updateUnitType.useMutation({
    onSuccess: () => {
      utils.salesStructure.listUnitTypes.invalidate();
      toast({ kind: 'success', title: 'Nível atualizado.' });
      onClose();
    },
    onError: (e) => toast({ kind: 'error', title: friendlyTrpcError(e) }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedColor = color.trim();
    const trimmedIcon = icon.trim();
    if (trimmedName.length < 2) return;
    if (isEdit && editing) {
      update.mutate({
        id: editing.id,
        name: trimmedName,
        ...(trimmedColor ? { color: trimmedColor } : {}),
        ...(trimmedIcon ? { icon: trimmedIcon } : {}),
      });
    } else {
      create.mutate({
        name: trimmedName,
        level,
        ...(trimmedColor ? { color: trimmedColor } : {}),
        ...(trimmedIcon ? { icon: trimmedIcon } : {}),
      });
    }
  }

  const isPending = create.isPending || update.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar nível' : 'Novo nível hierárquico'}
      description={
        isEdit
          ? 'O level numérico é imutável — só nome, cor e ícone podem ser ajustados.'
          : 'Defina como este nível aparece no organograma. Levels vão de 1 (topo) a 8.'
      }
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Nome" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={50}
            placeholder="Ex: Equipe, Gerência, Diretoria"
          />
        </Field>

        {!isEdit && (
          <Field label="Nível hierárquico" required helper="1 é o topo; 8 é o último nível de detalhe.">
            <Select
              value={String(level)}
              onChange={(e) => setLevel(Number(e.target.value))}
              required
            >
              {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={String(n)}>
                  Nível {n}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Cor" helper="HEX #RRGGBB — opcional.">
          <Input
            type="text"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            pattern="^#[0-9A-Fa-f]{6}$"
            placeholder="#7C3AED"
            maxLength={7}
          />
        </Field>

        <Field label="Ícone" helper="Nome de ícone Tabler/Feather — opcional.">
          <Input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="users, briefcase, building…"
            maxLength={50}
          />
        </Field>

        <ModalFooter>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" loading={isPending}>
            {isEdit ? 'Salvar' : 'Criar nível'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/* ─── Tab 2: Organograma (SalesUnit tree) ───────────────────────────── */

interface TreeNode {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  depth: number;
  typeId: string;
  typeName: string;
  typeLevel: number;
  typeColor: string | null;
  typeIcon: string | null;
  memberCount: number;
}

interface TreeNodeWithChildren extends TreeNode {
  children: TreeNodeWithChildren[];
}

function buildTree(flat: TreeNode[]): TreeNodeWithChildren[] {
  const byId = new Map<string, TreeNodeWithChildren>();
  flat.forEach((n) => byId.set(n.id, { ...n, children: [] }));
  const roots: TreeNodeWithChildren[] = [];
  flat.forEach((n) => {
    const node = byId.get(n.id);
    if (!node) return;
    if (n.parentId && byId.has(n.parentId)) {
      byId.get(n.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function OrgTreeTab({ canManage }: { canManage: boolean }) {
  const tree = trpc.salesStructure.getTree.useQuery();
  const [newUnitOpen, setNewUnitOpen] = React.useState(false);
  const [selectedUnitId, setSelectedUnitId] = React.useState<string | null>(null);

  const flat = React.useMemo<TreeNode[]>(
    () => (tree.data as TreeNode[] | undefined) ?? [],
    [tree.data],
  );
  const roots = React.useMemo(() => buildTree(flat), [flat]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-body text-text-2 max-w-prose">
          Cada nó representa uma unidade comercial (ex.: Equipe SP, Gerência
          Sudeste). Clique em um nó para gerir membros ou desativar.
        </p>
        {canManage && (
          <Button variant="primary" onClick={() => setNewUnitOpen(true)}>
            + Nova unidade
          </Button>
        )}
      </div>

      {flat.length === 0 && !tree.isLoading ? (
        <EmptyState
          title="Organograma vazio."
          description={
            canManage
              ? 'Crie a primeira unidade — sem parent, ela vira nó raiz da árvore.'
              : 'Peça a um admin para desenhar a estrutura organizacional.'
          }
          action={
            canManage ? (
              <Button variant="primary" onClick={() => setNewUnitOpen(true)}>
                + Nova unidade
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-md border border-border bg-card p-2">
          <ul role="tree" aria-label="Organograma comercial">
            {roots.map((node) => (
              <OrgTreeNodeItem
                key={node.id}
                node={node}
                depth={0}
                onSelect={setSelectedUnitId}
              />
            ))}
          </ul>
        </div>
      )}

      <NewUnitModal
        open={newUnitOpen}
        onClose={() => setNewUnitOpen(false)}
      />

      <UnitDetailPanel
        unitId={selectedUnitId}
        onClose={() => setSelectedUnitId(null)}
        canManage={canManage}
      />
    </section>
  );
}

function OrgTreeNodeItem({
  node,
  depth,
  onSelect,
}: {
  node: TreeNodeWithChildren;
  depth: number;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = React.useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={false}
    >
      <div
        className="group flex items-center gap-2 rounded px-2 py-2 hover:bg-hover"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? 'Recolher subunidades' : 'Expandir subunidades'}
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="flex h-5 w-5 items-center justify-center rounded text-text-3 hover:text-text-1"
          >
            <svg
              viewBox="0 0 24 24"
              className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          <span className="inline-block h-5 w-5" aria-hidden="true" />
        )}

        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-border"
          style={{ backgroundColor: node.typeColor ?? 'transparent' }}
          aria-hidden="true"
          title={node.typeName}
        />

        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex flex-1 items-center gap-2 text-left text-body text-text-1 hover:text-brand-primary-light"
        >
          <span className="font-medium">{node.name}</span>
          <span className="text-caption text-text-3">{node.typeName}</span>
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="default" title="Membros">
            {node.memberCount} {node.memberCount === 1 ? 'membro' : 'membros'}
          </Badge>
        </div>
      </div>

      {hasChildren && expanded && (
        <ul role="group">
          {node.children.map((child) => (
            <OrgTreeNodeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function NewUnitModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const types = trpc.salesStructure.listUnitTypes.useQuery();
  const tree = trpc.salesStructure.getTree.useQuery();
  const [name, setName] = React.useState('');
  const [typeId, setTypeId] = React.useState('');
  const [parentId, setParentId] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setName('');
      setTypeId(types.data?.[0]?.id ?? '');
      setParentId('');
    }
  }, [open, types.data]);

  const create = trpc.salesStructure.createUnit.useMutation({
    onSuccess: () => {
      utils.salesStructure.getTree.invalidate();
      toast({ kind: 'success', title: 'Unidade criada.' });
      onClose();
    },
    onError: (e) => toast({ kind: 'error', title: friendlyTrpcError(e) }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length < 2 || !typeId) return;
    create.mutate({
      name: trimmedName,
      typeId,
      ...(parentId ? { parentId } : {}),
    });
  }

  const availableTypes = types.data ?? [];
  const availableParents = tree.data ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova unidade"
      description="Crie um novo nó na árvore. Sem parent, será um nó raiz."
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Nome" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={100}
            placeholder="Ex: Equipe SP, Gerência Sudeste"
          />
        </Field>

        <Field label="Tipo (nível)" required helper="Escolha um dos níveis cadastrados na aba Níveis.">
          <Select
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            required
          >
            <option value="" disabled>
              Selecione um nível
            </option>
            {availableTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} (Nível {t.level})
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Parent" helper="Deixe vazio para criar um nó raiz.">
          <Select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">— (nó raiz)</option>
            {availableParents.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.typeName})
              </option>
            ))}
          </Select>
        </Field>

        <ModalFooter>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            type="submit"
            loading={create.isPending}
            disabled={availableTypes.length === 0}
          >
            Criar unidade
          </Button>
        </ModalFooter>

        {availableTypes.length === 0 && (
          <p className="text-caption text-warning-text">
            Cadastre pelo menos um nível na aba Níveis antes de criar unidades.
          </p>
        )}
      </form>
    </Modal>
  );
}

function UnitDetailPanel({
  unitId,
  onClose,
  canManage,
}: {
  unitId: string | null;
  onClose: () => void;
  canManage: boolean;
}) {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const detail = trpc.salesStructure.getUnit.useQuery(
    { id: unitId ?? '' },
    { enabled: Boolean(unitId) },
  );
  const [addMemberOpen, setAddMemberOpen] = React.useState(false);
  const [confirmingRemoveId, setConfirmingRemoveId] = React.useState<string | null>(null);
  const [confirmingDeactivate, setConfirmingDeactivate] = React.useState(false);

  const removeMember = trpc.salesStructure.removeMember.useMutation({
    onSuccess: () => {
      utils.salesStructure.getUnit.invalidate();
      utils.salesStructure.getTree.invalidate();
      toast({ kind: 'success', title: 'Membro removido.' });
    },
    onError: (e) => toast({ kind: 'error', title: friendlyTrpcError(e) }),
  });

  const deactivate = trpc.salesStructure.deactivateUnit.useMutation({
    onSuccess: () => {
      utils.salesStructure.getTree.invalidate();
      toast({ kind: 'success', title: 'Unidade desativada.' });
      onClose();
    },
    onError: (e) => toast({ kind: 'error', title: friendlyTrpcError(e) }),
  });

  const unit = detail.data?.unit;
  const ancestors = detail.data?.ancestors ?? [];
  const members = unit?.members ?? [];

  return (
    <>
      <Sheet
        open={Boolean(unitId)}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        variant="right"
      >
        <SheetHeader
          title={unit?.name ?? 'Carregando…'}
          onClose={onClose}
          status={
            ancestors.length > 0 ? (
              <p className="text-caption text-text-3 truncate">
                {ancestors.map((a) => a.name).join(' › ')}
              </p>
            ) : undefined
          }
        />
        <SheetBody>
          {!unit ? (
            <p className="text-body text-text-2">Carregando detalhes…</p>
          ) : (
            <div className="space-y-6">
              <section>
                <h3 className="text-caption uppercase tracking-wider font-semibold text-text-3 mb-2">
                  Tipo
                </h3>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-full border border-border"
                    style={{ backgroundColor: unit.type?.color ?? 'transparent' }}
                    aria-hidden="true"
                  />
                  <span className="text-body text-text-1">
                    {unit.type?.name}
                  </span>
                  {typeof unit.type?.level === 'number' && (
                    <Badge variant="default">Nível {unit.type.level}</Badge>
                  )}
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-caption uppercase tracking-wider font-semibold text-text-3">
                    Membros ({members.length})
                  </h3>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAddMemberOpen(true)}
                    >
                      + Adicionar
                    </Button>
                  )}
                </div>

                {members.length === 0 ? (
                  <p className="text-body text-text-2 py-4 text-center">
                    Nenhum membro nesta unidade.
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-md border border-border" role="list">
                    {members.map((m) => (
                      <li
                        key={m.user.id}
                        className="flex items-center justify-between gap-3 p-3"
                      >
                        <div className="min-w-0">
                          <p className="text-body text-text-1 truncate">
                            {m.user.fullName}
                          </p>
                          <p className="text-caption text-text-2 truncate">
                            {m.user.email}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge
                            variant={m.role === 'MANAGER' ? 'primary' : 'default'}
                          >
                            {m.role === 'MANAGER' ? 'Gerente' : 'Membro'}
                          </Badge>
                          {m.isPrimary && (
                            <Badge variant="info">Primária</Badge>
                          )}
                          {canManage && (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Remover ${m.user.fullName}`}
                              onClick={() => setConfirmingRemoveId(m.user.id)}
                            >
                              ×
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {canManage && (
                <section className="pt-4 border-t border-border">
                  <Button
                    variant="danger"
                    onClick={() => setConfirmingDeactivate(true)}
                  >
                    Desativar unidade
                  </Button>
                  <p className="text-caption text-text-3 mt-2">
                    A desativação faz soft delete e falha se houver subunidades ativas.
                  </p>
                </section>
              )}
            </div>
          )}
        </SheetBody>
      </Sheet>

      {unit && (
        <AddMemberModal
          open={addMemberOpen}
          onClose={() => setAddMemberOpen(false)}
          unitId={unit.id}
          unitName={unit.name}
        />
      )}

      <AlertDialog
        open={Boolean(confirmingRemoveId)}
        onCancel={() => setConfirmingRemoveId(null)}
        onConfirm={() => {
          if (confirmingRemoveId && unit) {
            removeMember.mutate({ unitId: unit.id, userId: confirmingRemoveId });
          }
          setConfirmingRemoveId(null);
        }}
        title="Remover este membro?"
        description="O membro perde acesso à visão de time desta unidade."
        confirmLabel="Remover"
        loading={removeMember.isPending}
      />

      <AlertDialog
        open={confirmingDeactivate}
        onCancel={() => setConfirmingDeactivate(false)}
        onConfirm={() => {
          if (unit) deactivate.mutate({ id: unit.id });
          setConfirmingDeactivate(false);
        }}
        title="Desativar esta unidade?"
        description="A unidade some do organograma. Se houver subunidades ativas, a desativação falha."
        confirmLabel="Desativar"
        loading={deactivate.isPending}
      />
    </>
  );
}

function AddMemberModal({
  open,
  onClose,
  unitId,
  unitName,
}: {
  open: boolean;
  onClose: () => void;
  unitId: string;
  unitName: string;
}) {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const usersQuery = trpc.users.list.useQuery({ active: true });
  const [userId, setUserId] = React.useState('');
  const [role, setRole] = React.useState<'MANAGER' | 'MEMBER'>('MEMBER');
  const [isPrimary, setIsPrimary] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setUserId('');
      setRole('MEMBER');
      setIsPrimary(false);
    }
  }, [open]);

  const addMember = trpc.salesStructure.addMember.useMutation({
    onSuccess: (result) => {
      utils.salesStructure.getUnit.invalidate();
      utils.salesStructure.getTree.invalidate();
      // Mensagem contextual: distingue criação, mudança e no-op.
      let title = 'Membro adicionado.';
      if (!result.created) {
        if (result.roleChanged || result.primaryChanged) {
          title = 'Vinculação atualizada.';
        } else {
          title = 'Sem alterações — o usuário já era membro com essa configuração.';
        }
      }
      toast({ kind: 'success', title });
      onClose();
    },
    onError: (e) => toast({ kind: 'error', title: friendlyTrpcError(e) }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    addMember.mutate({
      unitId,
      userId,
      role,
      isPrimary,
    });
  }

  const users = usersQuery.data ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Adicionar membro em "${unitName}"`}
      description="Escolha um usuário do tenant e defina o papel dele nesta unidade."
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Usuário" required>
          <Select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            required
          >
            <option value="" disabled>
              Selecione um usuário
            </option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} — {u.email}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Papel na unidade" required>
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as 'MANAGER' | 'MEMBER')}
            required
          >
            <option value="MEMBER">Membro</option>
            <option value="MANAGER">Gerente</option>
          </Select>
        </Field>

        <label className="flex items-start gap-2 cursor-pointer">
          <Checkbox
            checked={isPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
          />
          <span className="text-body text-text-1">
            Marcar como unidade principal
            <span className="block text-caption text-text-3 mt-0.5">
              Substitui a unidade principal atual do usuário. Um usuário só pode
              ter uma unidade principal por vez.
            </span>
          </span>
        </label>

        <ModalFooter>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            type="submit"
            loading={addMember.isPending}
            disabled={users.length === 0}
          >
            Adicionar
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
