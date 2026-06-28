'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';

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
      router.push('/');
    },
    onError: (err) => setError(err.message),
  });

  if (!isLoaded) return <div className="p-8">Carregando…</div>;
  if (!user) return <div className="p-8">Faça login para continuar.</div>;

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="mb-2 text-2xl font-bold">Configurar Empresa Vendedora</h1>
      <p className="mb-6 text-sm text-neutral-600">
        Olá, {user.firstName ?? user.emailAddresses[0]?.emailAddress}. Vamos criar o
        primeiro tenant. Você será o ADMIN.
      </p>

      <form
        className="space-y-4"
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
        <Field label="Nome do tenant (apelido interno)">
          <input
            required
            value={form.tenantName}
            onChange={(e) => setForm({ ...form, tenantName: e.target.value })}
            className="w-full rounded border px-3 py-2"
          />
        </Field>

        <Field label="Slug do tenant (subdomínio futuro: minha-empresa.crm)">
          <input
            required
            value={form.tenantSlug}
            onChange={(e) =>
              setForm({ ...form, tenantSlug: e.target.value.toLowerCase() })
            }
            placeholder="minha-empresa"
            className="w-full rounded border px-3 py-2"
          />
        </Field>

        <Field label="Razão social">
          <input
            required
            value={form.razaoSocial}
            onChange={(e) => setForm({ ...form, razaoSocial: e.target.value })}
            className="w-full rounded border px-3 py-2"
          />
        </Field>

        <Field label="CNPJ">
          <input
            required
            value={form.cnpj}
            onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
            placeholder="00.000.000/0000-00"
            className="w-full rounded border px-3 py-2"
          />
        </Field>

        <Field label="E-mail da Central de CRM (opcional)">
          <input
            type="email"
            value={form.centralCrmEmail}
            onChange={(e) => setForm({ ...form, centralCrmEmail: e.target.value })}
            placeholder="crm@suaempresa.com.br"
            className="w-full rounded border px-3 py-2"
          />
        </Field>

        {error && (
          <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>
        )}

        <Button type="submit" disabled={mutation.isLoading}>
          {mutation.isLoading ? 'Criando…' : 'Criar tenant'}
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
