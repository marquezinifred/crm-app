'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import type { ThemeConfig } from '@/lib/theme/types';
import { VENZO_DEFAULTS } from '@/lib/theme/types';
import { POPULAR_GOOGLE_FONTS } from '@/lib/theme/google-fonts-popular';

type Tab = 'paleta' | 'tipografia' | 'logo' | 'historico';

interface ValidationFailure {
  combination: string;
  actualRatio: number;
  requiredRatio: number;
  context: string;
}

export default function BrandingPage() {
  const utils = trpc.useUtils();
  const { toast } = useToast();
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

  // Só valida quando as 4 cores estão em hex válido — evita 400s
  // enquanto o usuário ainda está digitando um valor parcial.
  const hexRe = /^#[0-9A-Fa-f]{6}$/;
  const allHexValid =
    hexRe.test(draft.primaryColor) &&
    hexRe.test(draft.primaryDark) &&
    hexRe.test(draft.primaryLight) &&
    hexRe.test(draft.accentColor);
  const validateQ = trpc.theme.validate.useQuery(draft, {
    enabled: allHexValid,
  });

  const update = trpc.theme.update.useMutation({
    onSuccess: () => {
      utils.theme.get.invalidate();
      setShowOverride(false);
      toast({ kind: 'success', title: 'Tema publicado.' });
    },
    onError: (e) => toast({ kind: 'error', title: friendlyTrpcError(e) }),
  });
  const publishOverride = trpc.theme.publishWithOverride.useMutation({
    onSuccess: () => {
      utils.theme.get.invalidate();
      setShowOverride(false);
      toast({ kind: 'success', title: 'Tema publicado com override WCAG.' });
    },
    onError: (e) => toast({ kind: 'error', title: friendlyTrpcError(e) }),
  });

  if (themeQ.isLoading || planQ.isLoading) return <main className="p-6">Carregando…</main>;
  const plan = planQ.data?.plan ?? 'STARTER';
  const isStarter = plan === 'STARTER';
  const isGrowth = plan === 'GROWTH';
  const isEnterprise = plan === 'ENTERPRISE';

  if (isStarter) {
    return <PlanComparisonUpsell />;
  }

  const failures = (validateQ.data?.failures ?? []) as ValidationFailure[];

  return (
    <main className="mx-auto max-w-5xl p-4 md:p-6">
      <PageHeader
        title="Identidade"
        description={`Cor, fonte, logo e Powered by Venzo. Plano ${plan}${
          isGrowth ? ' — paleta e fonte da lista curada Venzo.' : ''
        }${
          isEnterprise ? ' — hex livre, Google Fonts e override WCAG disponíveis.' : ''
        }`}
      />
      {themeQ.data?.hasActiveOverrides && (
        <div className="-mt-2 mb-4 rounded border border-warning/40 bg-warning-bg p-2 text-xs text-warning-text">
          ⚠ Tema ativo possui desvios WCAG aprovados via override Enterprise.
        </div>
      )}

      <nav className="mb-4 flex gap-1 border-b border-border text-sm">
        {(['paleta', 'tipografia', 'logo', 'historico'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 capitalize ${
              tab === t ? 'border-brand text-brand' : 'border-transparent text-text-2'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {tab === 'paleta' && (
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-1">
                Cores
              </h2>
              {isGrowth ? (
                <div className="space-y-2">
                  <p className="text-xs text-text-2">Escolha uma paleta curada:</p>
                  {palettesQ.data?.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setDraft({ ...draft, ...p.config })}
                      className="flex w-full items-center justify-between rounded border border-border p-2 text-left text-sm hover:border-brand"
                    >
                      <span>
                        <strong>{p.name}</strong>{' '}
                        <span className="text-xs text-text-2">— {p.description}</span>
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
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-1">
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
                        draft.fontFamily === f.family ? 'border-brand' : 'border-border'
                      }`}
                    >
                      <span style={{ fontFamily: `'${f.family}', sans-serif` }}>
                        <strong>{f.family}</strong>{' '}
                        <span className="text-xs text-text-2">— {f.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <FontCombobox
                  value={draft.fontFamily}
                  onChange={(family) => setDraft({ ...draft, fontFamily: family })}
                />
              )}
            </section>
          )}

          {tab === 'logo' && (
            <LogoPicker
              value={draft.logoUrl ?? null}
              onChange={(v) => setDraft({ ...draft, logoUrl: v })}
            />
          )}

          {tab === 'historico' && <AuditHistory />}
        </div>

        <aside className="space-y-3">
          <section className="rounded-lg border border-border bg-card p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-1">
              WCAG AA
            </h3>
            {!validateQ.data ? (
              <p className="text-xs text-text-2">Verificando…</p>
            ) : validateQ.data.passed ? (
              <p className="text-xs text-success">
                ✓ {validateQ.data.checks.length} combinações OK
              </p>
            ) : (
              <ul className="space-y-1 text-xs">
                {failures.map((f, i) => (
                  <li key={i} className="border-l-2 border-red-400 pl-2">
                    <p className="font-medium">{f.combination}</p>
                    <p className="text-text-2">
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
          <div className="max-w-lg rounded-lg bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-lg font-semibold">Override WCAG AA</h3>
            <p className="mb-3 text-sm text-text-1">
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
              <span className="text-xs text-text-2">
                {overrideForm.justification.length}/30
              </span>
            </label>
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
      <section className="rounded-lg border border-warning/30 bg-warning-bg p-3 text-xs text-warning-text">
        Cor incompatível com WCAG AA. Tente outra cor.
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-border bg-card p-3 text-xs">
      <h3 className="mb-2 font-semibold uppercase tracking-wide text-text-1">
        Sugestões para primaryColor
      </h3>
      <div className="space-y-2">
        {sug.data.darker && (
          <button
            type="button"
            onClick={() => apply(sug.data.darker!)}
            className="flex w-full items-center justify-between rounded border border-border p-2 hover:border-brand"
          >
            <span className="flex items-center gap-2">
              <span className="h-5 w-5 rounded" style={{ background: sug.data.darker }} />
              <span className="font-mono">{sug.data.darker}</span>
            </span>
            <span className="text-text-2">escura</span>
          </button>
        )}
        {sug.data.lighter && (
          <button
            type="button"
            onClick={() => apply(sug.data.lighter!)}
            className="flex w-full items-center justify-between rounded border border-border p-2 hover:border-brand"
          >
            <span className="flex items-center gap-2">
              <span className="h-5 w-5 rounded" style={{ background: sug.data.lighter }} />
              <span className="font-mono">{sug.data.lighter}</span>
            </span>
            <span className="text-text-2">clara</span>
          </button>
        )}
      </div>
    </section>
  );
}

function AuditHistory() {
  const history = trpc.theme.auditHistory.useQuery();
  if (history.isLoading) return <p className="text-sm text-text-2">Carregando…</p>;
  if (!history.data || history.data.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-card p-4 text-sm text-text-2">
        Sem publicações de tema ainda.
      </section>
    );
  }
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-1">
        Histórico de publicações
      </h2>
      <ul className="space-y-2 text-sm">
        {history.data.map((h) => {
          const after = (h.after ?? {}) as { validation?: { wcagLevel?: string }; overrideJustification?: string | null };
          return (
            <li key={h.id} className="rounded border border-border p-2">
              <p className="text-xs text-text-2">
                {new Date(h.at).toLocaleString('pt-BR')} ·{' '}
                {h.actor?.fullName ?? 'desconhecido'} ·{' '}
                <strong>{after.validation?.wcagLevel ?? 'AA'}</strong>
              </p>
              {after.overrideJustification && (
                <p className="mt-1 text-xs text-warning-text">
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

// ----------------------------------------------------------------------------
// Upsell mostrado quando tenant é Starter — 3 cards comparativos + preview do
// rodapé por plano. Substitui o banner amarelo simples.
// ----------------------------------------------------------------------------
function PlanComparisonUpsell() {
  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      <PageHeader
        title="Identidade"
        description="Seu plano atual é Starter. Faça upgrade para personalizar a aparência da plataforma com a marca da sua empresa."
      />

      <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <PlanCard
          name="Starter"
          tone="muted"
          tagline="Até 5 usuários"
          features={[
            { ok: true, label: 'Badge visível, tamanho normal no rodapé' },
            { ok: false, label: 'Sem personalização de cor/fonte' },
            { ok: false, label: 'Sem logo próprio' },
          ]}
          current
        />
        <PlanCard
          name="Growth"
          badge="recomendado"
          tone="brand"
          tagline="Até 25 usuários"
          features={[
            { ok: true, label: 'Badge menor, discreto (8px, muted)' },
            { ok: true, label: 'Paleta + fonte customizáveis' },
            { ok: true, label: 'Logo próprio no header' },
          ]}
        />
        <PlanCard
          name="Enterprise"
          tone="muted"
          tagline="Ilimitado · contrato anual"
          features={[
            { ok: true, label: 'Badge removível (campo poweredBy: false)' },
            { ok: true, label: 'White-label completo' },
            { ok: true, label: 'Domínio próprio (CNAME)' },
          ]}
        />
      </section>
    </main>
  );
}

function PlanCard({
  name,
  badge,
  tagline,
  features,
  tone,
  current,
}: {
  name: string;
  badge?: string;
  tagline: string;
  features: Array<{ ok: boolean; label: string }>;
  tone: 'brand' | 'muted';
  current?: boolean;
}) {
  const ring = tone === 'brand' ? 'ring-2 ring-[color:var(--brand-primary)]' : 'border';
  return (
    <article
      className={`flex flex-col rounded-xl border-border bg-card p-5 ${ring}`}
    >
      <div className="mb-3">
        <span
          className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${
            tone === 'brand'
              ? 'bg-[color:var(--brand-primary)]/10 text-[color:var(--brand-primary)]'
              : 'bg-hover text-text-1'
          }`}
        >
          {name}
          {badge ? <span className="ml-1 font-medium opacity-80">· {badge}</span> : null}
        </span>
      </div>
      <h3 className="mb-1 text-xl font-bold">{name}</h3>
      <p className="mb-4 text-sm text-text-2">{tagline}</p>
      <ul className="mb-4 space-y-2 text-sm">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2">
            <span
              aria-hidden
              className={`mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-base leading-none ${
                f.ok ? 'text-emerald-600' : 'text-red-500'
              }`}
            >
              {f.ok ? '✓' : '✗'}
            </span>
            <span className="text-text-1">{f.label}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-2">
        {current ? (
          <span className="inline-block rounded-md bg-hover px-3 py-1.5 text-xs font-medium text-text-2">
            Plano atual
          </span>
        ) : (
          <button
            type="button"
            className="w-full rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
            onClick={() => alert('Upgrade flow será integrado no Sprint 12 (Billing).')}
          >
            Fazer upgrade
          </button>
        )}
      </div>
    </article>
  );
}


// ----------------------------------------------------------------------------
// Combobox de Google Fonts populares — digite pra filtrar, click pra escolher.
// Plano Enterprise pode escolher fora da lista digitando livremente e
// confirmando com Enter (a fonte é renderizada via Google Fonts dinâmico).
// ----------------------------------------------------------------------------
function FontCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (family: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return POPULAR_GOOGLE_FONTS;
    return POPULAR_GOOGLE_FONTS.filter((f) => f.family.toLowerCase().includes(q));
  }, [query]);

  function select(family: string) {
    onChange(family);
    setQuery(family);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && filtered[activeIndex]) {
        select(filtered[activeIndex].family);
      } else if (query.trim()) {
        // Permite fonte fora da lista (Enterprise)
        select(query.trim());
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const categoryLabel: Record<string, string> = {
    sans: 'Sans',
    serif: 'Serif',
    display: 'Display',
    mono: 'Mono',
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Digite pra buscar (ex: Inter, Roboto, Playfair...)"
        className="w-full rounded border px-3 py-2 text-sm focus:border-brand focus:outline-none"
        style={{ fontFamily: `'${value}', sans-serif` }}
        autoComplete="off"
        aria-expanded={open}
        aria-controls="font-combobox-list"
        role="combobox"
      />
      {open && (
        <ul
          id="font-combobox-list"
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-card shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-text-2">
              Sem matches diretos para &ldquo;{query}&rdquo;. Pressione Enter para
              usar assim mesmo — o Google Fonts carrega dinamicamente.
            </li>
          ) : (
            filtered.map((f, i) => (
              <li
                key={f.family}
                role="option"
                aria-selected={i === activeIndex}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => select(f.family)}
                className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm ${
                  i === activeIndex ? 'bg-hover' : ''
                } ${value === f.family ? 'font-semibold' : ''}`}
              >
                <span style={{ fontFamily: `'${f.family}', sans-serif` }}>
                  {f.family}
                </span>
                <span className="ml-2 text-xs uppercase tracking-wide text-text-3">
                  {categoryLabel[f.category]}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
      <p className="mt-2 text-xs text-text-2">
        Lista mostra {POPULAR_GOOGLE_FONTS.length} Google Fonts populares.
        Pode digitar qualquer outra e confirmar com Enter (plano Enterprise).
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Picker de logo — suporta upload de arquivo local OU URL externa.
// Upload local converte pra data: URL (base64) e salva no theme_config.
// Limite 100KB pra manter o JSONB leve. Sprint futuro: substituir por
// upload real pra R2/S3 com presigned URL.
// ----------------------------------------------------------------------------
const LOGO_MAX_BYTES = 100 * 1024;
const LOGO_ACCEPT = 'image/svg+xml,image/png,image/jpeg,image/webp';

function LogoPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [mode, setMode] = useState<'upload' | 'url'>(
    value && value.startsWith('http') ? 'url' : 'upload',
  );
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    setError(null);
    if (!LOGO_ACCEPT.split(',').includes(file.type)) {
      setError(`Formato não suportado: ${file.type || 'desconhecido'}. Use SVG, PNG, JPG ou WebP.`);
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setError(
        `Arquivo muito grande (${Math.round(file.size / 1024)} KB). Limite: ${LOGO_MAX_BYTES / 1024} KB.`,
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') onChange(reader.result);
    };
    reader.onerror = () => setError('Falha ao ler o arquivo.');
    reader.readAsDataURL(file);
  }

  function clear() {
    setError(null);
    onChange(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-1">
          Logo
        </h2>
        <div className="flex gap-1 text-xs">
          <button
            type="button"
            onClick={() => setMode('upload')}
            className={`rounded px-2 py-1 ${mode === 'upload' ? 'bg-brand text-white' : 'bg-hover text-text-1'}`}
          >
            Upload
          </button>
          <button
            type="button"
            onClick={() => setMode('url')}
            className={`rounded px-2 py-1 ${mode === 'url' ? 'bg-brand text-white' : 'bg-hover text-text-1'}`}
          >
            URL externa
          </button>
        </div>
      </header>

      {mode === 'upload' ? (
        <div>
          <label
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border-strong p-6 text-center text-sm text-text-2 hover:border-brand hover:bg-page"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={LOGO_ACCEPT}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              className="hidden"
            />
            <span className="mb-1 font-medium text-text-1">
              Clique ou arraste um arquivo
            </span>
            <span className="text-xs">
              SVG, PNG, JPG ou WebP — até {LOGO_MAX_BYTES / 1024} KB
            </span>
          </label>
        </div>
      ) : (
        <input
          type="url"
          value={value && value.startsWith('http') ? value : ''}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder="https://cdn.suaempresa.com/logo.svg"
          className="w-full rounded border px-3 py-2 text-sm"
        />
      )}

      {error && (
        <p className="mt-2 rounded bg-red-50 p-2 text-xs text-danger">{error}</p>
      )}

      {value && (
        <div className="mt-4 rounded border border-border bg-page p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-text-2">
            <span>Preview</span>
            <button
              type="button"
              onClick={clear}
              className="text-danger hover:underline"
            >
              Remover
            </button>
          </div>
          <div className="flex h-20 items-center justify-center rounded bg-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt="Logo preview"
              className="max-h-16 max-w-full object-contain"
              onError={() => setError('Imagem não pôde ser carregada.')}
            />
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-text-2">
        Upload local funciona em desenvolvimento (salva como data: URL no banco).
        Sprint futuro: integração real com R2/S3 + presigned URL.
      </p>
    </section>
  );
}
