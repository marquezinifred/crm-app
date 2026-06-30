'use client';

import { trpc } from '@/lib/trpc/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TH, TR, TD, TableEmpty } from '@/components/ui/table';

export default function PlatformAiMarketplacePage() {
  const list = trpc.platform.aiMarketplace.list.useQuery();

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Marketplace"
        description="Catálogo de features de IA disponíveis para os tenants. Edição por tenant em /platform/tenants/[id]/ai/features."
        meta={list.data && `${list.data.length} feature${list.data.length === 1 ? '' : 's'}`}
      />

      <Table>
        <THead>
          <tr>
            <TH>Code</TH>
            <TH>Nome</TH>
            <TH>Categoria</TH>
            <TH>Provider/Model</TH>
            <TH>Add-on R$/mês</TH>
            <TH>Tenants ativos</TH>
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {list.data && list.data.length === 0 && (
            <TableEmpty colSpan={7}>Catálogo vazio — rode o seed.</TableEmpty>
          )}
          {list.data?.map((f) => (
            <TR key={f.id}>
              <TD>
                <code className="text-mono text-caption text-brand-primary-light">{f.code}</code>
              </TD>
              <TD>
                <span className="font-medium">{f.name}</span>
                <p className="text-caption text-text-3 mt-0.5 max-w-xs">{f.description}</p>
              </TD>
              <TD><Badge variant="default">{f.category}</Badge></TD>
              <TD className="text-caption text-text-2 font-mono">
                {f.defaultProvider}
                <span className="block text-text-3">{f.defaultModel}</span>
              </TD>
              <TD className="font-mono tabular-nums text-text-1">
                {f.addonPriceBrlMonthly ? `R$ ${Number(f.addonPriceBrlMonthly).toFixed(2)}` : '—'}
              </TD>
              <TD className="text-text-2">{f._count.tenantStates}</TD>
              <TD>
                <Badge variant={f.active ? 'success' : 'default'}>
                  {f.active ? 'Ativa' : 'Desligada'}
                </Badge>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
