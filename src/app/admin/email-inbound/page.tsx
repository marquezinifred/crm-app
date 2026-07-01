'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { Button } from '@/components/ui/button';

export default function EmailInboundConfigPage() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.adminEmail.getSlug.useQuery();
  const [slug, setSlug] = useState('');
  const setSlugMut = trpc.adminEmail.setSlug.useMutation({
    onSuccess: () => {
      setSlug('');
      utils.adminEmail.getSlug.invalidate();
    },
  });
  const regenMut = trpc.adminEmail.regenerateSlug.useMutation({
    onSuccess: () => utils.adminEmail.getSlug.invalidate(),
  });

  if (isLoading || !data) return <main className="p-6">Carregando…</main>;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-2xl font-bold">E-mail Inbound</h1>
      <p className="mb-4 text-sm text-text-2">
        Endereço único do seu tenant para receber e-mails. Tudo que chegar aqui
        vira atividade vinculada à oportunidade automaticamente (ou fica
        em /inbox para você revisar).
      </p>

      {data.fullAddress ? (
        <section className="mb-6 rounded-lg border border-border bg-card p-4">
          <p className="mb-2 text-xs font-medium uppercase text-text-1">
            Endereço ativo
          </p>
          <code className="block break-all rounded bg-hover p-3 text-sm">
            {data.fullAddress}
          </code>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigator.clipboard.writeText(data.fullAddress!)}
            >
              Copiar
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={regenMut.isPending}
              onClick={() => {
                if (confirm('Regenerar invalida o endereço atual. Continuar?')) {
                  regenMut.mutate();
                }
              }}
            >
              Regenerar
            </Button>
          </div>
        </section>
      ) : (
        <section className="mb-6 rounded-lg border border-warning/30 bg-warning-bg p-4">
          <p className="mb-2 text-sm text-warning-text">
            Sem endereço inbound. Defina um slug abaixo para começar a receber e-mails no CRM.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^[a-z0-9-]{4,40}$/.test(slug)) setSlugMut.mutate({ slug });
            }}
          >
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="meu-tenant"
              className="flex-1 rounded border px-3 py-2"
            />
            <Button type="submit" disabled={setSlugMut.isPending}>
              Salvar
            </Button>
          </form>
          {setSlugMut.error && (
            <p className="mt-2 text-sm text-danger">{friendlyTrpcError(setSlugMut.error)}</p>
          )}
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-1">
          Como usar
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-text-1">
          <li>Configure este endereço como destino do webhook inbound no seu provedor (Postmark Inbound ou Resend Inbound).</li>
          <li>Encaminhe ou envie e-mails para este endereço — o CRM detecta o tenant pelo slug.</li>
          <li>
            Para garantir vínculo direto a uma oportunidade, inclua{' '}
            <code className="rounded bg-hover px-1">#{'<id-da-oportunidade>'}</code> no assunto.
          </li>
          <li>Sem isso, a IA tenta inferir pelos contatos cadastrados; falhando, o item fica em /inbox.</li>
        </ol>
      </section>
    </main>
  );
}
