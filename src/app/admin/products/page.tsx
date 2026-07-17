'use client';

import { trpc, type RouterOutputs } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { useId, useMemo, useState } from 'react';
import { ProductType } from '@prisma/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { useToast } from '@/components/ui/toast';
import { Table, THead, TBody, TH, TR, TD, TableEmpty } from '@/components/ui/table';
import { useTableSort, type SortKey } from '@/lib/hooks/useTableSort';

const TYPE_LABEL: Record<ProductType, string> = {
  ALOCACAO: 'Alocação',
  PROJETO_ESCOPO_FECHADO: 'Projeto escopo fechado',
  PROJETO_SQUAD: 'Projeto squad',
  PRODUTO: 'Produto',
  OUTRO: 'Outro',
};

type ProductRow = RouterOutputs['products']['list'][number];

const SORT_PROD_NAME: SortKey<ProductRow> = 'name';
const SORT_PROD_TYPE: SortKey<ProductRow> = (p) => TYPE_LABEL[p.type];
const SORT_PROD_SKU: SortKey<ProductRow> = 'sku';
const SORT_PROD_MARGIN: SortKey<ProductRow> = (p) => Number(p.minMarginPct);
const SORT_PROD_STATUS: SortKey<ProductRow> = 'active';

type FormState = {
  id?: string;
  name: string;
  type: ProductType;
  sku: string;
  description: string;
  minMarginPct: string;
  active: boolean;
};

const EMPTY: FormState = {
  name: '',
  type: 'ALOCACAO',
  sku: '',
  description: '',
  minMarginPct: '0',
  active: true,
};

export default function AdminProductsPage() {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const list = trpc.products.list.useQuery({});
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const formTitleId = useId();

  const create = trpc.products.create.useMutation({
    onSuccess: (p) => {
      utils.products.list.invalidate();
      toast({ kind: 'success', title: `${p.name} adicionado ao catálogo.` });
      setForm(EMPTY);
      setError(null);
    },
    onError: (e) => setError(friendlyTrpcError(e)),
  });
  const update = trpc.products.update.useMutation({
    onSuccess: () => {
      utils.products.list.invalidate();
      toast({ kind: 'success', title: 'Produto atualizado.' });
      setForm(EMPTY);
      setError(null);
    },
    onError: (e) => setError(friendlyTrpcError(e)),
  });
  const remove = trpc.products.remove.useMutation({
    onSuccess: () => {
      utils.products.list.invalidate();
      toast({ kind: 'success', title: 'Produto desativado.' });
    },
    onError: (e) => toast({ kind: 'error', title: friendlyTrpcError(e) }),
  });

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const { sorted, toggleSort, getSortState } = useTableSort<ProductRow>(rows);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      name: form.name.trim(),
      type: form.type,
      sku: form.sku.trim() || null,
      description: form.description.trim() || null,
      minMarginPct: Number(form.minMarginPct) || 0,
      active: form.active,
    };
    if (form.id) update.mutate({ id: form.id, ...payload });
    else create.mutate(payload);
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <PageHeader
        title="Produtos e serviços"
        description="O portfólio que vai virar proposta e contrato."
      />

      <section
        aria-labelledby={formTitleId}
        className="border rounded-lg p-5 bg-card"
      >
        <h2 id={formTitleId} className="text-lg font-semibold mb-4">
          {form.id ? 'Editar produto' : 'Novo produto'}
        </h2>
        <form onSubmit={submit} className="grid md:grid-cols-2 gap-4" noValidate>
          <FormField label="Nome" required>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="input"
            />
          </FormField>
          <FormField label="Tipo" required>
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ProductType }))}
              className="input"
            >
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="SKU">
            <input
              value={form.sku}
              onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
              className="input"
            />
          </FormField>
          <FormField label="Margem mínima (%)" required>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              required
              value={form.minMarginPct}
              onChange={(e) => setForm((f) => ({ ...f, minMarginPct: e.target.value }))}
              className="input"
            />
          </FormField>
          <FormField label="Descrição" className="md:col-span-2">
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="input"
            />
          </FormField>
          <div className="md:col-span-2 flex items-center gap-2">
            <input
              type="checkbox"
              id="prod-active"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            />
            <label htmlFor="prod-active" className="text-sm">
              Ativo
            </label>
          </div>

          {error && (
            <p role="alert" className="md:col-span-2 text-sm text-danger">
              {error}
            </p>
          )}

          <div className="md:col-span-2 flex gap-2">
            <button
              type="submit"
              disabled={create.isPending || update.isPending}
              className="px-4 py-2 rounded-md bg-brand text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
            >
              {form.id ? 'Salvar alterações' : 'Criar produto'}
            </button>
            {form.id && (
              <button
                type="button"
                onClick={() => {
                  setForm(EMPTY);
                  setError(null);
                }}
                className="px-4 py-2 rounded-md border hover:bg-page"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      </section>

      <section aria-label="Lista de produtos">
        <Table>
          <caption className="sr-only">Produtos e serviços cadastrados</caption>
          <THead>
            <tr>
              <TH sortable sortState={getSortState(SORT_PROD_NAME)} onSort={() => toggleSort(SORT_PROD_NAME)}>
                Nome
              </TH>
              <TH sortable sortState={getSortState(SORT_PROD_TYPE)} onSort={() => toggleSort(SORT_PROD_TYPE)}>
                Tipo
              </TH>
              <TH sortable sortState={getSortState(SORT_PROD_SKU)} onSort={() => toggleSort(SORT_PROD_SKU)}>
                SKU
              </TH>
              <TH sortable sortState={getSortState(SORT_PROD_MARGIN)} onSort={() => toggleSort(SORT_PROD_MARGIN)} className="text-right">
                Margem mín.
              </TH>
              <TH sortable sortState={getSortState(SORT_PROD_STATUS)} onSort={() => toggleSort(SORT_PROD_STATUS)}>
                Status
              </TH>
              <TH className="text-right">Ações</TH>
            </tr>
          </THead>
          <TBody>
            {list.isLoading && (
              <TableEmpty colSpan={6}>Carregando...</TableEmpty>
            )}
            {!list.isLoading && sorted.length === 0 && (
              <TableEmpty colSpan={6}>
                Seu portfólio começa aqui. Cadastre o primeiro produto.
              </TableEmpty>
            )}
            {sorted.map((p) => (
              <TR key={p.id}>
                <TD className="font-medium">{p.name}</TD>
                <TD className="text-text-2">{TYPE_LABEL[p.type]}</TD>
                <TD className="text-text-2 font-mono text-xs">{p.sku ?? '—'}</TD>
                <TD className="text-right">
                  {Number(p.minMarginPct).toFixed(1)}%
                </TD>
                <TD>
                  {p.active ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-success-bg text-success-text">
                      Ativo
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-hover text-text-1">
                      Inativo
                    </span>
                  )}
                </TD>
                <TD className="text-right">
                  <button
                    onClick={() =>
                      setForm({
                        id: p.id,
                        name: p.name,
                        type: p.type,
                        sku: p.sku ?? '',
                        description: p.description ?? '',
                        minMarginPct: String(p.minMarginPct),
                        active: p.active,
                      })
                    }
                    className="px-2 py-1 text-xs rounded border hover:bg-page focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    Editar
                  </button>{' '}
                  <button
                    onClick={() => {
                      if (confirm(`Remover ${p.name}?`)) remove.mutate({ id: p.id });
                    }}
                    className="px-2 py-1 text-xs rounded border text-danger hover:bg-danger-bg focus-visible:ring-2 focus-visible:ring-rose-500"
                  >
                    Remover
                  </button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </section>

      <style jsx>{`
        .input {
          width: 100%;
          border: 1px solid rgb(229 229 229);
          border-radius: 6px;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
        .input:focus {
          outline: 2px solid var(--brand-primary, #7c3aed);
          outline-offset: 1px;
        }
      `}</style>
    </div>
  );
}

function FormField({
  label,
  required,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const child = children as React.ReactElement;
  const withId = {
    ...child,
    props: { ...child.props, id, 'aria-required': required ? 'true' : undefined },
  } as React.ReactElement;
  return (
    <div className={className}>
      <label htmlFor={id} className="text-sm font-medium text-text-1 block">
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger ml-0.5">*</span>
        )}
      </label>
      <div className="mt-1">{withId}</div>
    </div>
  );
}
