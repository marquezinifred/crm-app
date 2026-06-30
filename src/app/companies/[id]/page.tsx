import Link from 'next/link';
import { CompanyDetailContent } from '@/components/companies/CompanyDetailContent';

/**
 * Full-page de empresa — fallback para deep link, F5 e mobile.
 * Reusa o mesmo componente do Sheet (intercepting route).
 */
export default function CompanyFullPage({ params }: { params: { id: string } }) {
  return (
    <div className="mx-auto max-w-3xl">
      <nav aria-label="Trilha" className="mb-4 text-caption text-text-2">
        <Link href="/companies" className="hover:text-text-1 underline">
          ← Voltar para empresas
        </Link>
      </nav>
      <CompanyDetailContent companyId={params.id} />
    </div>
  );
}
