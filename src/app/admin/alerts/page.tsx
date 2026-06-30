'use client';

import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';

export default function AdminAlertsPage() {
  const { data, isLoading } = trpc.alerts.tenantConfig.useQuery();
  const utils = trpc.useUtils();
  const [leadDays, setLeadDays] = useState<number[]>([]);
  const [centralEmail, setCentralEmail] = useState('');
  const [overdueDays, setOverdueDays] = useState(2);

  useEffect(() => {
    if (data) {
      setLeadDays(data.alertLeadDays);
      setCentralEmail(data.centralCrmEmail ?? '');
      setOverdueDays(data.taskOverdueDays);
    }
  }, [data]);

  const save = trpc.alerts.updateConfig.useMutation({
    onSuccess: () => utils.alerts.tenantConfig.invalidate(),
  });

  if (isLoading || !data) return <main className="p-6">Carregando…</main>;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Configuração de Alertas</h1>

      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({
            alertLeadDays: leadDays,
            centralCrmEmail: centralEmail || null,
            taskOverdueDays: overdueDays,
          });
        }}
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Antecedência dos alertas (em dias)
          </span>
          <p className="mb-2 text-xs text-text-2">
            Lista de dias antes da data para disparar alerta. Padrão: 7 e 1.
          </p>
          <div className="flex flex-wrap gap-2">
            {leadDays.map((n, i) => (
              <span
                key={i}
                className="flex items-center gap-1 rounded-full bg-hover px-3 py-1 text-sm"
              >
                {n}d
                <button
                  type="button"
                  onClick={() => setLeadDays(leadDays.filter((_, idx) => idx !== i))}
                  className="text-text-2 hover:text-danger"
                  aria-label={`Remover ${n} dias`}
                >
                  ×
                </button>
              </span>
            ))}
            <AddLeadDay onAdd={(n) => setLeadDays([...leadDays, n].sort((a, b) => b - a))} />
          </div>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">E-mail da Central de CRM</span>
          <p className="mb-2 text-xs text-text-2">
            Cada alerta é enviado também para este endereço, em paralelo ao responsável.
          </p>
          <input
            type="email"
            value={centralEmail}
            onChange={(e) => setCentralEmail(e.target.value)}
            placeholder="crm@suaempresa.com.br"
            className="w-full rounded border px-3 py-2"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Dias para escalonamento de tarefas atrasadas
          </span>
          <input
            type="number"
            min="0"
            max="30"
            value={overdueDays}
            onChange={(e) => setOverdueDays(Number(e.target.value))}
            className="w-32 rounded border px-3 py-2"
          />
        </label>

        {save.error && (
          <p className="rounded bg-red-50 p-2 text-sm text-danger">{save.error.message}</p>
        )}

        <Button type="submit" disabled={save.isLoading || leadDays.length === 0}>
          {save.isLoading ? 'Salvando…' : 'Salvar'}
        </Button>
      </form>
    </main>
  );
}

function AddLeadDay({ onAdd }: { onAdd: (n: number) => void }) {
  const [v, setV] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(v);
        if (Number.isInteger(n) && n >= 0 && n <= 60) {
          onAdd(n);
          setV('');
        }
      }}
      className="flex items-center gap-1"
    >
      <input
        type="number"
        min="0"
        max="60"
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="+ dias"
        className="w-20 rounded border px-2 py-1 text-sm"
      />
    </form>
  );
}
