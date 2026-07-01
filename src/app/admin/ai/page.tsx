'use client';

import * as React from 'react';
import { AIProvider } from '@prisma/client';
import { trpc } from '@/lib/trpc/client';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';

/**
 * P-23 fase 1 — Sprint 15F: /admin/ai refactor.
 *
 * Card A: configuração padrão do tenant (provider/model/apiKey) +
 * botão "Testar chave". Consome `aiConfig.getConfig`,
 * `aiConfig.updateConfig` e `aiConfig.testKey` (todos já entregues
 * pelo backend Sprint 15F).
 *
 * Cards B/C/D vêm na fase 2.
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

export default function AdminAIPage() {
  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <PageHeader
        title="IA"
        description="Provider, modelo e chave por tenant e por feature. Fallback opcional quando o provider primário falha."
      />
      <CardConfigPadrao />
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
      toast({ kind: 'success', title: 'Configuração salva.' });
    },
    onError: (e) => {
      toast({ kind: 'error', title: 'Erro ao salvar', description: e.message });
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
