'use client';

import { trpc } from '@/lib/trpc/client';
import { Banner } from '@/components/ui/banner';
import Link from 'next/link';

const VARIANT_MAP = {
  INFO: 'info',
  WARNING: 'warning',
  DANGER: 'danger',
  SUCCESS: 'info',
} as const;

/**
 * BroadcastBanners — Sprint 15B.
 *
 * Consome `broadcasts.activeForCurrentUser` (resolve targeting + dismissals
 * server-side) e renderiza um Banner por broadcast ativo. Substitui o
 * `MaintenanceBanner` (Sprint 14.5, baseado em env var).
 *
 * Quando há ≥1 broadcast ativo, esconde o MaintenanceBanner legado
 * (handled em ContextBanners). O env `NEXT_PUBLIC_MAINTENANCE_MESSAGE`
 * continua funcionando como fallback se não há broadcasts.
 */
export function BroadcastBanners() {
  const list = trpc.broadcasts.activeForCurrentUser.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
  });
  const utils = trpc.useUtils();
  const dismiss = trpc.broadcasts.dismiss.useMutation({
    onSuccess: () => utils.broadcasts.activeForCurrentUser.invalidate(),
  });

  if (!list.data || list.data.length === 0) return null;

  return (
    <>
      {list.data.map((b) => {
        const variant = VARIANT_MAP[b.variant];
        return (
          <Banner
            key={b.id}
            variant={variant === 'info' && b.variant === 'SUCCESS' ? 'info' : variant}
            dismissible={b.dismissible}
            onDismiss={b.dismissible ? () => dismiss.mutate({ id: b.id }) : undefined}
            action={
              b.actionUrl && b.actionLabel ? (
                <Link
                  href={b.actionUrl}
                  className="rounded bg-current/10 px-3 py-1 text-caption font-semibold underline"
                  target={b.actionUrl.startsWith('http') ? '_blank' : undefined}
                  rel="noopener"
                >
                  {b.actionLabel}
                </Link>
              ) : undefined
            }
          >
            <strong>{b.title}</strong> {b.message}
          </Banner>
        );
      })}
    </>
  );
}

/**
 * Helper para consumidores saberem se há broadcasts ativos —
 * usado pelo MaintenanceBanner legado para se esconder em favor
 * dos broadcasts genéricos.
 */
export function useHasActiveBroadcasts(): boolean {
  const list = trpc.broadcasts.activeForCurrentUser.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
  });
  return (list.data?.length ?? 0) > 0;
}
