'use client';

import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import type { ThemeConfig } from '@/lib/theme/types';
import { VENZO_DEFAULTS } from '@/lib/theme/types';

type Tab = 'paleta' | 'tipografia' | 'logo' | 'historico';

interface ValidationFailure {
  combination: string;
  actualRatio: number;
  requiredRatio: number;
  context: string;
}

export default function BrandingPage() {
  const utils = trpc.useUtils();
  const themeQ = trpc.theme.get.useQuery();
  const planQ = trpc.theme.planInfo.useQuery();
  const palettesQ = trpc.theme.listCuratedPalettes.useQuery();
  const fontsQ = trpc.theme.listCuratedFonts.useQuery();

  const [tab, setTab] = useState<Tab>('paleta');
  const [draft, setDraft] = useState<ThemeConfig>(VENZO_DEFAULTS);
  const [showOverride, setShowOverride] = useState(false);
  const [overrideForm, setOverrideForm] = useState({ justification: '', dpoApproval: false });

  useEffect(() => {
    if (themeQ.data?.themeConfig) setDraft(themeQ.data.themeConfig);
  }, [themeQ.data]);

  const validateQ = trpc.theme.validate.useQuery(draft, {
    enabled: !!draft.primaryColor,
  });

  const update = trpc.theme.update.useMutation({
    onSuccess: () => {
      utils.theme.get.invalidate();
      setShowOverride(false);
    },
  });
  const publishOverride = trpc.theme.publishWithOverride.useMutation({
    onSuccess: () => {
      utils.theme.get.invalidate();
      setShowOverride(false);
    },
  });

  if (themeQ.isLoading || planQ.isLoading) return <main className="p-6">Carregando…</main>;
  const plan = planQ.data?.plan ?? 'STARTER';
  const isStarter = plan === 'STARTER';
  const isGrowth = plan === 'GROWTH';
  const isEnterprise = plan === 'ENTERPRISE';

  if (isStarter) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="mb-3 text-2xl font-bold">Identidade visual</h1>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="mb-2 font-medium">Personalização indisponível no plano Starter.</p>
          <p>
            Faça upgrade para <strong>Growth</strong> (paleta + fonte da lista curada)
            ou <strong>Enterprise</strong> (hex livre, Google Fonts custom, override
            WCAG) para personalizar a aparência da plataforma.
          </p>
        </div>
      </main>
    );
  }

  const failures = (validateQ.data?.failures ?? []) as ValidationFailure[];

  return (
    <main className="mx-auto max-w-5xl p-4 md:p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Identidade visual</h1>
        <p className="text-sm text-neutral-600">
          Plano <strong>{plan}</strong>{' '}
          {isGrowth && '— paleta e fonte da lista curada Venzo.'}
          {isEnterprise && '— hex livre, Google Fonts e override WCAG disponíveis.'}
        </p>
        {themeQ.data?.hasActiveOverrides && (
          <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            ⚠ Tema ativo possui desvios WCAG aprovados via override Enterprise.
          </div>
        )}
      </header>

      <nav className="mb-4 flex gap-1 border-b border-neutral-200 text-sm">
        {(['paleta', 'tipografia', 'logo', 'historico'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 capitalize ${
              tab === t ? 'border-brand text-brand' : 'border-transparent text-neutral-600'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {tab === 'paleta' && (
            <section className="rounded-lg border border-neutral-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-700">
                Cores
              </h2>
              {isGrowth ? (
                <div className="space-y-2">
                  <p className="text-xs text-neutral-600">Escolha uma paleta curada:</p>
                  {palettesQ.data?.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setDraft({ ...draft, ...p.config })}
                      className="flex w-full items-center justify-between rounded border border-neutral-200 p-2 text-left text-sm hover:border-brand"
                    >
                      <span>
                        <strong>{p.name}</strong>{' '}
                        <span className="text-xs text-neutral-600">— {p.description}</span>
                      </span>
                      <span className="flex gap-1">
                        {(['primaryColor', 'primaryDark', 'primaryLight', 'accentColor'] as const).map((k) => (
                          <span
                            key={k}
                            className="h-4 w-4 rounded"
                            style={{ background: p.config[k] }}
                          />
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {(['primaryColor', 'primaryDark', 'primaryLight', 'accentColor'] as const).map((field) => (
                    <label key={field} className="flex items-center gap-3 text-sm">
                      <span className="w-32 capitalize">{field.replace('Color', '')}</span>
                      <input
                        type="color"
                        value={draft[field]}
                        onChange={(e) => setDraft({ ...draft, [field]: e.target.value.toUpperCase() })}
                        className="h-9 w-16 cursor-pointer rounded border"
                      />
                      <input
                        type="text"
                        value={draft[field]}
                        onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                        className="flex-1 rounded border px-2 py-1 font-mono text-xs"
                      />
                    </label>
                  ))}
                </div>
              )}
            </section>
          )}

          {tab === 'tipografia' && (
            <section className="rounded-lg border border-neutral-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-700">
                Fonte
              </h2>
              {isGrowth ? (
                <div className="space-y-1">
                  {fontsQ.data?.map((f) => (
                    <button
                      key={f.family}
                      type="button"
                      onClick={() => setDraft({ ...draft, fontFamily: f.family })}
                      className={`flex w-full items-center justify-between rounded border p-2 text-left text-sm ${
                        draft.fontFamily === f.family ? 'border-brand' : 'border-neutral-200'
                      }`}
                    >
                      <span style={{ fontFamily: `'${f.family}', sans-serif` }}>
                        <strong>{f.family}</strong>{' '}
                        <span className="text-xs text-neutral-600">— {f.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  type="text"
                  value={draft.fontFamily}
                  onChange={(e) => setDraft({ ...draft, fontFamily: e.target.value })}
                  placeholder="Qualquer Google Font (ex: Roboto, Inter, Source Sans Pro)"
                  className="w-full rounded border px-3 py-2 text-sm"
                />
              )}
            </section>
          )}

          {tab === 'logo' && (
            <section className="rounded-lg border border-neutral-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-700">
                Logo (URL)
              </h2>
              <input
                type="url"
                value={draft.logoUrl ?? ''}
                onChange={(e) => setDraft({ ...draft, logoUrl: e.target.value || null })}
                placeholder="https://cdn.suaempresa.com/logo.svg"
                className="w-full rounded border px-3 py-2 text-sm"
              />
              <p className="mt-2 text-xs text-neutral-500">
                Sprint posterior: upload nativo para R2/S3 com presigned URL.
              </p>
            </section>
          )}

          {tab === 'historico' && <AuditHistory />}
        </div>

        <aside className="space-y-3">
          <section className="rounded-lg border border-neutral-200 bg-white p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-700">
              WCAG AA
            </h3>
            {!validateQ.data ? (
              <p className="text-xs text-neutral-500">Verificando…</p>
            ) : validateQ.data.passed ? (
              <p className="text-xs text-emerald-700">
                ✓ {validateQ.data.checks.length} combinações OK
              </p>
            ) : (
              <ul className="space-y-1 text-xs">
                {failures.map((f, i) => (
                  <li key={i} className="border-l-2 border-red-400 pl-2">
                    <p className="font-medium">{f.combination}</p>
                    <p className="text-neutral-600">
                      {f.actualRatio} / {f.requiredRatio} · {f.context}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {failures.length > 0 && <SuggestionPanel hex={draft.primaryColor} apply={(c) => setDraft({ ...draft, primaryColor: c })} />}

          <div className="space-y-2">
            <Button
              type="button"
              onClick={() => update.mutate({ themeConfig: draft })}
              disabled={update.isPending || failures.length > 0}
              className="w-full"
            >
              {update.isPending ? 'Publicando…' : 'Publicar tema'}
            </Button>
            {update.error && (
              <p className="rounded bg-red-50 p-2 text-xs text-red-700">{update.error.message}</p>
            )}
            {isEnterprise && failures.length > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowOverride(true)}
                className="w-full"
              >
                Publicar mesmo assim (override)
              </Button>
            )}
          </div>
        </aside>
      </div>

      {showOverride && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowOverride(false)}>
          <div className="max-w-lg rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-lg font-semibold">Override WCAG AA</h3>
            <p className="mb-3 text-sm text-neutral-700">
              Você está publicando um tema que não atende WCAG AA em{' '}
              <strong>{failures.length}</strong> combinação(ões). Sua empresa assume a
              responsabilidade pela conformidade legal (Lei 13.146/2015) e pela
              usabilidade dos usuários com baixa visão.
            </p>
            <label className="mb-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={overrideForm.dpoApproval}
                onChange={(e) =>
                  setOverrideForm({ ...overrideForm, dpoApproval: e.target.checked })
                }
                className="mt-0.5"
              />
              <span>Confirmo que tenho aprovação do DPO/Legal da minha empresa.</span>
            </label>
            <label className="mb-3 block text-sm">
              <span className="mb-0.5 block text-xs">Justificativa (mín 30 chars)</span>
              <textarea
                value={overrideForm.justification}
                onChange={(e) =>
                  setOverrideForm({ ...overrideForm, justification: e.target.value })
                }
                rows={3}
                className="w-full rounded border px-2 py-1 text-sm"
              />
              <span className="text-xs text-neutral-500">
                {overrideForm.justification.length}/30
              </span>
            </label>
            {publishOverride.error && (
              <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{publishOverride.error.message}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowOverride(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={
                  !overrideForm.dpoApproval ||
                  overrideForm.justification.length < 30 ||
                  publishOverride.isPending
                }
                onClick={() =>
                  publishOverride.mutate({
                    themeConfig: draft,
                    justification: overrideForm.justification,
                    dpoApproval: true,
                  })
                }
              >
                {publishOverride.isPending ? 'Publicando…' : 'Confirmar e publicar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function SuggestionPanel({ hex, apply }: { hex: string; apply: (c: string) => void }) {
  const sug = trpc.theme.suggestContrastFix.useQuery({ baseHex: hex, minRatio: 4.5 });
  if (!sug.data) return null;
  if (sug.data.unsupported) {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        Cor incompatível com WCAG AA. Tente outra cor.
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-3 text-xs">
      <h3 className="mb-2 font-semibold uppercase tracking-wide text-neutral-700">
        Sugestões para primaryColor
      </h3>
      <div className="space-y-2">
        {sug.data.darker && (
          <button
            type="button"
            onClick={() => apply(sug.data.darker!)}
            className="flex w-full items-center justify-between rounded border border-neutral-200 p-2 hover:border-brand"
          >
            <span className="flex items-center gap-2">
              <span className="h-5 w-5 rounded" style={{ background: sug.data.darker }} />
              <span className="font-mono">{sug.data.darker}</span>
            </span>
            <span className="text-neutral-500">escura</span>
          </button>
        )}
        {sug.data.lighter && (
          <button
            type="button"
            onClick={() => apply(sug.data.lighter!)}
            className="flex w-full items-center justify-between rounded border border-neutral-200 p-2 hover:border-brand"
          >
            <span className="flex items-center gap-2">
              <span className="h-5 w-5 rounded" style={{ background: sug.data.lighter }} />
              <span className="font-mono">{sug.data.lighter}</span>
            </span>
            <span className="text-neutral-500">clara</span>
          </button>
        )}
      </div>
    </section>
  );
}

function AuditHistory() {
  const history = trpc.theme.auditHistory.useQuery();
  if (history.isLoading) return <p className="text-sm text-neutral-600">Carregando…</p>;
  if (!history.data || history.data.length === 0) {
    return (
      <section className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
        Nenhuma publicação registrada ainda.
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-700">
        Histórico de publicações
      </h2>
      <ul className="space-y-2 text-sm">
        {history.data.map((h) => {
          const after = (h.after ?? {}) as { validation?: { wcagLevel?: string }; overrideJustification?: string | null };
          return (
            <li key={h.id} className="rounded border border-neutral-100 p-2">
              <p className="text-xs text-neutral-600">
                {new Date(h.at).toLocaleString('pt-BR')} ·{' '}
                {h.actor?.fullName ?? 'desconhecido'} ·{' '}
                <strong>{after.validation?.wcagLevel ?? 'AA'}</strong>
              </p>
              {after.overrideJustification && (
                <p className="mt-1 text-xs text-amber-800">
                  Override: {after.overrideJustification}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
