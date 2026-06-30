'use client';

import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { AIProvider } from '@prisma/client';

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

export default function AdminAIPage() {
  const cfg = trpc.aiConfig.getConfig.useQuery();
  const usage = trpc.aiConfig.monthlyUsage.useQuery();
  const utils = trpc.useUtils();
  const [provider, setProvider] = useState<AIProvider>('ANTHROPIC');
  const [model, setModel] = useState('claude-haiku-4-5-20251001');
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    if (cfg.data) {
      setProvider(cfg.data.provider);
      setModel(cfg.data.model ?? 'claude-haiku-4-5-20251001');
    }
  }, [cfg.data]);

  const save = trpc.aiConfig.updateConfig.useMutation({
    onSuccess: () => {
      setApiKey('');
      utils.aiConfig.getConfig.invalidate();
    },
  });

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Configuração de IA</h1>

      <section className="mb-6 rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-1">
          Provedor e modelo
        </h2>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({
              provider,
              model,
              apiKey: apiKey || undefined,
            });
          }}
        >
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Provedor</span>
            <select
              value={provider}
              onChange={(e) => {
                const p = e.target.value as AIProvider;
                setProvider(p);
                setModel(RECOMMENDED_MODELS[p][0]!);
              }}
              className="w-full rounded border px-3 py-2"
            >
              {Object.values(AIProvider).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Modelo</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded border px-3 py-2"
            >
              {RECOMMENDED_MODELS[provider].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">API Key</span>
            <p className="mb-1 text-xs text-text-2">
              {cfg.data?.hasApiKey
                ? `Atual: ${cfg.data.apiKeyMasked} — preencha aqui para substituir.`
                : 'Nenhuma chave configurada — preencha para habilitar IA.'}
            </p>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={cfg.data?.hasApiKey ? '(deixe vazio para manter)' : 'sk-...'}
              className="w-full rounded border px-3 py-2"
            />
          </label>

          <Button type="submit" disabled={save.isLoading}>
            {save.isLoading ? 'Salvando…' : 'Salvar'}
          </Button>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-1">
          Consumo do mês corrente
        </h2>
        {usage.isLoading && <p className="text-sm text-text-2">Calculando…</p>}
        {usage.data && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
              <Stat label="Total de tokens" value={usage.data.totalTokens.toLocaleString('pt-BR')} />
              <Stat label="Custo (USD)" value={`$${usage.data.costUsd.toFixed(4)}`} />
            </div>
            {usage.data.breakdown.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-text-2">
                  <tr>
                    <th className="py-2">Provider</th>
                    <th>Modelo</th>
                    <th className="text-right">Tokens</th>
                    <th className="text-right">Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.data.breakdown.map((b, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-2">{b.provider}</td>
                      <td>{b.model}</td>
                      <td className="text-right">{b.tokens.toLocaleString('pt-BR')}</td>
                      <td className="text-right">${b.cost.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-text-2">Sem uso de IA neste mês.</p>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border p-3">
      <p className="text-xs text-text-2">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
