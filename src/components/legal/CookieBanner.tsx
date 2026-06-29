'use client';

import { useEffect, useState } from 'react';

/**
 * Cookie banner LGPD granular — Sprint 11.
 *
 * Categorias:
 *  - STRICTLY_NECESSARY: sempre ON (sessão, CSRF, idioma)
 *  - FUNCTIONAL: preferências, idioma persistido, notificações
 *  - ANALYTICS: métricas agregadas
 *  - MARKETING: pixels e remarketing
 *
 * Persistência: localStorage + POST /api/v1/consent (grava ConsentLog
 * com IP do servidor + tenant_id se autenticado).
 */

const POLICY_VERSION = '2026-06-28';
const STORAGE_KEY = 'crm:consent:v1';

type Category = 'STRICTLY_NECESSARY' | 'FUNCTIONAL' | 'ANALYTICS' | 'MARKETING';

interface ConsentState {
  version: string;
  categories: Record<Category, boolean>;
  decidedAt: string;
}

function loadConsent(): ConsentState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentState;
    return parsed.version === POLICY_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

function persist(state: ConsentState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  void fetch('/api/v1/consent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      policyVersion: state.version,
      categories: Object.entries(state.categories).map(([category, accepted]) => ({
        category,
        accepted,
      })),
    }),
  }).catch(() => undefined);
}

export function CookieBanner() {
  const [open, setOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [cats, setCats] = useState<Record<Category, boolean>>({
    STRICTLY_NECESSARY: true,
    FUNCTIONAL: true,
    ANALYTICS: false,
    MARKETING: false,
  });

  useEffect(() => {
    if (!loadConsent()) setOpen(true);
  }, []);

  if (!open) return null;

  const finish = (overrides?: Partial<Record<Category, boolean>>) => {
    const merged = { ...cats, ...overrides, STRICTLY_NECESSARY: true };
    persist({
      version: POLICY_VERSION,
      categories: merged,
      decidedAt: new Date().toISOString(),
    });
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-200 bg-white shadow-2xl"
      role="dialog"
      aria-label="Preferências de cookies"
    >
      <div className="mx-auto max-w-5xl p-4 md:p-6 space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <h2 className="text-base font-semibold text-neutral-900">
              Sua privacidade
            </h2>
            <p className="text-sm text-neutral-600 mt-1">
              Usamos cookies para operar o serviço, lembrar preferências e medir
              o desempenho. Você pode aceitar todos ou personalizar. Veja a{' '}
              <a className="underline text-brand" href="/privacy">
                Política de Privacidade
              </a>
              .
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setShowDetails((s) => !s)}
              className="px-3 py-2 text-sm border rounded-md hover:bg-neutral-50"
            >
              Personalizar
            </button>
            <button
              type="button"
              onClick={() =>
                finish({ FUNCTIONAL: false, ANALYTICS: false, MARKETING: false })
              }
              className="px-3 py-2 text-sm border rounded-md hover:bg-neutral-50"
            >
              Só essenciais
            </button>
            <button
              type="button"
              onClick={() =>
                finish({ FUNCTIONAL: true, ANALYTICS: true, MARKETING: true })
              }
              className="px-3 py-2 text-sm rounded-md bg-brand text-white hover:opacity-90"
            >
              Aceitar todos
            </button>
          </div>
        </div>

        {showDetails && (
          <fieldset className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2 pt-3 border-t">
            {(
              [
                ['STRICTLY_NECESSARY', 'Estritamente necessários', 'Sessão, autenticação e segurança. Sempre ativos.', true],
                ['FUNCTIONAL', 'Funcionais', 'Preferências e idioma. Não rastreiam você.', false],
                ['ANALYTICS', 'Analíticos', 'Métricas agregadas sobre uso do produto.', false],
                ['MARKETING', 'Marketing', 'Personalização e medição de campanhas.', false],
              ] as Array<[Category, string, string, boolean]>
            ).map(([k, label, hint, locked]) => (
              <label
                key={k}
                className="flex items-start gap-3 p-3 border rounded-md"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={cats[k]}
                  disabled={locked}
                  onChange={(e) =>
                    setCats((prev) => ({ ...prev, [k]: e.target.checked }))
                  }
                />
                <div>
                  <div className="text-sm font-medium text-neutral-900">{label}</div>
                  <div className="text-xs text-neutral-500 mt-0.5">{hint}</div>
                </div>
              </label>
            ))}
            <div className="md:col-span-2 flex justify-end">
              <button
                type="button"
                onClick={() => finish()}
                className="px-4 py-2 text-sm rounded-md bg-brand text-white hover:opacity-90"
              >
                Salvar escolhas
              </button>
            </div>
          </fieldset>
        )}
      </div>
    </div>
  );
}
