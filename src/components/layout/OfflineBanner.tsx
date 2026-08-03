'use client';

import { useEffect, useRef, useState } from 'react';
import { Banner } from '@/components/ui/banner';

/**
 * Banner de offline — Sprint 14.5 (spec §7.3), endurecido em P-106.
 *
 * ANTES: confiava só em `navigator.onLine` + eventos `online`/`offline`.
 * Esse sinal é notoriamente falível (macOS reporta falso-offline mesmo com
 * internet real; a própria spec do `navigator.onLine` avisa que só é
 * confiável quando reporta `false` por causa de ausência de interface de
 * rede). O falso-offline combinava com o React Query pausando queries e
 * travava o app inteiro em "Carregando…" (fix do QueryClient em provider.tsx).
 *
 * AGORA: heartbeat real — ping periódico no `/api/v1/health`. Só marca
 * offline após N falhas de REDE consecutivas; volta a online no primeiro
 * sucesso. Qualquer RESPOSTA HTTP (mesmo 503 quando o DB falha) prova que a
 * rede alcança o servidor → online; latência alta que ainda responde NÃO é
 * offline (cold-start do Neon, P-110). Os eventos `online`/`offline` do
 * window viram apenas GATILHOS de uma verificação imediata — o veredito
 * final é sempre do heartbeat.
 *
 * SSR-safe: assume online no primeiro render, ajusta no useEffect. Não
 * descartável (some sozinho ao reconectar).
 */

const HEARTBEAT_INTERVAL_MS = 25_000;
// Timeout curto o bastante pra detectar rede morta rápido, mas folgado o
// bastante pra tolerar cold-start do Neon (P-110) sem falso-offline.
const HEARTBEAT_TIMEOUT_MS = 9_000;
// Precisa de N falhas consecutivas — absorve blips únicos do navigator.onLine.
const FAILURES_TO_OFFLINE = 2;

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const failuresRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function ping() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);
      try {
        // Ignoramos o status: qualquer resposta prova alcance de rede. Só
        // rejeição (falha de rede) ou abort (timeout) conta como falha.
        await fetch('/api/v1/health', {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (cancelled) return;
        failuresRef.current = 0;
        setOffline(false);
      } catch {
        if (cancelled) return;
        failuresRef.current += 1;
        if (failuresRef.current >= FAILURES_TO_OFFLINE) setOffline(true);
      } finally {
        clearTimeout(timeout);
      }
    }

    const verifyNow = () => {
      void ping();
    };
    window.addEventListener('offline', verifyNow);
    window.addEventListener('online', verifyNow);

    void ping();
    const interval = setInterval(verifyNow, HEARTBEAT_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('offline', verifyNow);
      window.removeEventListener('online', verifyNow);
    };
  }, []);

  if (!offline) return null;

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
