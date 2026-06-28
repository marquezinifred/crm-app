'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { OpportunitySource } from '@prisma/client';

export default function NewOpportunityPage() {
  const router = useRouter();
  const me = trpc.users.me.useQuery();
  const companies = trpc.companies.list.useQuery({ type: 'CLIENT', page: 1, pageSize: 100 });
  const partners = trpc.companies.list.useQuery({ type: 'PARTNER', page: 1, pageSize: 100 });
  const users = trpc.users.list.useQuery({ active: true });

  const [form, setForm] = useState<{
    title: string;
    clientCompanyId: string;
    ownerId: string;
    source: OpportunitySource;
    sourceDetail: string;
    estimatedValue: string;
    expectedCloseDate: string;
    description: string;
    partnerCompanyId: string;
  }>({
    title: '',
    clientCompanyId: '',
    ownerId: '',
    source: OpportunitySource.INDICACAO,
    sourceDetail: '',
    estimatedValue: '',
    expectedCloseDate: '',
    description: '',
    partnerCompanyId: '',
  });

  const create = trpc.opportunities.create.useMutation({
    onSuccess: (opp) => router.push(`/pipeline/${opp.id}`),
  });

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Nova oportunidade</h1>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({
            title: form.title,
            clientCompanyId: form.clientCompanyId,
            ownerId: form.ownerId || me.data?.id || '',
            source: form.source,
            sourceDetail: form.sourceDetail || undefined,
            estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : undefined,
            expectedCloseDate: form.expectedCloseDate ? new Date(form.expectedCloseDate) : undefined,
            description: form.description || undefined,
            partnerCompanyId: form.partnerCompanyId || undefined,
          });
        }}
      >
        <Field label="Título *">
          <input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full rounded border px-3 py-2"
          />
        </Field>

        <Field label="Empresa cliente *">
          <select
            required
            value={form.clientCompanyId}
            onChange={(e) => setForm({ ...form, clientCompanyId: e.target.value })}
            className="w-full rounded border px-3 py-2"
          >
            <option value="">Selecione…</option>
            {companies.data?.rows.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nomeFantasia ?? c.razaoSocial}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Responsável interno *">
          <select
            required
            value={form.ownerId}
            onChange={(e) => setForm({ ...form, ownerId: e.target.value })}
            className="w-full rounded border px-3 py-2"
          >
            <option value="">Selecione…</option>
            {users.data
              ?.filter((u) => u.role !== 'PARCEIRO')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} ({u.role})
                </option>
              ))}
          </select>
        </Field>

        <Field label="Origem *">
          <select
            value={form.source}
            onChange={(e) =>
              setForm({ ...form, source: e.target.value as OpportunitySource })
            }
            className="w-full rounded border px-3 py-2"
          >
            {Object.values(OpportunitySource).map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </Field>

        {form.source === 'PARCEIRO' && (
          <Field label="Parceiro indicado">
            <select
              value={form.partnerCompanyId}
              onChange={(e) => setForm({ ...form, partnerCompanyId: e.target.value })}
              className="w-full rounded border px-3 py-2"
            >
              <option value="">Selecione…</option>
              {partners.data?.rows.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nomeFantasia ?? c.razaoSocial}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Valor estimado (R$)">
            <input
              type="number"
              min="0"
              step="100"
              value={form.estimatedValue}
              onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })}
              className="w-full rounded border px-3 py-2"
            />
          </Field>
          <Field label="Data prevista de fechamento">
            <input
              type="date"
              value={form.expectedCloseDate}
              onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })}
              className="w-full rounded border px-3 py-2"
            />
          </Field>
        </div>

        <Field label="Descrição">
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="w-full rounded border px-3 py-2"
          />
        </Field>

        {create.error && (
          <p className="rounded bg-red-50 p-2 text-sm text-red-700">{create.error.message}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded border border-neutral-300 px-4 py-2 text-sm"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={create.isLoading}
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
          >
            {create.isLoading ? 'Criando…' : 'Criar oportunidade'}
          </button>
        </div>
      </form>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
