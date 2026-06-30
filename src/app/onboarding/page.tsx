'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export default function OnboardingPage() {
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const [form, setForm] = useState({
    tenantName: '',
    tenantSlug: '',
    razaoSocial: '',
    cnpj: '',
    centralCrmEmail: '',
  });
  const [error, setError] = useState<string | null>(null);

  const mutation = trpc.onboarding.createFirstTenant.useMutation({
    onSuccess: () => {
      router.refresh();
      router.push('/onboarding/setup');
    },
    onError: (err) => setError(err.message),
  });

  if (!isLoaded) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-page">
        <p className="text-body text-text-2">Carregando…</p>
      </main>
    );
  }
  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-page">
        <p className="text-body text-text-2">Faça login para continuar.</p>
      </main>
    );
  }

  const firstName = user.firstName ?? user.emailAddresses[0]?.emailAddress?.split('@')[0] ?? '';

  return (
    <main className="min-h-screen bg-page py-12 px-4">
      <div className="mx-auto max-w-xl">
        <header className="text-center mb-8">
          <div className="text-[24px] font-black text-brand-primary-light tracking-tight mb-3">VENZO</div>
          <h1 className="text-h1">Bem-vindo{firstName && `, ${firstName}`}.</h1>
          <p className="text-body-lg text-text-2 mt-2">
            Vamos configurar sua empresa. Você será o admin.
          </p>
        </header>

        <form
          className="space-y-4 bg-card border border-border rounded-md p-6"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mutation.mutate({
              tenantName: form.tenantName,
              tenantSlug: form.tenantSlug,
              razaoSocial: form.razaoSocial,
              cnpj: form.cnpj,
              centralCrmEmail: form.centralCrmEmail || undefined,
            });
          }}
        >
          <Field label="Nome do tenant" helper="Apelido interno, ex: Minha Empresa." required>
            <Input
              required
              value={form.tenantName}
              onChange={(e) => setForm({ ...form, tenantName: e.target.value })}
            />
          </Field>

          <Field label="Slug" helper="Aparece no e-mail inbound: crm-{seu-slug}@..." required>
            <Input
              required
              value={form.tenantSlug}
              onChange={(e) => setForm({ ...form, tenantSlug: e.target.value.toLowerCase() })}
              placeholder="minha-empresa"
            />
          </Field>

          <Field label="Razão social" required>
            <Input
              required
              value={form.razaoSocial}
              onChange={(e) => setForm({ ...form, razaoSocial: e.target.value })}
            />
          </Field>

          <Field label="CNPJ" required>
            <Input
              required
              value={form.cnpj}
              onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
              placeholder="00.000.000/0000-00"
            />
          </Field>

          <Field label="E-mail da Central de CRM" helper="Opcional. Recebe handoffs de contrato.">
            <Input
              type="email"
              value={form.centralCrmEmail}
              onChange={(e) => setForm({ ...form, centralCrmEmail: e.target.value })}
              placeholder="crm@suaempresa.com.br"
            />
          </Field>

          {error && (
            <p role="alert" className="rounded bg-danger-bg/40 border border-danger/30 p-2 text-caption text-danger-text">
              {error}
            </p>
          )}

          <Button type="submit" loading={mutation.isPending} variant="primary" size="lg" className="w-full">
            Criar empresa
          </Button>
        </form>
      </div>
    </main>
  );
}
