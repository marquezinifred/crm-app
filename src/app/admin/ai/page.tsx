'use client';

import * as React from 'react';
import { AIProvider } from '@prisma/client';
import { trpc, type RouterOutputs } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { AlertDialog } from '@/components/ui/alert-dialog';
import { Table, THead, TBody, TH, TR, TD, TableEmpty } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { computeAiAlerts } from '@/lib/ai/admin-alerts';

/**
 * P-23 — Sprint 15F: UI dos 4 Cards de /admin/ai.
 *
 *  A. Configuração padrão do tenant
 *  B. Features de IA (tabela + modal de edição por feature)
 *  C. Uso e custo do mês corrente
 *  D. Alertas (circuit breaker aberto + feature sem chave)
 *
 * Backend Sprint 15F (aiConfig router) já expõe tudo — esta UI só consome.
 */

const RECOMMENDED_MODELS: Record<AIProvider, string[]> = {
  ANTHROPIC: [
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-6',
    'claude-opus-4-8',
  ],
  OPENAI: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1'],
  GOOGLE: ['gemini-1.5-flash', 'gemini-1.5-pro'],
  PERPLEXITY: ['llama-3.1-sonar-small-128k-online'],
};

const PROVIDER_LABEL: Record<AIProvider, string> = {
  ANTHROPIC: 'Anthropic',
  OPENAI: 'OpenAI',
  GOOGLE: 'Google',
  PERPLEXITY: 'Perplexity',
};

const CATEGORY_LABEL: Record<string, string> = {
  SUMMARIZATION: 'Resumos',
  SCORING: 'Scoring',
  SEARCH: 'Busca',
  CLASSIFICATION: 'Classificação',
  GENERATION: 'Geração',
  EXTRACTION: 'Extração',
};

const CATEGORY_ORDER = [
  'SUMMARIZATION',
  'SCORING',
  'SEARCH',
  'CLASSIFICATION',
  'GENERATION',
  'EXTRACTION',
];

export default function AdminAIPage() {
  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <PageHeader
        title="IA"
        description="Provider, modelo e chave por tenant e por feature. Fallback opcional quando o provider primário falha."
      />
      <CardConfigPadrao />
      <CardFeatures />
      <CardUsoCusto />
      <CardAlertas />
    </main>
  );
}

// ────────────────────────────────────────────────────────────────
// Card A — Configuração padrão do tenant
// ────────────────────────────────────────────────────────────────

function CardConfigPadrao() {
  const { toast } = useToast();
  const cfg = trpc.aiConfig.getConfig.useQuery();
  const utils = trpc.useUtils();

  const [provider, setProvider] = React.useState<AIProvider>('ANTHROPIC');
  const [model, setModel] = React.useState('claude-haiku-4-5-20251001');
  const [apiKey, setApiKey] = React.useState('');
  const [testResult, setTestResult] = React.useState<{
    ok: boolean;
    latencyMs: number;
    reason?: string;
  } | null>(null);

  React.useEffect(() => {
    if (cfg.data) {
      setProvider(cfg.data.provider);
      setModel(cfg.data.model ?? 'claude-haiku-4-5-20251001');
    }
  }, [cfg.data]);

  const save = trpc.aiConfig.updateConfig.useMutation({
    onSuccess: () => {
      setApiKey('');
      utils.aiConfig.getConfig.invalidate();
      utils.aiConfig.listFeatures.invalidate();
      toast({ kind: 'success', title: 'Configuração salva.' });
    },
    onError: (e) => {
      toast({ kind: 'error', title: 'Erro ao salvar', description: friendlyTrpcError(e) });
    },
  });

  const test = trpc.aiConfig.testKey.useMutation({
    onSuccess: (r) => setTestResult(r),
    onError: (e) => {
      setTestResult({ ok: false, latencyMs: 0, reason: e.message });
    },
  });

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <header className="mb-4">
        <h2 className="text-h3 text-text-1">Configuração padrão</h2>
        <p className="text-body text-text-2 mt-1">
          Provider, modelo e chave usados quando uma feature não tem override específico.
        </p>
      </header>

      <form
        className="space-y-4 max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ provider, model, apiKey: apiKey || undefined });
        }}
      >
        <Field label="Provider" required>
          <Select
            value={provider}
            onChange={(e) => {
              const p = e.target.value as AIProvider;
              setProvider(p);
              setModel(RECOMMENDED_MODELS[p][0]!);
              setTestResult(null);
            }}
          >
            {Object.values(AIProvider).map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Modelo" required>
          <Select value={model} onChange={(e) => setModel(e.target.value)}>
            {RECOMMENDED_MODELS[provider].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Chave API"
          helper={
            cfg.data?.hasApiKey
              ? `Atual: ${cfg.data.apiKeyMasked}. Preencha para substituir.`
              : 'Nenhuma chave configurada. Preencha para habilitar IA.'
          }
        >
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setTestResult(null);
            }}
            placeholder={cfg.data?.hasApiKey ? '(deixe vazio para manter)' : 'sk-…'}
            autoComplete="off"
          />
        </Field>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            loading={test.isLoading}
            disabled={!apiKey}
            onClick={() =>
              test.mutate({ provider, model, apiKey })
            }
          >
            Testar chave
          </Button>
          <Button type="submit" loading={save.isLoading}>
            Salvar
          </Button>
        </div>

        {testResult && (
          <div
            role="status"
            className={
              testResult.ok
                ? 'rounded border border-success/40 bg-success/10 p-3 text-[13.5px] text-success-text'
                : 'rounded border border-danger/40 bg-danger/10 p-3 text-[13.5px] text-danger-text'
            }
          >
            {testResult.ok ? (
              <>✓ Chave válida — resposta em {testResult.latencyMs}ms.</>
            ) : (
              <>
                ✗ Chave inválida
                {testResult.reason ? ` — ${testResult.reason}` : ''}.
              </>
            )}
          </div>
        )}
      </form>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────
// Card B — Features de IA
// ────────────────────────────────────────────────────────────────

type FeatureRow = RouterOutputs['aiConfig']['listFeatures'][number];

function CardFeatures() {
  const list = trpc.aiConfig.listFeatures.useQuery();
  const [editing, setEditing] = React.useState<FeatureRow | null>(null);

  const grouped = React.useMemo(() => {
    const map = new Map<string, FeatureRow[]>();
    for (const f of list.data ?? []) {
      const arr = map.get(f.category) ?? [];
      arr.push(f);
      map.set(f.category, arr);
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({
      category: c,
      features: map.get(c)!,
    }));
  }, [list.data]);

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <header className="mb-4">
        <h2 className="text-h3 text-text-1">Features de IA</h2>
        <p className="text-body text-text-2 mt-1">
          Sobrescreva provider, modelo e chave por feature. Configure fallback opcional
          para quando o primário falhar.
        </p>
      </header>

      {list.isLoading && <p className="text-text-2">Carregando…</p>}

      {!list.isLoading && grouped.length === 0 && (
        <p className="text-text-2">Nenhuma feature de IA cadastrada.</p>
      )}

      {grouped.map(({ category, features }) => (
        <div key={category} className="mb-5 last:mb-0">
          <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-text-2 mb-2">
            {CATEGORY_LABEL[category] ?? category}
          </h3>
          <Table>
            <THead>
              <TR>
                <TH>Feature</TH>
                <TH>Status</TH>
                <TH>Provider</TH>
                <TH>Modelo</TH>
                <TH>Chave</TH>
                <TH>Fallback</TH>
                <TH className="text-right"></TH>
              </TR>
            </THead>
            <TBody>
              {features.length === 0 && <TableEmpty colSpan={7}>—</TableEmpty>}
              {features.map((f) => {
                const effProvider = f.providerOverride ?? f.defaultProvider;
                const effModel = f.modelOverride ?? f.defaultModel;
                const isCustomProvider =
                  f.providerOverride !== null || f.modelOverride !== null;
                const fallbackLabel = f.fallbackProvider
                  ? `${PROVIDER_LABEL[f.fallbackProvider]} ${f.fallbackModel ?? ''}`.trim()
                  : '—';
                return (
                  <TR
                    key={f.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setEditing(f)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setEditing(f);
                      }
                    }}
                    className="cursor-pointer"
                  >
                    <TD>
                      <div className="font-medium text-text-1">{f.name}</div>
                      {f.description && (
                        <div className="text-caption text-text-3 line-clamp-1">
                          {f.description}
                        </div>
                      )}
                    </TD>
                    <TD>
                      <StatusBadge status={f.effectiveStatus} />
                    </TD>
                    <TD>
                      {PROVIDER_LABEL[effProvider]}
                      {!isCustomProvider && (
                        <span className="ml-1 text-caption text-text-3">(padrão)</span>
                      )}
                    </TD>
                    <TD className="font-mono text-caption">{effModel}</TD>
                    <TD>
                      {f.hasOwnKey ? (
                        <span className="text-text-1">Custom</span>
                      ) : (
                        <span className="text-text-3">Herdada</span>
                      )}
                    </TD>
                    <TD className="text-text-2">{fallbackLabel}</TD>
                    <TD className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(f);
                        }}
                      >
                        Editar
                      </Button>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      ))}

      {editing && (
        <FeatureEditModal
          feature={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    INCLUDED: {
      label: 'Ativa',
      className: 'bg-success/15 text-success-text border-success/30',
    },
    ADDON_ACTIVE: {
      label: 'Add-on',
      className: 'bg-info/15 text-info-text border-info/30',
    },
    DISABLED: {
      label: 'Desativada',
      className: 'bg-text-3/15 text-text-2 border-border',
    },
  };
  const s = map[status] ?? map.DISABLED!;
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded border text-caption font-medium ${s.className}`}
    >
      {s.label}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────
// Modal de edição de feature
// ────────────────────────────────────────────────────────────────

function FeatureEditModal({
  feature,
  onClose,
}: {
  feature: FeatureRow;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [enable, setEnable] = React.useState(feature.effectiveStatus !== 'DISABLED');
  const [useProviderOverride, setUseProviderOverride] = React.useState(
    feature.providerOverride !== null,
  );
  const [providerOverride, setProviderOverride] = React.useState<AIProvider>(
    feature.providerOverride ?? feature.defaultProvider,
  );
  const [modelOverride, setModelOverride] = React.useState(
    feature.modelOverride ?? feature.defaultModel,
  );
  const [useOwnKey, setUseOwnKey] = React.useState(feature.hasOwnKey);
  const [apiKey, setApiKey] = React.useState('');

  const [useFallback, setUseFallback] = React.useState(feature.fallbackProvider !== null);
  const [fallbackProvider, setFallbackProvider] = React.useState<AIProvider>(
    feature.fallbackProvider ?? 'OPENAI',
  );
  const [fallbackModel, setFallbackModel] = React.useState(
    feature.fallbackModel ?? RECOMMENDED_MODELS.OPENAI[0]!,
  );
  const [fallbackApiKey, setFallbackApiKey] = React.useState('');

  const [costAlert, setCostAlert] = React.useState<string>(
    feature.costAlertBrlMonthly !== null
      ? String(feature.costAlertBrlMonthly)
      : '',
  );

  const [testResult, setTestResult] = React.useState<{
    ok: boolean;
    latencyMs: number;
    reason?: string;
  } | null>(null);

  const save = trpc.aiConfig.updateFeature.useMutation({
    onSuccess: () => {
      utils.aiConfig.listFeatures.invalidate();
      toast({ kind: 'success', title: 'Feature atualizada.' });
      onClose();
    },
    onError: (e) => {
      toast({ kind: 'error', title: 'Erro ao salvar', description: friendlyTrpcError(e) });
    },
  });

  const test = trpc.aiConfig.testKey.useMutation({
    onSuccess: (r) => setTestResult(r),
    onError: (e) => setTestResult({ ok: false, latencyMs: 0, reason: e.message }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedCost =
      costAlert.trim() === '' ? null : Number(costAlert.replace(',', '.'));
    save.mutate({
      featureId: feature.id,
      enable,
      providerOverride: useProviderOverride ? providerOverride : null,
      modelOverride: useProviderOverride ? modelOverride : null,
      apiKey: useOwnKey && apiKey ? apiKey : null,
      fallbackProvider: useFallback ? fallbackProvider : null,
      fallbackModel: useFallback ? fallbackModel : null,
      fallbackApiKey: useFallback && fallbackApiKey ? fallbackApiKey : null,
      costAlertBrlMonthly:
        parsedCost !== null && !Number.isNaN(parsedCost) ? parsedCost : null,
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={feature.name}
      description={feature.description ?? undefined}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="flex items-center gap-2 text-[13.5px]">
          <input
            type="checkbox"
            checked={enable}
            onChange={(e) => setEnable(e.target.checked)}
            className="h-4 w-4"
          />
          Feature ativa para este tenant
        </label>

        <fieldset className="border border-border rounded p-4 space-y-3">
          <legend className="text-caption px-2 text-text-2">Provider e modelo</legend>
          <label className="flex items-center gap-2 text-[13.5px]">
            <input
              type="checkbox"
              checked={useProviderOverride}
              onChange={(e) => setUseProviderOverride(e.target.checked)}
              className="h-4 w-4"
            />
            Sobrescrever provider/modelo padrão do tenant
          </label>
          <p className="text-caption text-text-3">
            Padrão herdado: {PROVIDER_LABEL[feature.defaultProvider]} —{' '}
            {feature.defaultModel}
          </p>
          {useProviderOverride && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Provider">
                <Select
                  value={providerOverride}
                  onChange={(e) => {
                    const p = e.target.value as AIProvider;
                    setProviderOverride(p);
                    setModelOverride(RECOMMENDED_MODELS[p][0]!);
                    setTestResult(null);
                  }}
                >
                  {Object.values(AIProvider).map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_LABEL[p]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Modelo">
                <Select
                  value={modelOverride}
                  onChange={(e) => setModelOverride(e.target.value)}
                >
                  {RECOMMENDED_MODELS[providerOverride].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </fieldset>

        <fieldset className="border border-border rounded p-4 space-y-3">
          <legend className="text-caption px-2 text-text-2">Chave API</legend>
          <label className="flex items-center gap-2 text-[13.5px]">
            <input
              type="checkbox"
              checked={useOwnKey}
              onChange={(e) => setUseOwnKey(e.target.checked)}
              className="h-4 w-4"
            />
            Usar chave própria para esta feature
          </label>
          {useOwnKey && (
            <>
              <Field
                label="Chave API"
                helper={
                  feature.hasOwnKey
                    ? 'Chave própria já configurada. Preencha para substituir.'
                    : 'Sem chave própria; deixe vazio para continuar herdando.'
                }
              >
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="sk-…"
                  autoComplete="off"
                />
              </Field>
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={test.isLoading}
                  disabled={!apiKey}
                  onClick={() => {
                    const p = useProviderOverride
                      ? providerOverride
                      : feature.defaultProvider;
                    const m = useProviderOverride ? modelOverride : feature.defaultModel;
                    test.mutate({ provider: p, model: m, apiKey });
                  }}
                >
                  Testar chave
                </Button>
              </div>
              {testResult && (
                <div
                  role="status"
                  className={
                    testResult.ok
                      ? 'rounded border border-success/40 bg-success/10 p-2 text-caption text-success-text'
                      : 'rounded border border-danger/40 bg-danger/10 p-2 text-caption text-danger-text'
                  }
                >
                  {testResult.ok
                    ? `✓ Chave válida (${testResult.latencyMs}ms)`
                    : `✗ Chave inválida${testResult.reason ? ` — ${testResult.reason}` : ''}`}
                </div>
              )}
            </>
          )}
        </fieldset>

        <fieldset className="border border-border rounded p-4 space-y-3">
          <legend className="text-caption px-2 text-text-2">Fallback</legend>
          <label className="flex items-center gap-2 text-[13.5px]">
            <input
              type="checkbox"
              checked={useFallback}
              onChange={(e) => setUseFallback(e.target.checked)}
              className="h-4 w-4"
            />
            Configurar provider de fallback quando o primário falhar
          </label>
          {useFallback && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Provider fallback">
                  <Select
                    value={fallbackProvider}
                    onChange={(e) => {
                      const p = e.target.value as AIProvider;
                      setFallbackProvider(p);
                      setFallbackModel(RECOMMENDED_MODELS[p][0]!);
                    }}
                  >
                    {Object.values(AIProvider).map((p) => (
                      <option key={p} value={p}>
                        {PROVIDER_LABEL[p]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Modelo fallback">
                  <Select
                    value={fallbackModel}
                    onChange={(e) => setFallbackModel(e.target.value)}
                  >
                    {RECOMMENDED_MODELS[fallbackProvider].map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field
                label="Chave API do fallback"
                helper={
                  feature.hasFallbackKey
                    ? 'Chave de fallback já configurada. Preencha para substituir.'
                    : 'Deixe vazio para reusar a chave global do provider.'
                }
              >
                <Input
                  type="password"
                  value={fallbackApiKey}
                  onChange={(e) => setFallbackApiKey(e.target.value)}
                  placeholder="sk-…"
                  autoComplete="off"
                />
              </Field>
            </>
          )}
        </fieldset>

        <Field
          label="Alerta de custo (R$/mês)"
          helper="Opcional. Deixe vazio para não gerar alerta de custo."
        >
          <Input
            inputMode="decimal"
            value={costAlert}
            onChange={(e) => setCostAlert(e.target.value)}
            placeholder="ex: 150"
          />
        </Field>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isLoading}>
            Salvar
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────
// Card C — Uso e custo
// ────────────────────────────────────────────────────────────────

function CardUsoCusto() {
  const usage = trpc.aiConfig.monthlyUsage.useQuery();
  const data = usage.data;

  const maxCostRow = React.useMemo(() => {
    if (!data || data.breakdown.length === 0) return 0;
    return Math.max(
      ...data.breakdown.map((b) => b.cost + b.fallbackCost),
      Number.EPSILON,
    );
  }, [data]);

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-h3 text-text-1">Uso e custo</h2>
          <p className="text-body text-text-2 mt-1">
            Consumo do mês corrente, agregado por provider e modelo.
          </p>
        </div>
        <div
          className="flex items-center gap-3 text-caption text-text-2 shrink-0"
          aria-label="Legenda"
        >
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-sm bg-info" />
            Primary
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-sm bg-warning" />
            Fallback
          </span>
        </div>
      </header>

      {usage.isLoading && <p className="text-text-2">Calculando…</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 mb-4 md:grid-cols-4">
            <Stat
              label="Total de tokens"
              value={data.totalTokens.toLocaleString('pt-BR')}
            />
            <Stat label="Custo (USD)" value={`$${data.costUsd.toFixed(4)}`} />
            <Stat
              label="Tokens fallback"
              value={data.totalFallbackTokens.toLocaleString('pt-BR')}
            />
            <Stat
              label="Custo fallback (USD)"
              value={`$${data.totalFallbackCostUsd.toFixed(4)}`}
            />
          </div>

          {data.breakdown.length > 0 ? (
            <ul className="space-y-3" aria-label="Uso por provider e modelo">
              {data.breakdown.map((b, i) => {
                const total = b.cost + b.fallbackCost;
                const primaryPct = maxCostRow > 0 ? (b.cost / maxCostRow) * 100 : 0;
                const fallbackPct =
                  maxCostRow > 0 ? (b.fallbackCost / maxCostRow) * 100 : 0;
                return (
                  <li
                    key={`${b.provider}-${b.model}-${i}`}
                    className="rounded border border-border p-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <span className="font-medium text-text-1">
                          {PROVIDER_LABEL[b.provider]}
                        </span>
                        <span className="ml-2 font-mono text-caption text-text-3">
                          {b.model}
                        </span>
                      </div>
                      <div className="text-caption text-text-2 tabular-nums">
                        {(b.requests + b.fallbackRequests).toLocaleString('pt-BR')} req ·{' '}
                        {(b.tokens + b.fallbackTokens).toLocaleString('pt-BR')} tk ·{' '}
                        <span className="text-text-1 font-medium">
                          ${total.toFixed(4)}
                        </span>
                      </div>
                    </div>
                    <div
                      className="flex h-2 w-full items-center gap-1"
                      role="img"
                      aria-label={`Primary $${b.cost.toFixed(4)} — Fallback $${b.fallbackCost.toFixed(4)}`}
                    >
                      <span
                        className="h-full rounded-sm bg-info"
                        style={{ width: `${primaryPct}%` }}
                        title={`Primary: ${b.requests} req · ${b.tokens.toLocaleString('pt-BR')} tk · $${b.cost.toFixed(4)}`}
                      />
                      {b.fallbackRequests > 0 && (
                        <span
                          className="h-full rounded-sm bg-warning"
                          style={{ width: `${fallbackPct}%` }}
                          title={`Fallback: ${b.fallbackRequests} req · ${b.fallbackTokens.toLocaleString('pt-BR')} tk · $${b.fallbackCost.toFixed(4)}`}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-text-2">Sem uso de IA neste mês.</p>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border p-3">
      <p className="text-caption text-text-3">{label}</p>
      <p className="text-h3 text-text-1 tabular-nums">{value}</p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Card D — Alertas
// ────────────────────────────────────────────────────────────────

function CardAlertas() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const status = trpc.aiConfig.breakerStatus.useQuery();
  const cfg = trpc.aiConfig.getConfig.useQuery();
  const list = trpc.aiConfig.listFeatures.useQuery();
  const usageAlerts = trpc.aiConfig.featureUsageForAlerts.useQuery();

  const clear = trpc.aiConfig.clearCircuitBreaker.useMutation({
    onSuccess: () => {
      utils.aiConfig.breakerStatus.invalidate();
      toast({ kind: 'success', title: 'Circuit breaker limpo.' });
    },
    onError: (e) => {
      toast({ kind: 'error', title: 'Erro', description: friendlyTrpcError(e) });
    },
  });

  const [confirmClear, setConfirmClear] = React.useState<AIProvider | null>(null);

  const alerts = React.useMemo(
    () =>
      computeAiAlerts({
        breakers: status.data ?? [],
        tenantHasGlobalKey: !!cfg.data?.hasApiKey,
        features: (list.data ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          effectiveStatus: f.effectiveStatus,
          hasOwnKey: f.hasOwnKey,
        })),
        featureUsage: usageAlerts.data ?? [],
      }),
    [status.data, cfg.data, list.data, usageAlerts.data],
  );

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <header className="mb-4">
        <h2 className="text-h3 text-text-1">Alertas</h2>
        <p className="text-body text-text-2 mt-1">
          Circuit breakers abertos e features sem chave. Refeitos a cada carga.
        </p>
      </header>

      {(status.isLoading || cfg.isLoading || list.isLoading || usageAlerts.isLoading) && (
        <p className="text-text-2">Verificando…</p>
      )}

      {!status.isLoading &&
        !cfg.isLoading &&
        !list.isLoading &&
        !usageAlerts.isLoading &&
        alerts.length === 0 && (
          <p className="text-text-2">Nenhum alerta ativo.</p>
        )}

      <ul className="space-y-2">
        {alerts.map((a) => (
          <li
            key={a.id}
            className={
              a.severity === 'red'
                ? 'flex items-start gap-3 rounded border border-danger/40 bg-danger/10 p-3'
                : 'flex items-start gap-3 rounded border border-warning/40 bg-warning/10 p-3'
            }
          >
            <span
              aria-hidden
              className={
                a.severity === 'red'
                  ? 'shrink-0 h-2.5 w-2.5 rounded-full bg-danger mt-1.5'
                  : 'shrink-0 h-2.5 w-2.5 rounded-full bg-warning mt-1.5'
              }
            />
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-semibold text-text-1">{a.title}</p>
              <p className="text-caption text-text-2 mt-0.5">{a.detail}</p>
            </div>
            {a.kind === 'CIRCUIT_OPEN' && a.provider && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={clear.isLoading}
                onClick={() => setConfirmClear(a.provider!)}
              >
                Limpar
              </Button>
            )}
          </li>
        ))}
      </ul>

      <AlertDialog
        open={confirmClear !== null}
        onCancel={() => setConfirmClear(null)}
        onConfirm={() => {
          if (confirmClear) {
            clear.mutate({ provider: confirmClear });
            setConfirmClear(null);
          }
        }}
        title="Limpar circuit breaker?"
        description={
          confirmClear
            ? `As próximas chamadas ao ${PROVIDER_LABEL[confirmClear]} voltam a tentar o provider primário. Se a causa raiz não estiver resolvida, o breaker abre de novo.`
            : ''
        }
        confirmLabel="Limpar"
        tone="primary"
        loading={clear.isLoading}
      />
    </section>
  );
}
