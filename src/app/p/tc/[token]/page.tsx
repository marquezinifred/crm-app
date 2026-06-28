'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';

export default function PublicTcAcceptPage() {
  const params = useParams<{ token: string }>();
  const { data, isLoading } = trpc.partners.publicTcView.useQuery({ token: params.token });
  const accept = trpc.partners.publicTcAccept.useMutation();
  const [form, setForm] = useState({ acceptedByName: '', acceptedByEmail: '' });
  const [done, setDone] = useState(false);

  if (isLoading) return <main className="p-6">Carregando…</main>;
  if (!data) {
    return (
      <main className="mx-auto max-w-md p-8 text-center">
        <h1 className="mb-2 text-xl font-bold">Link inválido ou expirado</h1>
        <p className="text-sm text-neutral-600">
          Solicite um novo link ao administrador do CRM.
        </p>
      </main>
    );
  }

  if (done) {
    return (
      <main className="mx-auto max-w-md p-8 text-center">
        <h1 className="mb-2 text-xl font-bold">Aceite registrado</h1>
        <p className="text-sm text-neutral-600">
          Obrigado, {form.acceptedByName}. Seu aceite foi registrado para fins de
          rastreabilidade contratual.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-4 md:p-6">
      <header className="mb-4">
        <p className="text-xs uppercase text-neutral-500">{data.tenantName}</p>
        <h1 className="text-2xl font-bold">Termos e Condições</h1>
        <p className="text-sm text-neutral-600">
          Parceiro: <strong>{data.partner.razaoSocial}</strong>
          {data.partner.tcVersion && ` · versão ${data.partner.tcVersion}`}
        </p>
      </header>

      <section className="mb-6 max-h-96 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4 text-sm whitespace-pre-line">
        {data.partner.tcText ?? '(Termos não configurados pelo administrador. Contate o CRM antes de prosseguir.)'}
      </section>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          accept.mutate(
            {
              token: params.token,
              acceptedByName: form.acceptedByName,
              acceptedByEmail: form.acceptedByEmail,
            },
            { onSuccess: () => setDone(true) },
          );
        }}
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Nome completo</span>
          <input
            required
            value={form.acceptedByName}
            onChange={(e) => setForm({ ...form, acceptedByName: e.target.value })}
            className="w-full rounded border px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">E-mail</span>
          <input
            required
            type="email"
            value={form.acceptedByEmail}
            onChange={(e) => setForm({ ...form, acceptedByEmail: e.target.value })}
            className="w-full rounded border px-3 py-2"
          />
        </label>

        {accept.error && (
          <p className="rounded bg-red-50 p-2 text-sm text-red-700">{accept.error.message}</p>
        )}

        <Button type="submit" disabled={accept.isPending || !data.partner.tcText}>
          {accept.isPending ? 'Registrando…' : 'Li e aceito os termos'}
        </Button>
      </form>
    </main>
  );
}
