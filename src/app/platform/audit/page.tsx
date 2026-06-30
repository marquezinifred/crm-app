'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/controls';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TH, TR, TD, TableEmpty, TableSkeleton } from '@/components/ui/table';

export default function PlatformAuditPage() {
  const [actionFilter, setActionFilter] = useState('');
  const [impersonatedOnly, setImpersonatedOnly] = useState(false);
  const list = trpc.platform.auditList.useQuery({
    action: actionFilter || undefined,
    impersonatedOnly,
    limit: 200,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log cross-tenant"
        description="Todas as ações sensíveis do produto, incluindo impersonações."
        meta={list.data && `${list.data.length} eventos`}
      />

      <div className="flex flex-wrap gap-3 items-end">
        <Field label="Filtrar por ação" className="min-w-[260px]">
          <Input
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="ex: platform.tenant.create"
          />
        </Field>
        <label className="flex items-center gap-2 text-body text-text-1">
          <Checkbox
            checked={impersonatedOnly}
            onChange={(e) => setImpersonatedOnly(e.target.checked)}
          />
          Somente impersonações
        </label>
      </div>

      <Table>
        <THead>
          <tr>
            <TH>Ação</TH>
            <TH>Tabela</TH>
            <TH>Tenant</TH>
            <TH>Impersonação</TH>
            <TH>Quando</TH>
          </tr>
        </THead>
        {list.isLoading ? (
          <TableSkeleton cols={5} rows={6} />
        ) : (
          <TBody>
            {list.data && list.data.length === 0 && (
              <TableEmpty colSpan={5}>Sem eventos para esses filtros.</TableEmpty>
            )}
            {list.data?.map((ev) => {
              const meta = (ev.metadata ?? {}) as { impersonated_by?: string };
              const impersonated = Boolean(meta.impersonated_by);
              return (
                <TR key={ev.id}>
                  <TD>
                    <code className="text-mono text-caption text-brand-primary-light">
                      {ev.action}
                    </code>
                  </TD>
                  <TD className="text-text-2 text-caption font-mono">{ev.tableName}</TD>
                  <TD className="text-text-2 text-caption font-mono">
                    {ev.tenantId ?? '—'}
                  </TD>
                  <TD>
                    {impersonated ? (
                      <Badge variant="danger">Sim</Badge>
                    ) : (
                      <span className="text-text-3 text-caption">—</span>
                    )}
                  </TD>
                  <TD className="text-text-2 text-caption">
                    {new Date(ev.at).toLocaleString('pt-BR')}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        )}
      </Table>
    </div>
  );
}
