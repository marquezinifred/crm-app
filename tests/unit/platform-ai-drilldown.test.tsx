import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// ─── platform.tenantById mock state ────────────────────────────────────
const tenantState = {
  isLoading: false,
  data: {
    tenant: { id: 'ten1', name: 'Acme', slug: 'acme', plan: 'PRO' },
  } as null | Record<string, unknown>,
  error: null as null | { message: string },
};

// ─── platform.aiOps.byTenant mock state ────────────────────────────────
type ByTenantData = {
  limits: {
    monthlyTokenLimit: number | null;
    dailyRequestLimit: number | null;
    pinnedModelHaiku: string | null;
    pinnedModelSonnet: string | null;
    anomalyThresholdMultiplier: number;
  } | null;
  monthlyUsage: { tokens: number; costBrl: number; requests: number };
  breakdown: Array<{
    provider: string;
    model: string;
    tokens: number;
    requests: number;
    costBrl: number;
  }>;
  recentDaily: Array<{
    id: string;
    date: string;
    provider: string;
    model: string;
    requestCount: number;
    tokensInput: number;
    tokensOutput: number;
    costBrl: number;
  }>;
  anomalies: Array<{
    id: string;
    type: string;
    detectedAt: string;
    details: { today?: number; avg7d?: number; multiplier?: number };
    acknowledgedAt: string | null;
  }>;
};
const opsState: { isLoading: boolean; data: ByTenantData | null; error: { message: string } | null } = {
  isLoading: false,
  data: null,
  error: null,
};

// ─── platform.aiMarketplace.tenantAccessList mock state ────────────────
type AccessRow = {
  feature: {
    id: string;
    code: string;
    name: string;
    description: string;
    category: string;
    defaultProvider: string;
    defaultModel: string;
    addonPriceBrlMonthly: number | null;
  };
  state: { status: string; addonActivatedAt: string | null } | null;
};
const accessState: { isLoading: boolean; data: AccessRow[] | null; error: { message: string } | null } = {
  isLoading: false,
  data: null,
  error: null,
};

const setLimitsMutate = vi.fn();
const ackMutate = vi.fn();
const setAccessMutate = vi.fn();

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      platform: {
        aiOps: {
          byTenant: { invalidate: vi.fn() },
        },
        aiMarketplace: {
          tenantAccessList: { invalidate: vi.fn() },
        },
      },
    }),
    platform: {
      tenantById: {
        useQuery: () => ({
          isLoading: tenantState.isLoading,
          data: tenantState.data,
          error: tenantState.error,
        }),
      },
      aiOps: {
        byTenant: {
          useQuery: () => ({
            isLoading: opsState.isLoading,
            data: opsState.data,
            error: opsState.error,
          }),
        },
        setLimits: {
          useMutation: () => ({
            mutate: setLimitsMutate,
            isPending: false,
            error: null,
            isSuccess: false,
          }),
        },
        acknowledgeAlert: {
          useMutation: () => ({
            mutate: ackMutate,
            isPending: false,
            error: null,
          }),
        },
      },
      aiMarketplace: {
        tenantAccessList: {
          useQuery: () => ({
            isLoading: accessState.isLoading,
            data: accessState.data,
            error: accessState.error,
          }),
        },
        tenantAccessSet: {
          useMutation: () => ({
            mutate: setAccessMutate,
            isPending: false,
            error: null,
          }),
        },
      },
    },
  },
}));

// Importa depois dos mocks
import PlatformTenantAiPage from '@/app/platform/tenants/[id]/ai/page';
import PlatformTenantAiFeaturesPage from '@/app/platform/tenants/[id]/ai/features/page';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  setLimitsMutate.mockClear();
  ackMutate.mockClear();
  setAccessMutate.mockClear();
  tenantState.isLoading = false;
  tenantState.error = null;
  tenantState.data = {
    tenant: { id: 'ten1', name: 'Acme', slug: 'acme', plan: 'PRO' },
  };
  opsState.isLoading = false;
  opsState.error = null;
  opsState.data = null;
  accessState.isLoading = false;
  accessState.error = null;
  accessState.data = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(node: React.ReactElement) {
  await act(async () => {
    root.render(node);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('PlatformTenantAiPage (P-06 tela 1)', () => {
  it('renderiza header com nome do tenant + link de voltar', async () => {
    opsState.data = {
      limits: null,
      monthlyUsage: { tokens: 0, costBrl: 0, requests: 0 },
      breakdown: [],
      recentDaily: [],
      anomalies: [],
    };
    await render(<PlatformTenantAiPage params={{ id: 'ten1' }} />);
    expect(container.textContent).toContain('IA · Acme');
    expect(container.textContent).toContain('acme');
    const backLink = container.querySelector<HTMLAnchorElement>('a[href="/platform/tenants/ten1"]');
    expect(backLink).not.toBeNull();
    expect(backLink!.textContent).toContain('Voltar para Acme');
  });

  it('exibe empty states nos cards quando não há uso', async () => {
    opsState.data = {
      limits: null,
      monthlyUsage: { tokens: 0, costBrl: 0, requests: 0 },
      breakdown: [],
      recentDaily: [],
      anomalies: [],
    };
    await render(<PlatformTenantAiPage params={{ id: 'ten1' }} />);
    expect(container.textContent).toContain('Nenhum uso registrado');
    expect(container.textContent).toContain('Sem consumo no período');
    expect(container.textContent).toContain('Nenhuma anomalia registrada');
    expect(container.textContent).toContain('nenhum (usa default)');
  });

  it('renderiza breakdown por provider/model com % barra', async () => {
    opsState.data = {
      limits: null,
      monthlyUsage: { tokens: 15000, costBrl: 12.5, requests: 42 },
      breakdown: [
        {
          provider: 'ANTHROPIC',
          model: 'claude-haiku-4-5-20251001',
          tokens: 10000,
          requests: 30,
          costBrl: 8.0,
        },
        {
          provider: 'OPENAI',
          model: 'gpt-4o-mini',
          tokens: 5000,
          requests: 12,
          costBrl: 4.5,
        },
      ],
      recentDaily: [],
      anomalies: [],
    };
    await render(<PlatformTenantAiPage params={{ id: 'ten1' }} />);
    expect(container.textContent).toContain('ANTHROPIC');
    expect(container.textContent).toContain('claude-haiku-4-5-20251001');
    expect(container.textContent).toContain('OPENAI');
    expect(container.textContent).toContain('gpt-4o-mini');
    // Total do mês
    expect(container.textContent).toContain('15.000');
  });

  it('mostra progress bar quando há limite configurado', async () => {
    opsState.data = {
      limits: {
        monthlyTokenLimit: 100_000,
        dailyRequestLimit: null,
        pinnedModelHaiku: null,
        pinnedModelSonnet: null,
        anomalyThresholdMultiplier: 3,
      },
      monthlyUsage: { tokens: 40_000, costBrl: 5, requests: 20 },
      breakdown: [],
      recentDaily: [],
      anomalies: [],
    };
    await render(<PlatformTenantAiPage params={{ id: 'ten1' }} />);
    const progress = container.querySelector('[role="progressbar"]');
    expect(progress).not.toBeNull();
    expect(progress!.getAttribute('aria-valuenow')).toBe('40');
  });

  it('botão Reconhecer dispara ackMutate com id da anomalia', async () => {
    opsState.data = {
      limits: null,
      monthlyUsage: { tokens: 0, costBrl: 0, requests: 0 },
      breakdown: [],
      recentDaily: [],
      anomalies: [
        {
          id: 'a1',
          type: 'TOKEN_SPIKE',
          detectedAt: new Date('2026-06-30T10:00:00Z').toISOString(),
          details: { today: 500, avg7d: 100, multiplier: 5 },
          acknowledgedAt: null,
        },
      ],
    };
    await render(<PlatformTenantAiPage params={{ id: 'ten1' }} />);
    const btn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.includes('Reconhecer'),
    );
    expect(btn).toBeDefined();
    await act(async () => {
      btn!.click();
    });
    expect(ackMutate).toHaveBeenCalledWith({ id: 'a1' });
  });

  it('anomalia reconhecida esconde botão e mostra badge', async () => {
    opsState.data = {
      limits: null,
      monthlyUsage: { tokens: 0, costBrl: 0, requests: 0 },
      breakdown: [],
      recentDaily: [],
      anomalies: [
        {
          id: 'a1',
          type: 'TOKEN_SPIKE',
          detectedAt: new Date('2026-06-30T10:00:00Z').toISOString(),
          details: { today: 500, avg7d: 100, multiplier: 5 },
          acknowledgedAt: new Date('2026-06-30T11:00:00Z').toISOString(),
        },
      ],
    };
    await render(<PlatformTenantAiPage params={{ id: 'ten1' }} />);
    const btn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.includes('Reconhecer'),
    );
    expect(btn).toBeUndefined();
    expect(container.textContent).toContain('Reconhecida');
  });

  it('salvar limites dispara mutation com valores parseados', async () => {
    opsState.data = {
      limits: {
        monthlyTokenLimit: null,
        dailyRequestLimit: null,
        pinnedModelHaiku: null,
        pinnedModelSonnet: null,
        anomalyThresholdMultiplier: 3,
      },
      monthlyUsage: { tokens: 0, costBrl: 0, requests: 0 },
      breakdown: [],
      recentDaily: [],
      anomalies: [],
    };
    await render(<PlatformTenantAiPage params={{ id: 'ten1' }} />);
    // Encontrar o botão Salvar limites
    const saveBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === 'Salvar limites',
    );
    expect(saveBtn).toBeDefined();
    await act(async () => {
      saveBtn!.click();
    });
    expect(setLimitsMutate).toHaveBeenCalledTimes(1);
    const call = setLimitsMutate.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.tenantId).toBe('ten1');
    expect(call.monthlyTokenLimit).toBeNull();
    expect(call.dailyRequestLimit).toBeNull();
    expect(call.pinnedModelHaiku).toBeNull();
    expect(call.anomalyThresholdMultiplier).toBe(3);
  });

  it('exibe erro quando tenantById falha', async () => {
    tenantState.data = null;
    tenantState.error = { message: 'Tenant não encontrado.' };
    opsState.data = {
      limits: null,
      monthlyUsage: { tokens: 0, costBrl: 0, requests: 0 },
      breakdown: [],
      recentDaily: [],
      anomalies: [],
    };
    await render(<PlatformTenantAiPage params={{ id: 'ten1' }} />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain('Tenant não encontrado');
  });
});

describe('PlatformTenantAiFeaturesPage (P-06 tela 2)', () => {
  it('agrupa features por categoria', async () => {
    accessState.data = [
      {
        feature: {
          id: 'f1',
          code: 'summarize_email',
          name: 'Resumo de e-mails',
          description: 'Resumo automático da comunicação por thread',
          category: 'SUMMARIZATION',
          defaultProvider: 'ANTHROPIC',
          defaultModel: 'claude-haiku-4-5-20251001',
          addonPriceBrlMonthly: null,
        },
        state: { status: 'INCLUDED', addonActivatedAt: null },
      },
      {
        feature: {
          id: 'f2',
          code: 'lead_scoring',
          name: 'Scoring de leads',
          description: 'Prioriza leads por probabilidade de fechar',
          category: 'SCORING',
          defaultProvider: 'ANTHROPIC',
          defaultModel: 'claude-sonnet-4-6',
          addonPriceBrlMonthly: 199,
        },
        state: {
          status: 'ADDON_ACTIVE',
          addonActivatedAt: new Date('2026-03-15T00:00:00Z').toISOString(),
        },
      },
    ];
    await render(<PlatformTenantAiFeaturesPage params={{ id: 'ten1' }} />);
    expect(container.textContent).toContain('Sumarização');
    expect(container.textContent).toContain('Scoring / Previsão');
    expect(container.textContent).toContain('Resumo de e-mails');
    expect(container.textContent).toContain('Scoring de leads');
    expect(container.textContent).toContain('Add-on');
    expect(container.textContent).toContain('Incluída');
  });

  it('exibe empty state quando catálogo vazio', async () => {
    accessState.data = [];
    await render(<PlatformTenantAiFeaturesPage params={{ id: 'ten1' }} />);
    expect(container.textContent).toContain('Catálogo vazio');
  });

  it('trocar select dispara tenantAccessSet com {tenantId, featureId, status}', async () => {
    accessState.data = [
      {
        feature: {
          id: 'f1',
          code: 'summarize_email',
          name: 'Resumo',
          description: 'x',
          category: 'SUMMARIZATION',
          defaultProvider: 'ANTHROPIC',
          defaultModel: 'claude-haiku-4-5-20251001',
          addonPriceBrlMonthly: null,
        },
        state: { status: 'DISABLED', addonActivatedAt: null },
      },
    ];
    await render(<PlatformTenantAiFeaturesPage params={{ id: 'ten1' }} />);
    const select = container.querySelector<HTMLSelectElement>('select');
    expect(select).not.toBeNull();

    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      'value',
    )!.set!;
    await act(async () => {
      setter.call(select, 'ADDON_ACTIVE');
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(setAccessMutate).toHaveBeenCalledWith({
      tenantId: 'ten1',
      featureId: 'f1',
      status: 'ADDON_ACTIVE',
    });
  });

  it('conta ativas x total no header', async () => {
    accessState.data = [
      {
        feature: {
          id: 'f1',
          code: 'a',
          name: 'A',
          description: '',
          category: 'SUMMARIZATION',
          defaultProvider: 'ANTHROPIC',
          defaultModel: 'x',
          addonPriceBrlMonthly: null,
        },
        state: { status: 'INCLUDED', addonActivatedAt: null },
      },
      {
        feature: {
          id: 'f2',
          code: 'b',
          name: 'B',
          description: '',
          category: 'SEARCH',
          defaultProvider: 'OPENAI',
          defaultModel: 'y',
          addonPriceBrlMonthly: 50,
        },
        state: { status: 'DISABLED', addonActivatedAt: null },
      },
      {
        feature: {
          id: 'f3',
          code: 'c',
          name: 'C',
          description: '',
          category: 'SCORING',
          defaultProvider: 'ANTHROPIC',
          defaultModel: 'z',
          addonPriceBrlMonthly: 100,
        },
        state: null,
      },
    ];
    await render(<PlatformTenantAiFeaturesPage params={{ id: 'ten1' }} />);
    expect(container.textContent).toContain('1/3 ativa');
  });
});
