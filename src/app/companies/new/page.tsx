'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/PageHeader';
import { CompanyForm } from '@/components/companies/CompanyForm';

/**
 * P-94 — rota estática /companies/new.
 *
 * Sem ela, o Next matcheava [id] com id="new" e companies.byId
 * rejeitava o uuid, vazando o erro Zod cru na tela. Segmento estático
 * tem precedência sobre [id] no App Router. Entry points: link em
 * /admin/partners e deep link direto.
 */
export default function NewCompanyPage() {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-3xl">
      <nav aria-label="Trilha" className="mb-4 text-caption text-text-2">
        <Link href="/companies" className="hover:text-text-1 underline">
          ← Voltar para empresas
        </Link>
      </nav>
      <PageHeader
        title="Nova empresa"
        description="Cadastre razão social, CNPJ, território e segmento."
      />
      <div className="rounded-lg border border-border bg-card p-6">
        <CompanyForm
          onSuccess={(id) => router.push(`/companies/${id}`)}
          onCancel={() => router.push('/companies')}
        />
      </div>
    </div>
  );
}
