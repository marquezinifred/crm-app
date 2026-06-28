'use client';

import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';

/**
 * Botão para o usuário ativar push notifications no dispositivo atual.
 * Esconde se VAPID não configurado ou já há subscription ativa neste browser.
 */
export function EnablePushButton() {
  const { data: config } = trpc.push.config.useQuery();
  const subscribe = trpc.push.subscribe.useMutation();
  const [state, setState] = useState<'idle' | 'subscribed' | 'denied' | 'unsupported'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') setState('denied');
    void (async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) setState('subscribed');
    })();
  }, []);

  if (!config?.enabled || !config.publicKey) return null;
  if (state === 'unsupported') return null;
  if (state === 'subscribed') {
    return <p className="text-xs text-emerald-700">✓ Notificações ativas neste dispositivo</p>;
  }
  if (state === 'denied') {
    return (
      <p className="text-xs text-amber-700">
        Permissão de notificações bloqueada. Ative nas preferências do navegador.
      </p>
    );
  }

  async function enable() {
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setState('denied');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config!.publicKey!) as BufferSource,
      });
      const json = sub.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error('subscription incompleta');
      }
      await subscribe.mutateAsync({
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        userAgent: navigator.userAgent,
      });
      setState('subscribed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro desconhecido');
    }
  }

  return (
    <div>
      <Button type="button" variant="outline" size="sm" onClick={enable}>
        🔔 Ativar notificações no celular
      </Button>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
