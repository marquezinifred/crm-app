'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { DocumentCategory } from '@prisma/client';

const CATEGORIES: DocumentCategory[] = [
  'INSTITUCIONAL',
  'PROPOSTA_TECNICA',
  'PROPOSTA_COMERCIAL',
  'ORCAMENTO',
  'CONTRATO',
  'NDA',
  'TERMO_RESPONSABILIDADE',
  'ACEITE_CLIENTE',
  'OUTRO',
];

const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  INSTITUCIONAL: 'Institucional',
  PROPOSTA_TECNICA: 'Proposta técnica',
  PROPOSTA_COMERCIAL: 'Proposta comercial',
  ORCAMENTO: 'Orçamento / planilha',
  CONTRATO: 'Contrato',
  NDA: 'NDA',
  TERMO_RESPONSABILIDADE: 'Termo de responsabilidade',
  ACEITE_CLIENTE: 'Aceite do cliente',
  OUTRO: 'Outro',
};

export default function AdminTemplatesPage() {
  const utils = trpc.useUtils();
  const { data } = trpc.templates.list.useQuery({ activeOnly: false });

  const [form, setForm] = useState({
    category: 'PROPOSTA_TECNICA' as DocumentCategory,
    name: '',
    description: '',
    storageKey: '',
  });

  const create = trpc.templates.create.useMutation({
    onSuccess: () => {
      setForm({ ...form, name: '', description: '', storageKey: '' });
      utils.templates.list.invalidate();
    },
  });

  const grouped = CATEGORIES.map((cat) => ({
    category: cat,
    items: (data ?? []).filter((t) => t.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <main className="mx-auto max-w-3xl p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">Templates de documentos</h1>

      <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-700">
          Adicionar template
        </h2>
        <form
          className="space-y-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({
              category: form.category,
              name: form.name,
              description: form.description || undefined,
              storageKey: form.storageKey || undefined,
            });
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="mb-0.5 block text-xs">Categoria</span>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as DocumentCategory })}
                className="w-full rounded border px-2 py-1"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-0.5 block text-xs">Nome</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                minLength={2}
                className="w-full rounded border px-2 py-1"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-0.5 block text-xs">Descrição</span>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded border px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs">URL ou path do arquivo</span>
            <input
              value={form.storageKey}
              onChange={(e) => setForm({ ...form, storageKey: e.target.value })}
              placeholder="https://drive.google.com/… ou s3://bucket/path"
              className="w-full rounded border px-2 py-1"
            />
          </label>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Criando…' : 'Adicionar'}
          </Button>
        </form>
      </section>

      {grouped.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
          Nenhum template cadastrado.
        </p>
      ) : (
        grouped.map((g) => (
          <section key={g.category} className="mb-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-700">
              {CATEGORY_LABELS[g.category]}
            </h2>
            <ul className="space-y-1">
              {g.items.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 rounded border border-neutral-200 bg-white p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{t.name}</p>
                    {t.description && (
                      <p className="text-xs text-neutral-600">{t.description}</p>
                    )}
                    {t.currentVersionStorageKey && (
                      <a
                        href={t.currentVersionStorageKey}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-700 hover:underline"
                      >
                        ↓ v{t.currentVersionNumber}
                      </a>
                    )}
                  </div>
                  <span className="text-xs text-neutral-500">
                    {t.active ? 'ativo' : 'inativo'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
