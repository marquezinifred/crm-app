'use client';

import { trpc } from '@/lib/trpc/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TH, TR, TD, TableEmpty, TableSkeleton } from '@/components/ui/table';
import { formatRelativeDate } from '@/lib/utils/format';

export default function PlatformPrivacyPage() {
  const list = trpc.platform.privacyList.useQuery();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Privacy requests (LGPD)"
        description="Fila cross-tenant. SLA ANPD: 15 dias entre submissão e conclusão."
        meta={list.data && `${list.data.length} pedidos`}
      />

      <Table>
        <THead>
          <tr>
            <TH>Tenant</TH>
            <TH>Tipo</TH>
            <TH>Titular</TH>
            <TH>Status</TH>
            <TH>Prazo</TH>
          </tr>
        </THead>
        {list.isLoading ? (
          <TableSkeleton cols={5} rows={6} />
        ) : (
          <TBody>
            {list.data && list.data.length === 0 && (
              <TableEmpty colSpan={5}>Sem solicitações LGPD em aberto.</TableEmpty>
            )}
            {list.data?.map((req) => {
              const overdue =
                req.status !== 'COMPLETED' &&
                req.status !== 'REJECTED' &&
                new Date(req.dueAt) < new Date();
              return (
                <TR key={req.id}>
                  <TD>
                    {req.tenant ? (
                      <>
                        <span className="font-medium">{req.tenant.name}</span>
                        <span className="block text-caption text-text-3 font-mono">
                          {req.tenant.slug}
                        </span>
                      </>
                    ) : (
                      <span className="text-text-3">—</span>
                    )}
                  </TD>
                  <TD>
                    <Badge variant="default">{req.requestType}</Badge>
                  </TD>
                  <TD className="text-text-2">{req.subjectEmail}</TD>
                  <TD>
                    <Badge
                      variant={
                        req.status === 'COMPLETED'
                          ? 'success'
                          : req.status === 'REJECTED'
                            ? 'danger'
                            : overdue
                              ? 'danger'
                              : 'warning'
                      }
                    >
                      {req.status}
                    </Badge>
                  </TD>
                  <TD className={overdue ? 'text-danger' : 'text-text-2'}>
                    {new Date(req.dueAt).toLocaleDateString('pt-BR')}
                    <span className="block text-caption text-text-3">
                      {formatRelativeDate(new Date(req.dueAt))}
                    </span>
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
