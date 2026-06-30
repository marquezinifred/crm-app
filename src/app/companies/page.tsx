'use client';

import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  THead,
  TBody,
  TH,
  TR,
  TD,
  TableEmpty,
  TableSkeleton,
} from '@/components/ui/table';

export default function CompaniesPage() {
  const { data, isLoading, error } = trpc.companies.list.useQuery({
    page: 1,
    pageSize: 50,
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Empresas"
        description="Clientes, parceiros, fornecedores e sua própria empresa."
        meta={data && `${data.total} registro${data.total === 1 ? '' : 's'}`}
        primaryAction={
          <Link href="/companies/new">
            <Button variant="primary">+ Nova empresa</Button>
          </Link>
        }
      />

      {error && (
        <p role="alert" className="rounded border border-danger/30 bg-danger-bg/40 p-3 text-body text-danger-text">
          {error.message}
        </p>
      )}

      <Table>
        <THead>
          <tr>
            <TH>Razão social</TH>
            <TH>Tipo</TH>
            <TH>CNPJ</TH>
            <TH>Cidade / UF</TH>
          </tr>
        </THead>
        {isLoading ? (
          <TableSkeleton cols={4} rows={6} />
        ) : (
          <TBody>
            {data && data.rows.length === 0 && (
              <TableEmpty colSpan={4}>
                <EmptyState
                  title="Sua base de empresas começa aqui."
                  description="Cadastre a primeira empresa ou importe um CSV."
                  action={
                    <Link href="/companies/new">
                      <Button variant="primary">+ Nova empresa</Button>
                    </Link>
                  }
                />
              </TableEmpty>
            )}
            {data?.rows.map((c) => (
              <TR key={c.id}>
                <TD>
                  <Link
                    href={`/companies/${c.id}`}
                    className="font-medium text-brand-primary-light hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary rounded"
                  >
                    {c.razaoSocial}
                  </Link>
                </TD>
                <TD>
                  <Badge variant="default">{c.type}</Badge>
                </TD>
                <TD className="font-mono text-caption text-text-2">{c.cnpj ?? '—'}</TD>
                <TD className="text-text-2">
                  {[c.city, c.state].filter(Boolean).join(' / ') || '—'}
                </TD>
              </TR>
            ))}
          </TBody>
        )}
      </Table>
    </div>
  );
}
