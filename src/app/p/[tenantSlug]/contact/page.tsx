'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';

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
      <main className="min-h-screen flex items-center justify-center bg-page px-4">
        <div className="max-w-md text-center">
          <h1 className="text-h1">Recebemos!</h1>
          <p className="text-body-lg text-text-2 mt-3">
            Seu cadastro está aguardando aprovação. Em breve nosso time entra em contato.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-page py-12 px-4">
      <div className="mx-auto max-w-lg">
        <header className="mb-6">
          <h1 className="text-h1">Fale com a gente</h1>
          <p className="text-body-lg text-text-2 mt-2">
            Deixe seus dados que retornamos em breve.
          </p>
        </header>

        <form
          className="space-y-4 bg-card border border-border rounded-md p-5"
          noValidate
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
          <Field label="Nome completo" required>
            <Input
              required
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          </Field>
          <Field label="E-mail" required>
            <Input
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Telefone / WhatsApp">
            <Input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+55 11 91234-5678"
            />
          </Field>
          <Field label="Empresa">
            <Input
              value={form.companyRazaoSocial}
              onChange={(e) => setForm({ ...form, companyRazaoSocial: e.target.value })}
            />
          </Field>
          <Field label="Mensagem">
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
            />
          </Field>

          {mutation.error && (
            <p role="alert" className="rounded bg-danger-bg/40 border border-danger/30 p-2 text-caption text-danger-text">
              {mutation.error.message}
            </p>
          )}

          <Button type="submit" loading={mutation.isPending} variant="primary" size="lg" className="w-full">
            Enviar
          </Button>
        </form>
      </div>
    </main>
  );
}
