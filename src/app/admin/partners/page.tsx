'use client';

import { useMemo, useState } from 'react';
import { trpc, type RouterOutputs } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { brl } from '@/lib/utils/hooks';
import {
  compareSortValues,
  resolveValue,
  type SortKey,
} from '@/lib/hooks/useTableSort';

type Partner = RouterOutputs['partners']['listWithStats'][number];
type SortOption = 'name' | 'commission' | 'active-deals';

const SORT_ACCESSORS: Record<SortOption, SortKey<Partner>> = {
  name: 'razaoSocial',
  commission: (p) => Number(p.commissionPct),
  'active-deals': (p) => p.totalDeals - p.won,
};

export default function AdminPartnersPage() {
  const { data, isLoading } = trpc.partners.listWithStats.useQuery();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const rows = useMemo(() => data ?? [], [data]);
  const sorted = useMemo(() => {
    const accessor = SORT_ACCESSORS[sortBy];
    const copy = rows.slice();
    copy.sort((a, b) => {
      const cmp = compareSortValues(resolveValue(a, accessor), resolveValue(b, accessor));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortBy, sortDir]);

  if (isLoading) return <main className="p-6">Carregando…</main>;

  return (
    <main className="mx-auto max-w-5xl p-4 md:p-6">
      <PageHeader
        title="Parceiros"
        description="Cadastro e comissão por vínculo — comissão padrão, T&C e performance por parceiro."
      />
      <p className="-mt-4 mb-4 text-caption text-text-2">
        Para cadastrar uma nova empresa parceira, vá em{' '}
        <a href="/companies/new" className="text-info-text hover:underline">/companies/new</a>{' '}
        e marque tipo = PARTNER.
      </p>

      {rows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="partner-sort" className="text-text-2">
            Ordenar por
          </label>
          <select
            id="partner-sort"
            value={`${sortBy}:${sortDir}`}
            onChange={(e) => {
              const [opt, dir] = e.target.value.split(':') as [SortOption, 'asc' | 'desc'];
              setSortBy(opt);
              setSortDir(dir);
            }}
            className="rounded border border-border bg-card px-2 py-1 focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <option value="name:asc">Nome (A→Z)</option>
            <option value="name:desc">Nome (Z→A)</option>
            <option value="commission:desc">Comissão (maior)</option>
            <option value="commission:asc">Comissão (menor)</option>
            <option value="active-deals:desc">Contratos abertos (maior)</option>
            <option value="active-deals:asc">Contratos abertos (menor)</option>
          </select>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded border border-dashed border-border-strong p-6 text-center text-sm text-text-2">
          Sem parceiros ainda. Cadastre o primeiro.
        </p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((p) => (
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
  const { toast } = useToast();
  const { data: tc } = trpc.partners.getTcText.useQuery({ partnerCompanyId: partnerId });
  const [commission, setCommission] = useState<string>('');
  const [tcVersion, setTcVersion] = useState('');
  const [tcText, setTcText] = useState('');

  const save = trpc.partners.updatePartnerConfig.useMutation({
    onSuccess: () => {
      utils.partners.listWithStats.invalidate();
      utils.partners.getTcText.invalidate({ partnerCompanyId: partnerId });
      toast({ kind: 'success', title: 'Configuração do parceiro salva.' });
    },
    onError: (e) => toast({ kind: 'error', title: friendlyTrpcError(e) }),
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
