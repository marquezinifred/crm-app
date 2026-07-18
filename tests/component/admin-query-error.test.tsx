import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { render, screen } from '@testing-library/react';

/**
 * P-92b — error state das QUERIES nas telas /admin/*.
 *
 * Bug em prod (2026-07-17, Fred como ANALISTA): depois do P-91 várias
 * queries de config admin viraram `adminOnlyProcedure` → retornam 403
 * pra não-admin. As telas dependiam dessas queries e travavam em
 * "Carregando…" infinito (guard `if (!data) return Carregando`) OU
 * mostravam a lista/tabela vazia silenciosamente.
 *
 * Complementa o P-92 (que cobriu `onError` de MUTATIONS via toast).
 * Aqui: query em estado de erro → `ErrorState` do design system com a
 * mensagem via `friendlyTrpcError`. NUNCA "Carregando…" eterno, NUNCA
 * JSON cru do TRPCError/Zod.
 *
 * Padrão de mock (P-53/P-92): mocka `@/lib/trpc/client` com Proxy
 * genérico; a diferença deste arquivo é que `useQuery` reflete um estado
 * de erro/loading/success por-path via `registry.queryError`/`queries`,
 * modelando a semântica do react-query (sem data e sem erro = loading).
 */

const registry: {
  queries: Record<string, unknown>;
  queryError: Record<string, { message: string; data?: unknown } | undefined>;
  refetch: Record<string, ReturnType<typeof vi.fn>>;
} = {
  queries: {},
  queryError: {},
  refetch: {},
};

const FORBIDDEN_MSG = 'Perfil ANALISTA não tem acesso (requer um de: ADMIN)';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin',
}));

vi.mock('@/lib/trpc/client', () => {
  const getRefetch = (path: string) => {
    if (!registry.refetch[path]) registry.refetch[path] = vi.fn();
    return registry.refetch[path]!;
  };
  const procApi = (path: string) => ({
    useQuery: () => {
      const data = registry.queries[path] ?? null;
      const error = registry.queryError[path] ?? null;
      return {
        data,
        error,
        isError: !!error,
        // Semântica react-query: sem data e sem erro = ainda carregando.
        isLoading: !data && !error,
        isFetching: false,
        refetch: getRefetch(path),
      };
    },
    useMutation: (opts?: unknown) => {
      void opts;
      return {
        mutate: vi.fn(),
        mutateAsync: vi.fn(),
        isPending: false,
        isLoading: false,
        error: null,
      };
    },
  });
  const routerProxy = (router: string) =>
    new Proxy({}, { get: (_t, proc) => procApi(`${router}.${String(proc)}`) });
  const utilsRouterProxy = () =>
    new Proxy({}, { get: () => ({ invalidate: vi.fn() }) });
  const utils = new Proxy({}, { get: () => utilsRouterProxy() });
  const trpc = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'useUtils') return () => utils;
        return routerProxy(String(prop));
      },
    },
  );
  return { trpc };
});

import ConversionRatesPage from '@/app/admin/conversion-rates/page';
import ApprovalRulesPage from '@/app/admin/approval-rules/page';
import AdminAlertsPage from '@/app/admin/alerts/page';
import AdminProductsPage from '@/app/admin/products/page';
import { ToastProvider } from '@/components/ui/toast';

function renderWithToast(node: React.ReactElement) {
  return render(<ToastProvider>{node}</ToastProvider>);
}

const RATES = {
  PROSPECT: 5,
  LEAD: 15,
  OPORTUNIDADE: 30,
  PROPOSTA: 50,
  NEGOCIACAO: 70,
  ACEITE: 85,
  CONTRATO: 100,
};

beforeEach(() => {
  registry.queries = {};
  registry.queryError = {};
  registry.refetch = {};
});

describe('/admin/conversion-rates (P-92b — caso crítico original)', () => {
  it('query em erro (403) renderiza ErrorState amigável, não "Carregando…" eterno', () => {
    registry.queryError['reports.conversionRates'] = { message: FORBIDDEN_MSG };
    renderWithToast(<ConversionRatesPage />);

    // Título do ErrorState + descrição amigável via friendlyTrpcError.
    expect(
      screen.getByText('Não foi possível carregar as taxas de conversão.'),
    ).toBeInTheDocument();
    expect(screen.getByText(FORBIDDEN_MSG)).toBeInTheDocument();
    // Nunca fica preso em loading.
    expect(screen.queryByText(/Carregando/i)).not.toBeInTheDocument();
    // Botão de retry do ErrorState.
    expect(
      screen.getByRole('button', { name: /Tentar novamente/i }),
    ).toBeInTheDocument();
  });

  it('não renderiza JSON cru do erro (Zod/TRPCError) na tela', () => {
    registry.queryError['reports.conversionRates'] = {
      message: '[{"code":"custom","message":"boom","path":["x"]}]',
      data: {
        zodError: { fieldErrors: { rates: ['Valor inválido'] }, formErrors: [] },
      },
    };
    renderWithToast(<ConversionRatesPage />);

    // friendlyTrpcError extrai o fieldError, não mostra o array cru.
    expect(screen.getByText('Valor inválido')).toBeInTheDocument();
    expect(screen.queryByText(/"code":"custom"/)).not.toBeInTheDocument();
  });

  it('loading legítimo (sem erro, sem data) preserva "Carregando…"', () => {
    // nenhum erro, nenhuma data → isLoading
    renderWithToast(<ConversionRatesPage />);
    expect(screen.getByText(/Carregando/i)).toBeInTheDocument();
    expect(
      screen.queryByText('Não foi possível carregar as taxas de conversão.'),
    ).not.toBeInTheDocument();
  });

  it('sucesso (data presente) renderiza o form, sem ErrorState', () => {
    registry.queries['reports.conversionRates'] = { ...RATES };
    renderWithToast(<ConversionRatesPage />);
    expect(
      screen.getByRole('button', { name: /^Salvar$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Não foi possível carregar as taxas de conversão.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Carregando/i)).not.toBeInTheDocument();
  });
});

describe('/admin/approval-rules (P-92b — caso crítico)', () => {
  it('query em erro (403) renderiza ErrorState amigável + preserva o PageHeader', () => {
    registry.queryError['approvalRules.list'] = { message: FORBIDDEN_MSG };
    renderWithToast(<ApprovalRulesPage />);

    expect(
      screen.getByText('Não foi possível carregar as regras de aprovação.'),
    ).toBeInTheDocument();
    expect(screen.getByText(FORBIDDEN_MSG)).toBeInTheDocument();
    // PageHeader continua visível (contexto da tela preservado) — match
    // exato pra não colidir com o <h3> do ErrorState, que também contém
    // "regras de aprovação".
    expect(
      screen.getByRole('heading', { name: 'Regras de aprovação' }),
    ).toBeInTheDocument();
    // Não mostra o form de nova regra quando o read foi negado.
    expect(
      screen.queryByRole('button', { name: /Adicionar regra/i }),
    ).not.toBeInTheDocument();
  });

  it('sucesso renderiza o form normalmente, sem ErrorState', () => {
    registry.queries['approvalRules.list'] = [];
    renderWithToast(<ApprovalRulesPage />);
    expect(
      screen.getByRole('button', { name: /Adicionar regra/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Não foi possível carregar as regras de aprovação.'),
    ).not.toBeInTheDocument();
  });
});

describe('/admin/alerts (P-92b — smoke: trap de loading infinito)', () => {
  it('query em erro (403) mostra ErrorState em vez de "Carregando…" eterno', () => {
    registry.queryError['alerts.tenantConfig'] = { message: FORBIDDEN_MSG };
    renderWithToast(<AdminAlertsPage />);

    expect(
      screen.getByText('Não foi possível carregar a configuração de alertas.'),
    ).toBeInTheDocument();
    expect(screen.getByText(FORBIDDEN_MSG)).toBeInTheDocument();
    expect(screen.queryByText(/Carregando/i)).not.toBeInTheDocument();
  });
});

describe('/admin/products (P-92b — smoke: tabela)', () => {
  it('query em erro (403) mostra ErrorState em vez do empty state silencioso', () => {
    registry.queryError['products.list'] = { message: FORBIDDEN_MSG };
    renderWithToast(<AdminProductsPage />);

    expect(
      screen.getByText('Não foi possível carregar o catálogo.'),
    ).toBeInTheDocument();
    expect(screen.getByText(FORBIDDEN_MSG)).toBeInTheDocument();
    // Não cai no empty state enganoso "cadastre o primeiro produto".
    expect(
      screen.queryByText(/Cadastre o primeiro produto/i),
    ).not.toBeInTheDocument();
  });
});
