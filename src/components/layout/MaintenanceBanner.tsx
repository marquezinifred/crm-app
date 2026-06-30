'use client';

import { useEffect, useState } from 'react';
import { Banner } from '@/components/ui/banner';
import { useHasActiveBroadcasts } from './BroadcastBanners';

const DISMISS_KEY = 'venzo:maintenance-dismissed';

/**
 * Banner de manutenção programada — Sprint 14.5 (spec §7.3).
 *
 * Texto controlado por `NEXT_PUBLIC_MAINTENANCE_MESSAGE`. Vazio = oculto.
 * Sessão-descartável: ao fechar a tab o banner volta. Se ops mudar a
 * mensagem (`message` muda), a chave de dismiss muda junto e o banner
 * reaparece — ideal para janelas de manutenção distintas.
 *
 * Lê o env em runtime via `process.env.NEXT_PUBLIC_*` (Next.js inlines
 * NEXT_PUBLIC vars no bundle do cliente).
 */
export function MaintenanceBanner() {
  const message = (process.env.NEXT_PUBLIC_MAINTENANCE_MESSAGE ?? '').trim();
  const [dismissed, setDismissed] = useState(true);
  // Sprint 15B: se há broadcasts ativos, o MaintenanceBanner legado
  // se cala em favor do sistema novo.
  const hasBroadcasts = useHasActiveBroadcasts();

  useEffect(() => {
    if (!message) return;
    const key = `${DISMISS_KEY}:${message}`;
    setDismissed(window.sessionStorage.getItem(key) === '1');
  }, [message]);

  if (!message) return null;
  if (dismissed) return null;
  if (hasBroadcasts) return null;

  function handleDismiss() {
    const key = `${DISMISS_KEY}:${message}`;
    window.sessionStorage.setItem(key, '1');
    setDismissed(true);
  }

  return (
    <Banner variant="info" dismissible onDismiss={handleDismiss}>
      {message}
    </Banner>
  );
}
