import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * P-23 — Smoke test do /admin/ai renderizando os 4 cards.
 *
 * Ao invés de mockar tRPC completo, mocka o hook trpc.<router>.<procedure>
 * retornando data estática e usa ToastProvider real. Confere:
 *   - PageHeader "IA" renderiza
 *   - 4 seções (Card A/B/C/D) presentes
 *   - Card B agrupa features por categoria e mostra o nome
 *   - Card D usa computeAiAlerts (integração leve — sem breaker aberto)
 */

type Cfg = {
  provider: 'ANTHROPIC' | 'OPENAI' | 'GOOGLE' | 'PERPLEXITY';
  model: string;
  apiKeyMasked: string | null;
  hasApiKey: boolean;
} | null;

type Feature = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: 'SUMMARIZATION' | 'SCORING' | 'SEARCH';
  defaultProvider: 'ANTHROPIC' | 'OPENAI';
  defaultModel: string;
  effectiveStatus: 'INCLUDED' | 'DISABLED' | 'ADDON_ACTIVE';
  providerOverride: 'ANTHROPIC' | 'OPENAI' | null;
  modelOverride: string | null;
  fallbackProvider: 'ANTHROPIC' | 'OPENAI' | null;
  fallbackModel: string | null;
  hasOwnKey: boolean;
  hasFallbackKey: boolean;
  costAlertBrlMonthly: number | null;
};

const state: {
  cfg: Cfg;
  features: Feature[];
  breakers: Array<{ provider: 'ANTHROPIC'; open: boolean }>;
  usage: { totalTokens: number; costUsd: number; breakdown: [] };
} = {
  cfg: {
    provider: 'ANTHROPIC',
    model: 'claude-haiku-4-5-20251001',
    apiKeyMasked: 'sk-a…zZ',
    hasApiKey: true,
  },
  features: [],
  breakers: [],
  usage: { totalTokens: 0, costUsd: 0, breakdown: [] },
};

vi.mock('@/lib/trpc/client', () => {
  const useQueryReturn = (data: unknown) => ({
    data,
    isLoading: false,
    isFetching: false,
  });
  const noopMutation = () => ({
    mutate: vi.fn(),
    isLoading: false,
  });
  return {
    trpc: {
      useUtils: () => ({
        aiConfig: {
          getConfig: { invalidate: vi.fn() },
          listFeatures: { invalidate: vi.fn() },
          breakerStatus: { invalidate: vi.fn() },
        },
      }),
      aiConfig: {
        getConfig: { useQuery: () => useQueryReturn(state.cfg) },
        listFeatures: { useQuery: () => useQueryReturn(state.features) },
        breakerStatus: { useQuery: () => useQueryReturn(state.breakers) },
        monthlyUsage: { useQuery: () => useQueryReturn(state.usage) },
        updateConfig: { useMutation: noopMutation },
        updateFeature: { useMutation: noopMutation },
        testKey: { useMutation: noopMutation },
        clearCircuitBreaker: { useMutation: noopMutation },
      },
    },
  };
});

import AdminAIPage from '@/app/admin/ai/page';
import { ToastProvider } from '@/components/ui/toast';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  state.cfg = {
    provider: 'ANTHROPIC',
    model: 'claude-haiku-4-5-20251001',
    apiKeyMasked: 'sk-a…zZ',
    hasApiKey: true,
  };
  state.features = [];
  state.breakers = [];
});

async function render(node: React.ReactElement) {
  await act(async () => {
    root.render(<ToastProvider>{node}</ToastProvider>);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('/admin/ai page (P-23)', () => {
  it('renderiza PageHeader e 4 seções (Cards A/B/C/D)', async () => {
    await render(<AdminAIPage />);

    // PageHeader
    expect(container.querySelector('h1')?.textContent).toBe('IA');

    // Card headings
    const h2s = Array.from(container.querySelectorAll('h2')).map(
      (h) => h.textContent,
    );
    expect(h2s).toContain('Configuração padrão');
    expect(h2s).toContain('Features de IA');
    expect(h2s).toContain('Uso e custo');
    expect(h2s).toContain('Alertas');
  });

  it('Card A pré-preenche provider/model do getConfig e mostra chave mascarada', async () => {
    await render(<AdminAIPage />);
    const providerSelect = container.querySelector<HTMLSelectElement>('select');
    expect(providerSelect?.value).toBe('ANTHROPIC');
    expect(container.textContent).toContain('sk-a…zZ');
  });

  it('Card B agrupa features por categoria (Resumos, Scoring, Busca)', async () => {
    state.features = [
      {
        id: 'a',
        code: 'communication-summary',
        name: 'Resumo de comunicações',
        description: null,
        category: 'SUMMARIZATION',
        defaultProvider: 'ANTHROPIC',
        defaultModel: 'claude-haiku-4-5-20251001',
        effectiveStatus: 'INCLUDED',
        providerOverride: null,
        modelOverride: null,
        fallbackProvider: null,
        fallbackModel: null,
        hasOwnKey: false,
        hasFallbackKey: false,
        costAlertBrlMonthly: null,
      },
      {
        id: 'b',
        code: 'lead-scoring',
        name: 'Scoring de leads',
        description: 'Pontuação preditiva',
        category: 'SCORING',
        defaultProvider: 'ANTHROPIC',
        defaultModel: 'claude-sonnet-4-6',
        effectiveStatus: 'INCLUDED',
        providerOverride: 'OPENAI',
        modelOverride: 'gpt-4o',
        fallbackProvider: null,
        fallbackModel: null,
        hasOwnKey: false,
        hasFallbackKey: false,
        costAlertBrlMonthly: null,
      },
    ];

    await render(<AdminAIPage />);

    const h3s = Array.from(container.querySelectorAll('h3')).map(
      (h) => h.textContent,
    );
    expect(h3s).toContain('Resumos');
    expect(h3s).toContain('Scoring');

    expect(container.textContent).toContain('Resumo de comunicações');
    expect(container.textContent).toContain('Scoring de leads');
    // provider override visível
    expect(container.textContent).toContain('OpenAI');
  });

  it('Card D exibe "Nenhum alerta ativo" quando não há breaker aberto e há chave global', async () => {
    await render(<AdminAIPage />);
    expect(container.textContent).toContain('Nenhum alerta ativo');
  });

  it('Card D exibe alerta CIRCUIT_OPEN com botão Limpar quando breaker aberto', async () => {
    state.breakers = [{ provider: 'ANTHROPIC', open: true }];
    await render(<AdminAIPage />);
    expect(container.textContent).toContain('circuit aberto');
    const buttons = Array.from(container.querySelectorAll('button')).map(
      (b) => b.textContent,
    );
    expect(buttons).toContain('Limpar');
  });

  it('Card D exibe MISSING_KEY quando tenant sem chave global e feature ativa sem chave', async () => {
    state.cfg = {
      provider: 'ANTHROPIC',
      model: 'claude-haiku-4-5-20251001',
      apiKeyMasked: null,
      hasApiKey: false,
    };
    state.features = [
      {
        id: 'nokey',
        code: 'x',
        name: 'Busca semântica',
        description: null,
        category: 'SEARCH',
        defaultProvider: 'OPENAI',
        defaultModel: 'gpt-4o',
        effectiveStatus: 'INCLUDED',
        providerOverride: null,
        modelOverride: null,
        fallbackProvider: null,
        fallbackModel: null,
        hasOwnKey: false,
        hasFallbackKey: false,
        costAlertBrlMonthly: null,
      },
    ];
    await render(<AdminAIPage />);
    expect(container.textContent).toContain('Busca semântica');
    expect(container.textContent).toContain('sem chave configurada');
  });
});
