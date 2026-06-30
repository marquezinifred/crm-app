'use client';

import { trpc } from '@/lib/trpc/client';
import { useId, useState } from 'react';
import { ProductType } from '@prisma/client';
import { PageHeader } from '@/components/layout/PageHeader';

const TYPE_LABEL: Record<ProductType, string> = {
  ALOCACAO: 'Alocação',
  PROJETO_ESCOPO_FECHADO: 'Projeto escopo fechado',
  PROJETO_SQUAD: 'Projeto squad',
  PRODUTO: 'Produto',
  OUTRO: 'Outro',
};

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
  const list = trpc.products.list.useQuery({});
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const formTitleId = useId();

  const create = trpc.products.create.useMutation({
    onSuccess: () => {
      utils.products.list.invalidate();
      setForm(EMPTY);
      setError(null);
    },
    onError: (e) => setError(e.message),
  });
  const update = trpc.products.update.useMutation({
    onSuccess: () => {
      utils.products.list.invalidate();
      setForm(EMPTY);
      setError(null);
    },
    onError: (e) => setError(e.message),
  });
  const remove = trpc.products.remove.useMutation({
    onSuccess: () => utils.products.list.invalidate(),
  });

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

      <section aria-label="Lista de produtos" className="border rounded-lg bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Produtos e serviços cadastrados</caption>
          <thead className="bg-page">
            <tr>
              <th scope="col" className="text-left px-4 py-2 font-medium">Nome</th>
              <th scope="col" className="text-left px-4 py-2 font-medium">Tipo</th>
              <th scope="col" className="text-left px-4 py-2 font-medium">SKU</th>
              <th scope="col" className="text-right px-4 py-2 font-medium">Margem mín.</th>
              <th scope="col" className="text-left px-4 py-2 font-medium">Status</th>
              <th scope="col" className="text-right px-4 py-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-text-2">
                  Carregando...
                </td>
              </tr>
            )}
            {!list.isLoading && list.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-text-2">
                  Seu portfólio começa aqui. Cadastre o primeiro produto.
                </td>
              </tr>
            )}
            {list.data?.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2 text-text-2">{TYPE_LABEL[p.type]}</td>
                <td className="px-4 py-2 text-text-2 font-mono text-xs">
                  {p.sku ?? '—'}
                </td>
                <td className="px-4 py-2 text-right">
                  {Number(p.minMarginPct).toFixed(1)}%
                </td>
                <td className="px-4 py-2">
                  {p.active ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-success-bg text-success-text">
                      Ativo
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-hover text-text-1">
                      Inativo
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
