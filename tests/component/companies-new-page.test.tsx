import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * P-94 — rota estática /companies/new.
 *
 * Antes do fix, o Next matcheava [id] com id="new" → companies.byId
 * rejeitava o uuid → erro Zod cru na tela (link quebrado em
 * /admin/partners). Cobre:
 *  1. render do form de criação (Razão social + botão Criar empresa)
 *  2. submit dispara companies.create com payload correto
 *  3. onSuccess → redirect pra /companies/<id> (toast vem do CompanyForm)
 *  4. Cancelar → volta pra /companies
 *  5. onError → mensagem amigável via friendlyTrpcError (não JSON cru)
 *
 * Padrão de mocks: tests/component/admin-users-actions.test.tsx (P-86).
 */

const routerPush = vi.fn();
const routerBack = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, back: routerBack }),
  usePathname: () => '/companies/new',
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// useCidadesByUF usa @tanstack/react-query direto (precisa de
// QueryClientProvider) — mocka só o hook, mantendo ESTADOS_BR/PAISES reais.
vi.mock('@/lib/data/brasil', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/brasil')>();
  return {
    ...actual,
    useCidadesByUF: () => ({ data: [], isLoading: false }),
  };
});

type MutationOpts = {
  onSuccess?: (data?: unknown) => void;
  onError?: (err: { message: string; data?: unknown }) => void;
};

const captured: {
  create: MutationOpts | null;
  mutate: ReturnType<typeof vi.fn>;
} = { create: null, mutate: vi.fn() };

vi.mock('@/lib/trpc/client', () => {
  const queryReturn = (data: unknown) => ({
    data,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  });
  return {
    trpc: {
      useUtils: () => ({
        companies: {
          list: { invalidate: vi.fn() },
          byId: { invalidate: vi.fn() },
        },
      }),
      companies: {
        byId: {
          // Desabilitada em modo criação (enabled: false)
          useQuery: () => queryReturn(undefined),
        },
        create: {
          useMutation: (opts: MutationOpts) => {
            captured.create = opts;
            return {
              mutate: captured.mutate,
              isPending: false,
              isLoading: false,
              error: null,
            };
          },
        },
        update: {
          useMutation: () => ({
            mutate: vi.fn(),
            isPending: false,
            isLoading: false,
            error: null,
          }),
        },
      },
      territories: {
        list: { useQuery: () => queryReturn([{ id: 'ter-1', name: 'Sul' }]) },
      },
      segments: {
        list: { useQuery: () => queryReturn([]) },
      },
      industries: {
        list: { useQuery: () => queryReturn([]) },
      },
    },
  };
});

import NewCompanyPage from '@/app/companies/new/page';
import { ToastProvider } from '@/components/ui/toast';

function renderPage() {
  return render(
    <ToastProvider>
      <NewCompanyPage />
    </ToastProvider>,
  );
}

beforeEach(() => {
  captured.create = null;
  captured.mutate = vi.fn();
  routerPush.mockClear();
  routerBack.mockClear();
});

describe('/companies/new (P-94)', () => {
  it('renderiza o form de criação full-page', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: /Nova empresa/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Razão social/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Criar empresa/i }),
    ).toBeInTheDocument();
    // Breadcrumb de volta pra lista
    expect(
      screen.getByRole('link', { name: /Voltar para empresas/i }),
    ).toHaveAttribute('href', '/companies');
  });

  it('submit dispara companies.create com razão social preenchida', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/Razão social/i), 'ACME LTDA');
    await user.click(screen.getByRole('button', { name: /Criar empresa/i }));

    expect(captured.mutate).toHaveBeenCalledTimes(1);
    expect(captured.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ razaoSocial: 'ACME LTDA', type: 'CLIENT' }),
    );
  });

  it('create onSuccess redireciona pra /companies/<id> com toast', async () => {
    renderPage();
    expect(captured.create?.onSuccess).toBeTypeOf('function');

    await act(async () => {
      captured.create!.onSuccess!({ id: 'co-new-1', razaoSocial: 'ACME LTDA' });
    });

    expect(routerPush).toHaveBeenCalledWith('/companies/co-new-1');
    await waitFor(() => {
      expect(
        screen.getByText(/ACME LTDA adicionada ao seu portfólio/i),
      ).toBeInTheDocument();
    });
  });

  it('Cancelar volta pra /companies sem disparar create', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /Cancelar/i }));

    expect(routerPush).toHaveBeenCalledWith('/companies');
    expect(captured.mutate).not.toHaveBeenCalled();
  });

  it('create onError renderiza mensagem amigável, não JSON cru', async () => {
    renderPage();
    expect(captured.create?.onError).toBeTypeOf('function');

    const rawZodMessage = JSON.stringify([
      { code: 'custom', message: 'CNPJ inválido', path: ['cnpj'] },
    ]);
    await act(async () => {
      captured.create!.onError!({
        message: rawZodMessage,
        data: {
          zodError: { fieldErrors: { cnpj: ['CNPJ inválido'] }, formErrors: [] },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('CNPJ inválido');
    });
    expect(screen.queryByText(rawZodMessage)).not.toBeInTheDocument();
  });
});
