'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { trpc, type RouterOutputs } from '@/lib/trpc/client';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/input';
import { Table, THead, TBody, TH, TR, TD, TableEmpty } from '@/components/ui/table';
import type { AiFeatureCategory, AiFeatureStatus } from '@prisma/client';

/**
 * Toggle de features IA por tenant — P-06 tela 2.
 *
 * Consome `platform.aiMarketplace.tenantAccessList({tenantId})` que retorna
 * uma linha por feature ativa no catálogo com o state atual do tenant (ou
 * null se DISABLED implícito). Mutação via `tenantAccessSet` — audit é
 * gravado no router com `tenantIdOverride` explícito.
 */
export default function PlatformTenantAiFeaturesPage({
  params,
}: {
  params: { id: string };
}) {
  const utils = trpc.useUtils();
  const tenantQ = trpc.platform.tenantById.useQuery({ id: params.id });
  const listQ = trpc.platform.aiMarketplace.tenantAccessList.useQuery({
    tenantId: params.id,
  });

  const setStatus = trpc.platform.aiMarketplace.tenantAccessSet.useMutation({
    onSuccess: () =>
      utils.platform.aiMarketplace.tenantAccessList.invalidate({ tenantId: params.id }),
  });

  const grouped = useMemo(() => {
    const map = new Map<
      AiFeatureCategory,
      RouterOutputs['platform']['aiMarketplace']['tenantAccessList']
    >();
    for (const row of listQ.data ?? []) {
      const key = row.feature.category;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return map;
  }, [listQ.data]);

  if (tenantQ.isLoading || listQ.isLoading) {
    return (
      <div className="space-y-3">
        <div className="skeleton h-8 w-1/2" />
        <div className="skeleton h-4 w-1/3" />
      </div>
    );
  }
  if (tenantQ.error || !tenantQ.data) {
    return (
      <p role="alert" className="text-body text-danger">
        {tenantQ.error?.message ?? 'Tenant não encontrado.'}
      </p>
    );
  }

  const { tenant } = tenantQ.data;
  const totalFeatures = listQ.data?.length ?? 0;
  const activeCount =
    listQ.data?.filter((r) => r.state && r.state.status !== 'DISABLED').length ?? 0;

  return (
    <div className="space-y-6 max-w-5xl">
      <nav aria-label="Trilha" className="text-caption text-text-2">
        <Link
          href={`/platform/tenants/${tenant.id}`}
          className="underline hover:text-text-1"
        >
          ← Voltar para {tenant.name}
        </Link>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1">Features IA · {tenant.name}</h1>
          <p className="text-caption text-text-2 font-mono mt-1">{tenant.slug}</p>
          <div className="mt-2 flex gap-2 flex-wrap">
            <Badge variant="primary">{tenant.plan}</Badge>
            <Badge variant="default">
              {activeCount}/{totalFeatures} ativa{activeCount === 1 ? '' : 's'}
            </Badge>
          </div>
        </div>
        <Link
          href={`/platform/tenants/${tenant.id}/ai`}
          className="text-caption text-brand-primary-light hover:underline"
        >
          ← Uso e limites
        </Link>
      </header>

      {setStatus.error && (
        <p role="alert" className="text-caption text-danger">
          {setStatus.error.message}
        </p>
      )}

      {totalFeatures === 0 && (
        <p className="text-body text-text-2">
          Catálogo vazio — rode o seed em <code>/platform/ai-marketplace</code>.
        </p>
      )}

      {Array.from(grouped.entries()).map(([category, rows]) => (
        <section key={category} className="rounded-md border border-border bg-card p-5">
          <h2 className="text-h3 mb-4">{humanizeCategory(category)}</h2>
          <Table>
            <THead>
              <tr>
                <TH>Feature</TH>
                <TH>Provider default</TH>
                <TH>Add-on R$/mês</TH>
                <TH>Status atual</TH>
                <TH>Alterar</TH>
                <TH>Add-on ativado em</TH>
              </tr>
            </THead>
            <TBody>
              {rows.length === 0 && (
                <TableEmpty colSpan={6}>Sem features nesta categoria.</TableEmpty>
              )}
              {rows.map(({ feature, state }) => {
                const current: AiFeatureStatus = state?.status ?? 'DISABLED';
                return (
                  <TR key={feature.id}>
                    <TD>
                      <span className="font-medium">{feature.name}</span>
                      <p className="text-caption text-text-3 mt-0.5 max-w-md">
                        {feature.description}
                      </p>
                      <code className="text-caption font-mono text-brand-primary-light">
                        {feature.code}
                      </code>
                    </TD>
                    <TD className="text-caption text-text-2 font-mono">
                      {feature.defaultProvider}
                      <span className="block text-text-3">{feature.defaultModel}</span>
                    </TD>
                    <TD className="font-mono tabular-nums">
                      {feature.addonPriceBrlMonthly
                        ? `R$ ${Number(feature.addonPriceBrlMonthly).toFixed(2)}`
                        : '—'}
                    </TD>
                    <TD>
                      <StatusBadge status={current} />
                    </TD>
                    <TD>
                      <Select
                        aria-label={`Status de ${feature.name}`}
                        value={current}
                        disabled={setStatus.isPending}
                        onChange={(e) =>
                          setStatus.mutate({
                            tenantId: params.id,
                            featureId: feature.id,
                            status: e.target.value as AiFeatureStatus,
                          })
                        }
                      >
                        <option value="DISABLED">Desativada</option>
                        <option value="INCLUDED">Incluída</option>
                        <option value="ADDON_ACTIVE">Add-on ativo</option>
                      </Select>
                    </TD>
                    <TD className="text-caption text-text-3">
                      {state?.addonActivatedAt
                        ? new Date(state.addonActivatedAt).toLocaleDateString('pt-BR')
                        : '—'}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </section>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: AiFeatureStatus }) {
  if (status === 'ADDON_ACTIVE') return <Badge variant="primary">Add-on</Badge>;
  if (status === 'INCLUDED') return <Badge variant="success">Incluída</Badge>;
  return <Badge variant="default">Desativada</Badge>;
}

function humanizeCategory(cat: AiFeatureCategory): string {
  switch (cat) {
    case 'SUMMARIZATION':
      return 'Sumarização';
    case 'SCORING':
      return 'Scoring / Previsão';
    case 'SEARCH':
      return 'Busca semântica';
    case 'CLASSIFICATION':
      return 'Classificação';
    case 'GENERATION':
      return 'Geração de conteúdo';
    case 'EXTRACTION':
      return 'Extração';
    default:
      return cat;
  }
}
