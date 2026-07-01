'use client';

import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';

export default function AdminContractsPage() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.contractsConfig.getConfig.useQuery();
  const [handoffEmails, setHandoffEmails] = useState<string[]>([]);
  const [renewalDays, setRenewalDays] = useState<number[]>([]);
  const [newEmail, setNewEmail] = useState('');

  useEffect(() => {
    if (data) {
      setHandoffEmails(data.handoffEmails);
      setRenewalDays(data.contractRenewalLeadDays);
    }
  }, [data]);

  const save = trpc.contractsConfig.updateConfig.useMutation({
    onSuccess: () => utils.contractsConfig.getConfig.invalidate(),
  });

  if (isLoading || !data) return <main className="p-6">Carregando…</main>;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <PageHeader
        title="Contratos"
        description="E-mails de handoff e lead times de renovação."
      />

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ handoffEmails, contractRenewalLeadDays: renewalDays });
        }}
      >
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">E-mails de handoff</h2>
          <p className="mb-2 text-xs text-text-2">
            Destinatários quando um contrato vira ATIVO (operações, financeiro).
          </p>
          <div className="mb-2 flex flex-wrap gap-2">
            {handoffEmails.map((e) => (
              <span key={e} className="flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-xs">
                {e}
                <button
                  type="button"
                  onClick={() => setHandoffEmails(handoffEmails.filter((x) => x !== e))}
                  className="text-text-2 hover:text-danger"
                  aria-label={`Remover ${e}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="financeiro@empresa.com"
              className="flex-1 rounded border px-2 py-1 text-sm"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (newEmail && !handoffEmails.includes(newEmail)) {
                  setHandoffEmails([...handoffEmails, newEmail]);
                  setNewEmail('');
                }
              }}
            >
              Adicionar
            </Button>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Antecedência alertas de renovação (dias)</h2>
          <div className="flex flex-wrap gap-2">
            {renewalDays.map((d, i) => (
              <span key={i} className="flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-xs">
                {d}d
                <button
                  type="button"
                  onClick={() => setRenewalDays(renewalDays.filter((_, idx) => idx !== i))}
                  className="text-text-2 hover:text-danger"
                  aria-label={`Remover ${d}`}
                >
                  ×
                </button>
              </span>
            ))}
            <AddDays onAdd={(n) => setRenewalDays([...renewalDays, n].sort((a, b) => b - a))} />
          </div>
        </section>

        <Button type="submit" disabled={save.isPending || renewalDays.length === 0}>
          {save.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </form>
    </main>
  );
}

function AddDays({ onAdd }: { onAdd: (n: number) => void }) {
  const [v, setV] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(v);
        if (Number.isInteger(n) && n >= 1 && n <= 365) {
          onAdd(n);
          setV('');
        }
      }}
      className="flex"
    >
      <input
        type="number"
        min="1"
        max="365"
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="+ dias"
        className="w-20 rounded border px-2 py-0.5 text-xs"
      />
    </form>
  );
}
