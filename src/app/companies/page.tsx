'use client';

import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';

export default function CompaniesPage() {
  const { data, isLoading, error } = trpc.companies.list.useQuery({
    page: 1,
    pageSize: 50,
  });

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Empresas</h1>
        <Link href="/companies/new">
          <Button>+ Nova empresa</Button>
        </Link>
      </header>

      {isLoading && <p>Carregando…</p>}
      {error && <p className="text-red-600">{error.message}</p>}

      {data && (
        <div className="overflow-hidden rounded border">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left">
              <tr>
                <th className="px-3 py-2">Razão social</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">CNPJ</th>
                <th className="px-3 py-2">Cidade / UF</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((c) => (
                <tr key={c.id} className="border-t hover:bg-neutral-50">
                  <td className="px-3 py-2">
                    <Link
                      href={`/companies/${c.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {c.razaoSocial}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{c.type}</td>
                  <td className="px-3 py-2">{c.cnpj ?? '—'}</td>
                  <td className="px-3 py-2">
                    {[c.city, c.state].filter(Boolean).join(' / ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
            {data.total} registro(s) — página {data.page}
          </p>
        </div>
      )}
    </main>
  );
}
