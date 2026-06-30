'use client';

import { useRouter } from 'next/navigation';
import { Sheet, SheetHeader, SheetBody } from '@/components/ui/sheet';
import { useIsMobile } from '@/lib/utils/hooks';
import { CompanyDetailContent } from '@/components/companies/CompanyDetailContent';
import Link from 'next/link';

/**
 * Intercepting route — clique numa linha de /companies abre este sheet
 * mantendo URL `/companies/[id]`. F5 cai em `[id]/page.tsx` full-page.
 */
export default function CompanyModalSheet({ params }: { params: { id: string } }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const close = () => router.back();

  return (
    <Sheet open onOpenChange={(v) => !v && close()} variant={isMobile ? 'bottom' : 'right'}>
      <SheetHeader
        title="Empresa"
        rightAction={
          <Link
            href={`/companies/${params.id}`}
            aria-label="Abrir página completa"
            title="Abrir página completa"
            className="flex h-8 w-8 items-center justify-center rounded text-text-2 hover:bg-hover hover:text-text-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M7 17L17 7M7 7h10v10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        }
        onClose={close}
      />
      <SheetBody>
        <CompanyDetailContent companyId={params.id} />
      </SheetBody>
    </Sheet>
  );
}
