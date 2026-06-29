'use client';

import { trpc } from '@/lib/trpc/client';
import { useState } from 'react';
import { POLICY_VERSIONS } from '@/lib/legal/versions';
import type { PolicyDocument } from '@prisma/client';

/**
 * Modal de aceite forçado quando o usuário ainda não aceitou a versão atual
 * de uma política. Renderiza um overlay bloqueando interação até aceitar.
 */
export function PolicyAcceptGate() {
  const accepted = trpc.privacy.myAcceptedVersions.useQuery();
  const accept = trpc.privacy.acceptPolicy.useMutation({
    onSuccess: () => accepted.refetch(),
  });
  const [busy, setBusy] = useState(false);

  if (!accepted.data) return null;

  const needs: PolicyDocument[] = [];
  if (
    !accepted.data.some(
      (a) => a.document === 'PRIVACY_POLICY' && a.version === POLICY_VERSIONS.PRIVACY_POLICY,
    )
  ) needs.push('PRIVACY_POLICY');
  if (
    !accepted.data.some(
      (a) => a.document === 'TERMS_OF_USE' && a.version === POLICY_VERSIONS.TERMS_OF_USE,
    )
  ) needs.push('TERMS_OF_USE');

  if (needs.length === 0) return null;

  async function acceptAll() {
    setBusy(true);
    try {
      for (const doc of needs) {
        await accept.mutateAsync({
          document: doc,
          version: POLICY_VERSIONS[doc],
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-xl w-full p-6 space-y-4">
        <h2 className="text-lg font-semibold">Atualizamos nossos termos</h2>
        <p className="text-sm text-neutral-700">
          Publicamos novas versões dos documentos abaixo. Para continuar usando a
          plataforma, é necessário ler e aceitar.
        </p>
        <ul className="text-sm space-y-1">
          {needs.includes('PRIVACY_POLICY') && (
            <li>
              <a className="underline text-brand" href="/privacy" target="_blank">
                Política de Privacidade ({POLICY_VERSIONS.PRIVACY_POLICY})
              </a>
            </li>
          )}
          {needs.includes('TERMS_OF_USE') && (
            <li>
              <a className="underline text-brand" href="/terms" target="_blank">
                Termos de Uso ({POLICY_VERSIONS.TERMS_OF_USE})
              </a>
            </li>
          )}
        </ul>
        <button
          onClick={acceptAll}
          disabled={busy}
          className="w-full px-4 py-2 rounded-md bg-brand text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Registrando...' : 'Li e aceito todos'}
        </button>
      </div>
    </div>
  );
}
