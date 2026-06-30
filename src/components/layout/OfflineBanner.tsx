'use client';

import { useEffect, useState } from 'react';
import { Banner } from '@/components/ui/banner';

/**
 * Banner de offline — Sprint 14.5 (spec §7.3).
 *
 * Listener `online`/`offline` do window. SSR-safe: assume online no
 * primeiro render, ajusta no useEffect. Não descartável (some sozinho
 * ao reconectar).
 */
export function OfflineBanner() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (online) return null;

  return (
    <Banner
      variant="warning"
      icon={
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" strokeLinecap="round" />
        </svg>
      }
    >
      <strong>Sem conexão.</strong> Trabalhando offline — alterações sincronizam quando reconectar.
    </Banner>
  );
}
