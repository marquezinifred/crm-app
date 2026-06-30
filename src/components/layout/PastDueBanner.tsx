'use client';

import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import { Banner } from '@/components/ui/banner';

/**
 * Banner de pagamento em atraso — Sprint 14.5 (spec §7.3).
 *
 * Não descartável. Refetch a cada 60s pra capturar mudança de status.
 * Link direto para /admin/billing.
 */
export function PastDueBanner() {
  const status = trpc.billing.status.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
    staleTime: 30_000,
  });
  if (status.data?.subscriptionStatus !== 'PAST_DUE') return null;

  return (
    <Banner
      variant="danger"
      action={
        <Link
          href="/admin/billing"
          className="rounded bg-danger px-3 py-1 text-caption font-semibold text-white hover:bg-danger/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          Resolver agora
        </Link>
      }
    >
      <strong>Pagamento em atraso.</strong> Regularize para continuar usando todos os recursos.
    </Banner>
  );
}
