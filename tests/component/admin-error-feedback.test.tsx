import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * P-92 — padronização do feedback de mutations nas telas /admin/*.
 *
 * Bug reportado em prod (2026-07-17, Fred como ANALISTA): mutations
 * admin falhando com FORBIDDEN sem NENHUM feedback na tela. Casos mais
 * graves eram /admin/conversion-rates e /admin/approval-rules — o
 * usuário clicava Salvar, aparentava sucesso e os valores voltavam ao
 * recarregar (silent failure).
 *
 * Padrão P-53/P-86 replicado: mocka `@/lib/trpc/client` com Proxy
 * genérico capturando `onSuccess`/`onError` de qualquer mutation,
 * `ToastProvider` real, dispara handlers manualmente e verifica
 * `[role="alert"]` (error) / `[role="status"]` (success).
 *
 * Cobertura:
 *  /admin/conversion-rates (crítica)
 *   1. click Salvar dispara updateConversionRates com rates da query
 *   2. save onError → toast com friendlyTrpcError
 *   3. save onSuccess → toast success + invalidate (rates + projeção)
 *   4. suggest onError → toast com friendlyTrpcError
 *  /admin/approval-rules (crítica)
 *   5. create onError → toast com friendlyTrpcError
 *   6. create onSuccess → toast "Regra criada." + invalidate
 *   7. toggle (update) onError → toast com friendlyTrpcError
 *   8. remove onSuccess → toast "Regra removida."
 *  Smoke dos demais
 *   9. /admin/alerts — save onError → toast; onSuccess → toast success
 *  10. /admin/contracts — save onError → toast
 *  11. /admin/privacy — process onSuccess → toast; reject onError → toast
 */

type MutationOpts = {
  onSuccess?: (data?: unknown) => void;
  onError?: (err: { message: string; data?: unknown }) => void;
};

const registry: {
  queries: Record<string, unknown>;
  mutationOpts: Record<string, MutationOpts | undefined>;
  mutate: Record<string, ReturnType<typeof vi.fn>>;
  invalidate: Record<string, ReturnType<typeof vi.fn>>;
} = {
  queries: {},
  mutationOpts: {},
  mutate: {},
  invalidate: {},
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin',
}));

vi.mock('@/lib/trpc/client', () => {
  const getMutate = (path: string) => {
    if (!registry.mutate[path]) registry.mutate[path] = vi.fn();
    return registry.mutate[path]!;
  };
  const getInvalidate = (path: string) => {
    if (!registry.invalidate[path]) registry.invalidate[path] = vi.fn();
    return registry.invalidate[path]!;
  };
  const procApi = (path: string) => ({
    useQuery: () => ({
      data: registry.queries[path] ?? null,
      isLoading: false,
      isFetching: false,
      error: null,
    }),
    useMutation: (opts?: MutationOpts) => {
      registry.mutationOpts[path] = opts;
      return {
        mutate: getMutate(path),
        mutateAsync: vi.fn(),
        isPending: false,
        isLoading: false,
        error: null,
      };
    },
  });
  const routerProxy = (router: string) =>
    new Proxy(
      {},
      { get: (_t, proc) => procApi(`${router}.${String(proc)}`) },
    );
  const utilsRouterProxy = (router: string) =>
    new Proxy(
      {},
      {
        get: (_t, proc) => ({
          invalidate: getInvalidate(`${router}.${String(proc)}`),
        }),
      },
    );
  const utils = new Proxy(
    {},
    { get: (_t, router) => utilsRouterProxy(String(router)) },
  );
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
import AdminContractsPage from '@/app/admin/contracts/page';
import AdminPrivacyPage from '@/app/admin/privacy/page';
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
  registry.mutationOpts = {};
  registry.mutate = {};
  registry.invalidate = {};
});

describe('/admin/conversion-rates (P-92 crítica — silent failure)', () => {
  beforeEach(() => {
    registry.queries['reports.conversionRates'] = { ...RATES };
  });

  it('click em Salvar dispara updateConversionRates com as rates atuais', async () => {
    const user = userEvent.setup();
    renderWithToast(<ConversionRatesPage />);

    await user.click(screen.getByRole('button', { name: /^Salvar$/i }));

    const mutate = registry.mutate['reports.updateConversionRates'];
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ rates: RATES });
  });

  it('save onError renderiza toast com friendlyTrpcError', async () => {
    renderWithToast(<ConversionRatesPage />);
    const opts = registry.mutationOpts['reports.updateConversionRates'];
    expect(opts?.onError).toBeTypeOf('function');

    await act(async () => {
      opts!.onError!({
        message: 'Seu perfil não tem acesso a esta operação.',
      });
    });

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toMatch(/Seu perfil não tem acesso a esta operação/i);
    });
  });

  it('save onSuccess renderiza toast success + invalida rates e projeção', async () => {
    renderWithToast(<ConversionRatesPage />);
    const opts = registry.mutationOpts['reports.updateConversionRates'];
    expect(opts?.onSuccess).toBeTypeOf('function');

    await act(async () => {
      opts!.onSuccess!();
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Taxas de conversão salvas\./i),
      ).toBeInTheDocument();
    });
    expect(registry.invalidate['reports.conversionRates']).toHaveBeenCalled();
    expect(registry.invalidate['reports.revenueProjection']).toHaveBeenCalled();
  });

  it('suggest onError renderiza toast com friendlyTrpcError', async () => {
    renderWithToast(<ConversionRatesPage />);
    const opts = registry.mutationOpts['reports.suggestConversionRates'];
    expect(opts?.onError).toBeTypeOf('function');

    await act(async () => {
      opts!.onError!({ message: 'IA indisponível no momento.' });
    });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(
        /IA indisponível/i,
      );
    });
  });
});

describe('/admin/approval-rules (P-92 crítica — silent failure)', () => {
  beforeEach(() => {
    registry.queries['approvalRules.list'] = [
      {
        id: 'rule-1',
        name: 'Margem baixa',
        criteria: 'MIN_MARGIN_BELOW',
        thresholdNumeric: 20,
        approverRoles: ['DIRETOR_COMERCIAL'],
        enabled: true,
      },
    ];
  });

  it('create onError renderiza toast com friendlyTrpcError', async () => {
    renderWithToast(<ApprovalRulesPage />);
    const opts = registry.mutationOpts['approvalRules.create'];
    expect(opts?.onError).toBeTypeOf('function');

    await act(async () => {
      opts!.onError!({
        message: 'Seu perfil não tem acesso a esta operação.',
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(
        /Seu perfil não tem acesso a esta operação/i,
      );
    });
  });

  it('create onSuccess renderiza toast "Regra criada." + invalida list', async () => {
    renderWithToast(<ApprovalRulesPage />);
    const opts = registry.mutationOpts['approvalRules.create'];

    await act(async () => {
      opts!.onSuccess!();
    });

    await waitFor(() => {
      expect(screen.getByText(/Regra criada\./i)).toBeInTheDocument();
    });
    expect(registry.invalidate['approvalRules.list']).toHaveBeenCalled();
  });

  it('toggle (update) onError renderiza toast com friendlyTrpcError', async () => {
    renderWithToast(<ApprovalRulesPage />);
    const opts = registry.mutationOpts['approvalRules.update'];
    expect(opts?.onError).toBeTypeOf('function');

    await act(async () => {
      opts!.onError!({ message: 'Sem permissão para editar regras.' });
    });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(
        /Sem permissão para editar regras/i,
      );
    });
  });

  it('remove onSuccess renderiza toast "Regra removida."', async () => {
    renderWithToast(<ApprovalRulesPage />);
    const opts = registry.mutationOpts['approvalRules.remove'];

    await act(async () => {
      opts!.onSuccess!();
    });

    await waitFor(() => {
      expect(screen.getByText(/Regra removida\./i)).toBeInTheDocument();
    });
    expect(registry.invalidate['approvalRules.list']).toHaveBeenCalled();
  });
});

describe('/admin/alerts (P-92 smoke)', () => {
  beforeEach(() => {
    registry.queries['alerts.tenantConfig'] = {
      alertLeadDays: [7, 1],
      centralCrmEmail: null,
      taskOverdueDays: 2,
    };
  });

  it('save onError renderiza toast (banner inline removido)', async () => {
    renderWithToast(<AdminAlertsPage />);
    const opts = registry.mutationOpts['alerts.updateConfig'];
    expect(opts?.onError).toBeTypeOf('function');

    await act(async () => {
      opts!.onError!({
        message: 'Seu perfil não tem acesso a esta operação.',
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(
        /Seu perfil não tem acesso a esta operação/i,
      );
    });
  });

  it('save onSuccess renderiza toast success', async () => {
    renderWithToast(<AdminAlertsPage />);
    const opts = registry.mutationOpts['alerts.updateConfig'];

    await act(async () => {
      opts!.onSuccess!();
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Configurações de alertas salvas\./i),
      ).toBeInTheDocument();
    });
  });
});

describe('/admin/contracts (P-92 smoke)', () => {
  beforeEach(() => {
    registry.queries['contractsConfig.getConfig'] = {
      handoffEmails: [],
      contractRenewalLeadDays: [90, 60, 30],
    };
  });

  it('save onError renderiza toast', async () => {
    renderWithToast(<AdminContractsPage />);
    const opts = registry.mutationOpts['contractsConfig.updateConfig'];
    expect(opts?.onError).toBeTypeOf('function');

    await act(async () => {
      opts!.onError!({ message: 'Sem permissão.' });
    });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Sem permissão/i);
    });
  });
});

describe('/admin/privacy (P-92 smoke)', () => {
  beforeEach(() => {
    registry.queries['privacy.listAll'] = [];
  });

  it('process onSuccess renderiza toast success', async () => {
    renderWithToast(<AdminPrivacyPage />);
    const opts = registry.mutationOpts['privacy.process'];

    await act(async () => {
      opts!.onSuccess!();
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Solicitação processada\./i),
      ).toBeInTheDocument();
    });
    expect(registry.invalidate['privacy.listAll']).toHaveBeenCalled();
  });

  it('reject onError renderiza toast', async () => {
    renderWithToast(<AdminPrivacyPage />);
    const opts = registry.mutationOpts['privacy.reject'];
    expect(opts?.onError).toBeTypeOf('function');

    await act(async () => {
      opts!.onError!({ message: 'Justificativa muito curta.' });
    });

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(
        /Justificativa muito curta/i,
      );
    });
  });
});
