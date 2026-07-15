import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * P-89 — Fix duplicação de oportunidade em /pipeline/new.
 *
 * Bug reproduzido em produção (Fred, 2026-07-10):
 *  - Usuário criar opp em /pipeline/new → clica Salvar → backend cria opp
 *    → frontend abre Sheet lateral (via intercepting route `@modal/(.)[id]`)
 *    → usuário fecha Sheet → volta pro form /pipeline/new com dados
 *    preenchidos → clica Salvar novamente → cria opp duplicata idêntica.
 *
 * Fix em 2 camadas (defesa em profundidade):
 *  1. `router.push('/pipeline')` desmonta o form ao invés de abrir Sheet.
 *  2. `disabled={create.isSuccess}` bloqueia resubmit mesmo se o redirect
 *     não desmontar imediatamente (clique duplo rápido antes do push).
 *
 * Cobertura deste arquivo:
 *  - submit success dispara `router.push('/pipeline')` (não `/pipeline/<id>`)
 *  - clique duplo no botão (2 cliques rápidos) → apenas 1 mutation
 *  - button fica disabled após success (bloqueia resubmit)
 *  - submit com erro → button volta a ficar habilitado
 */

const routerPush = vi.fn();
const routerBack = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, back: routerBack }),
}));

vi.mock('@/components/ui/quick-create-trigger', () => ({
  QuickCreateTrigger: () => null,
}));

type MutationOpts = {
  onSuccess?: (data?: unknown) => void;
  onError?: (err: { message: string; data?: unknown }) => void;
};

type MutationState = {
  isLoading: boolean;
  isPending: boolean;
  isSuccess: boolean;
  error: { message: string; data?: unknown } | null;
};

const captured: {
  create: MutationOpts | null;
  mutate: ReturnType<typeof vi.fn>;
  state: MutationState;
} = {
  create: null,
  mutate: vi.fn(),
  state: { isLoading: false, isPending: false, isSuccess: false, error: null },
};

vi.mock('@/lib/trpc/client', () => {
  const queryReturn = (data: unknown) => ({
    data,
    isLoading: false,
    isFetching: false,
    error: null,
  });
  return {
    trpc: {
      useUtils: () => ({
        companies: { list: { invalidate: vi.fn() } },
      }),
      users: {
        me: {
          useQuery: () => queryReturn({ id: 'me-1', fullName: 'Fred', role: 'ADMIN' }),
        },
        list: {
          useQuery: () =>
            queryReturn([{ id: 'u-1', fullName: 'Alice', role: 'ADMIN' }]),
        },
      },
      companies: {
        list: {
          useQuery: (input: { type: string }) => {
            if (input?.type === 'CLIENT') {
              return queryReturn({
                rows: [{ id: 'co-1', razaoSocial: 'ACME LTDA', nomeFantasia: 'ACME' }],
              });
            }
            return queryReturn({ rows: [] });
          },
        },
      },
      leadSources: {
        list: { useQuery: () => queryReturn([]) },
      },
      opportunities: {
        create: {
          useMutation: (opts: MutationOpts) => {
            captured.create = opts;
            return {
              mutate: captured.mutate,
              ...captured.state,
            };
          },
        },
      },
    },
  };
});

import NewOpportunityPage from '@/app/pipeline/new/page';
import { ToastProvider } from '@/components/ui/toast';

function renderPage() {
  return render(
    <ToastProvider>
      <NewOpportunityPage />
    </ToastProvider>,
  );
}

function fillMinimumFields(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  const selects = Array.from(container.querySelectorAll<HTMLSelectElement>('select'));
  const company = selects.find((s) =>
    Array.from(s.options).some((o) => o.value === 'co-1'),
  )!;
  const owner = selects.find((s) =>
    Array.from(s.options).some((o) => o.value === 'u-1'),
  )!;
  return (async () => {
    await user.type(screen.getByLabelText(/Título/i), 'Renovação ACME');
    await user.selectOptions(company, 'co-1');
    await user.selectOptions(owner, 'u-1');
  })();
}

beforeEach(() => {
  routerPush.mockClear();
  routerBack.mockClear();
  captured.create = null;
  captured.mutate = vi.fn();
  captured.state = { isLoading: false, isPending: false, isSuccess: false, error: null };
});

describe('/pipeline/new — P-89 defesa em profundidade contra duplicação', () => {
  it('onSuccess redireciona pra /pipeline (kanban), não pra /pipeline/<id>', async () => {
    renderPage();
    expect(captured.create?.onSuccess).toBeTypeOf('function');

    await act(async () => {
      captured.create!.onSuccess!({ id: 'opp-99', title: 'Renovação ACME' });
    });

    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith('/pipeline');
    });
    // Garantia explícita: nunca chama com /pipeline/<id> (que abriria Sheet
    // interceptada sobre o form e permitiria resubmit).
    expect(routerPush).not.toHaveBeenCalledWith('/pipeline/opp-99');
  });

  it('clique duplo rápido no Salvar após primeiro success → apenas 1 mutation', async () => {
    const user = userEvent.setup();
    const { container, rerender } = renderPage();
    await fillMinimumFields(user, container);

    const button = screen.getByRole('button', { name: /Criar oportunidade/i });

    // Primeiro clique — mutate é chamado.
    await user.click(button);
    expect(captured.mutate).toHaveBeenCalledTimes(1);

    // Simula estado pós-success (isSuccess=true) — o React Query flipa isso
    // sincronamente após o onSuccess. Re-renderiza pra refletir.
    captured.state = { isLoading: false, isPending: false, isSuccess: true, error: null };
    rerender(
      <ToastProvider>
        <NewOpportunityPage />
      </ToastProvider>,
    );

    // Segundo clique — o botão está disabled agora, o click não dispara submit.
    await user.click(screen.getByRole('button', { name: /Criar oportunidade/i }));
    expect(captured.mutate).toHaveBeenCalledTimes(1);
  });

  it('botão fica disabled após success (aria-disabled)', async () => {
    const { rerender } = renderPage();

    // Baseline: habilitado.
    expect(screen.getByRole('button', { name: /Criar oportunidade/i })).not.toBeDisabled();

    // Simula estado pós-success.
    captured.state = { isLoading: false, isPending: false, isSuccess: true, error: null };
    rerender(
      <ToastProvider>
        <NewOpportunityPage />
      </ToastProvider>,
    );

    expect(screen.getByRole('button', { name: /Criar oportunidade/i })).toBeDisabled();
  });

  it('botão fica disabled durante isLoading (evita resubmit enquanto pending)', () => {
    captured.state = { isLoading: true, isPending: true, isSuccess: false, error: null };
    renderPage();

    const button = screen.getByRole('button', { name: /Criar oportunidade/i });
    expect(button).toBeDisabled();
    // aria-busy sinaliza spinner ativo (Button component do design system).
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('submit com erro → botão volta a ficar habilitado', () => {
    captured.state = {
      isLoading: false,
      isPending: false,
      isSuccess: false,
      error: { message: 'algo deu ruim' },
    };
    renderPage();

    // Erro exibido, mas botão continua habilitado pra retry manual.
    expect(screen.getByRole('button', { name: /Criar oportunidade/i })).not.toBeDisabled();
  });

  it('onSuccess dispara toast antes do redirect (feedback claro)', async () => {
    renderPage();

    await act(async () => {
      captured.create!.onSuccess!({ id: 'opp-99', title: 'Renovação ACME' });
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Oportunidade Renovação ACME criada no pipeline\./i),
      ).toBeInTheDocument();
    });
    expect(routerPush).toHaveBeenCalledWith('/pipeline');
  });
});
