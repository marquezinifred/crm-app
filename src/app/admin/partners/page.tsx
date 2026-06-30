'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { brl } from '@/lib/utils/hooks';

export default function AdminPartnersPage() {
  const { data, isLoading } = trpc.partners.listWithStats.useQuery();
  const [editingId, setEditingId] = useState<string | null>(null);

  if (isLoading) return <main className="p-6">Carregando…</main>;

  return (
    <main className="mx-auto max-w-5xl p-4 md:p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Parceiros</h1>
        <p className="text-sm text-text-2">
          Gestão de empresas parceiras: comissão padrão, T&C, performance.
          Para cadastrar uma nova empresa parceira, vá em{' '}
          <a href="/companies/new" className="text-info-text hover:underline">/companies/new</a>{' '}
          e marque tipo = PARTNER.
        </p>
      </header>

      {data && data.length === 0 ? (
        <p className="rounded border border-dashed border-border-strong p-6 text-center text-sm text-text-2">
          Sem parceiros ainda. Cadastre o primeiro.
        </p>
      ) : (
        <ul className="space-y-3">
          {data?.map((p) => (
            <li key={p.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-medium">{p.razaoSocial}</h2>
                  <p className="text-xs text-text-2">
                    {p.cnpj ?? 'sem CNPJ'} · comissão {p.commissionPct}% ·{' '}
                    {p.partnerActive ? 'ativo' : 'inativo'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                >
                  {editingId === p.id ? 'Fechar' : 'Configurar'}
                </Button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                <Stat label="Total deals" value={String(p.totalDeals)} />
                <Stat label="Ganhos" value={String(p.won)} />
                <Stat label="Receita ganha" value={brl(p.wonValue)} />
                <Stat label="Comissão" value={brl(p.commissionAccrued)} />
              </div>

              {editingId === p.id && <PartnerConfigForm partnerId={p.id} />}

              {p.partnerUsers.length > 0 && (
                <div className="mt-3 border-t border-border pt-2">
                  <p className="mb-1 text-xs font-medium text-text-1">Usuários parceiros</p>
                  <ul className="space-y-0.5 text-xs">
                    {p.partnerUsers.map((u) => (
                      <li key={u.id}>
                        {u.fullName} · {u.email}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function PartnerConfigForm({ partnerId }: { partnerId: string }) {
  const utils = trpc.useUtils();
  const { data: tc } = trpc.partners.getTcText.useQuery({ partnerCompanyId: partnerId });
  const [commission, setCommission] = useState<string>('');
  const [tcVersion, setTcVersion] = useState('');
  const [tcText, setTcText] = useState('');

  const save = trpc.partners.updatePartnerConfig.useMutation({
    onSuccess: () => {
      utils.partners.listWithStats.invalidate();
      utils.partners.getTcText.invalidate({ partnerCompanyId: partnerId });
    },
  });

  return (
    <form
      className="mt-3 space-y-2 border-t border-border pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          partnerCompanyId: partnerId,
          ...(commission !== '' ? { commissionPct: Number(commission) } : {}),
          ...(tcVersion ? { tcVersion } : {}),
          ...(tcText ? { tcText } : {}),
        });
      }}
    >
      <div className="grid grid-cols-2 gap-2 text-sm">
        <label>
          <span className="mb-0.5 block text-xs">Comissão (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
            placeholder="ex: 10"
            className="w-full rounded border px-2 py-1"
          />
        </label>
        <label>
          <span className="mb-0.5 block text-xs">Versão T&C</span>
          <input
            value={tcVersion}
            onChange={(e) => setTcVersion(e.target.value)}
            placeholder={tc?.tcVersion ?? 'ex: 1.0'}
            className="w-full rounded border px-2 py-1"
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-0.5 block text-xs">Texto T&C</span>
        <textarea
          rows={4}
          value={tcText}
          onChange={(e) => setTcText(e.target.value)}
          placeholder={tc?.tcText?.slice(0, 100) ?? 'Cole o texto…'}
          className="w-full rounded border px-2 py-1"
        />
      </label>
      <Button type="submit" size="sm" disabled={save.isPending}>
        {save.isPending ? 'Salvando…' : 'Salvar'}
      </Button>
    </form>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border p-2">
      <p className="text-text-2">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
