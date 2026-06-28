'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';

export default function PublicContactRegistrationPage() {
  const params = useParams<{ tenantSlug: string }>();
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    companyRazaoSocial: '',
    notes: '',
  });
  const [done, setDone] = useState(false);

  const mutation = trpc.contacts.selfRegister.useMutation({
    onSuccess: () => setDone(true),
  });

  if (done) {
    return (
      <main className="mx-auto max-w-lg p-8 text-center">
        <h1 className="mb-2 text-2xl font-bold">Obrigado!</h1>
        <p className="text-sm text-neutral-600">
          Seu cadastro foi recebido e aguarda aprovação pelo administrador.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="mb-4 text-2xl font-bold">Auto-cadastro de Contato</h1>
      <p className="mb-4 text-sm text-neutral-600">
        Preencha seus dados para entrar em contato.
      </p>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate({
            tenantSlug: params.tenantSlug,
            fullName: form.fullName,
            email: form.email,
            phone: form.phone || undefined,
            companyRazaoSocial: form.companyRazaoSocial || undefined,
            notes: form.notes || undefined,
          });
        }}
      >
        <Field label="Nome completo *">
          <input
            required
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            className="w-full rounded border px-3 py-2"
          />
        </Field>
        <Field label="E-mail *">
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full rounded border px-3 py-2"
          />
        </Field>
        <Field label="Telefone / WhatsApp">
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+55 11 91234-5678"
            className="w-full rounded border px-3 py-2"
          />
        </Field>
        <Field label="Empresa">
          <input
            value={form.companyRazaoSocial}
            onChange={(e) => setForm({ ...form, companyRazaoSocial: e.target.value })}
            className="w-full rounded border px-3 py-2"
          />
        </Field>
        <Field label="Mensagem (opcional)">
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
            className="w-full rounded border px-3 py-2"
          />
        </Field>

        {mutation.error && (
          <p className="rounded bg-red-50 p-2 text-sm text-red-700">
            {mutation.error.message}
          </p>
        )}

        <Button type="submit" disabled={mutation.isLoading}>
          {mutation.isLoading ? 'Enviando…' : 'Enviar'}
        </Button>
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
