'use client';

import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';

/**
 * Banner global mostrando dias restantes do trial / aviso de past_due.
 * Renderizado no layout autenticado. Some quando não há trial nem alerta.
 */

export function TrialExpiryBanner() {
  const status = trpc.billing.status.useQuery(undefined, {
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  if (!status.data) return null;

  const { trialEndsAt, subscriptionStatus, plan } = status.data;

  if (subscriptionStatus === 'PAST_DUE') {
    return (
      <div className="bg-rose-50 border-b border-rose-200 text-rose-900 text-sm px-4 py-2 flex items-center justify-between gap-3">
        <span>Pagamento pendente. Atualize seu método para evitar suspensão.</span>
        <Link className="underline font-medium" href="/admin/billing">
          Resolver
        </Link>
      </div>
    );
  }

  if (plan === 'TRIAL' && trialEndsAt) {
    const daysLeft = Math.ceil(
      (new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    if (daysLeft > 7) return null;
    const expired = daysLeft <= 0;
    return (
      <div
        className={`${
          expired ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-amber-50 border-amber-200 text-amber-900'
        } border-b text-sm px-4 py-2 flex items-center justify-between gap-3`}
      >
        <span>
          {expired
            ? 'Seu trial expirou. Escolha um plano para continuar usando.'
            : `Seu trial termina em ${daysLeft} dia${daysLeft === 1 ? '' : 's'}.`}
        </span>
        <Link className="underline font-medium" href="/admin/billing">
          {expired ? 'Escolher plano' : 'Ver planos'}
        </Link>
      </div>
    );
  }

  return null;
}
