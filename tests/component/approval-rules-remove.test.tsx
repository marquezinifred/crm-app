import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * P-96 — /admin/approval-rules trocou o `confirm()` nativo do browser
 * (proibido pelo design system, débito P-12) por AlertDialog Venzo no
 * botão "Remover regra".
 *
 * Cobre:
 *  1. clicar em "Remover" abre AlertDialog (role=dialog), NÃO confirm()
 *  2. confirmar dispara remove.mutate com id correto
 *  3. cancelar NÃO dispara remove e fecha o dialog
 *  4. remove onSuccess → toast + invalida list + fecha dialog
 *  5. remove onError → toast com friendlyTrpcError + fecha dialog
 *
 * Padrão de mocks: admin-users-actions.test.tsx (P-86).
 */

type MutationOpts = {
  onSuccess?: (data?: unknown) => void;
  onError?: (err: { message: string; data?: unknown }) => void;
};

interface RuleRow {
  id: string;
  name: string;
  criteria: 'UNIVERSAL' | 'MIN_MARGIN_BELOW' | 'TOTAL_VALUE_ABOVE';
  thresholdNumeric: number | null;
  approverRoles: string[];
  enabled: boolean;
}

const state: { rules: RuleRow[] } = { rules: [] };

const captured: {
  remove: MutationOpts | null;
  mutate: { remove: ReturnType<typeof vi.fn> };
  invalidate: ReturnType<typeof vi.fn>;
} = {
  remove: null,
  mutate: { remove: vi.fn() },
  invalidate: vi.fn(),
};

vi.mock('@/lib/trpc/client', () => {
  const queryReturn = <T,>(data: T) => ({
    data,
    isLoading: false,
    isFetching: false,
    error: null,
  });
  const noopMutation = () => ({ mutate: vi.fn(), isPending: false, error: null });
  return {
    trpc: {
      useUtils: () => ({
        approvalRules: { list: { invalidate: captured.invalidate } },
      }),
      approvalRules: {
        list: { useQuery: () => queryReturn(state.rules) },
        create: { useMutation: noopMutation },
        update: { useMutation: noopMutation },
        remove: {
          useMutation: (opts: MutationOpts) => {
            captured.remove = opts;
            return { mutate: captured.mutate.remove, isPending: false, error: null };
          },
        },
      },
    },
  };
});

import ApprovalRulesPage from '@/app/admin/approval-rules/page';
import { ToastProvider } from '@/components/ui/toast';

function renderPage() {
  return render(
    <ToastProvider>
      <ApprovalRulesPage />
    </ToastProvider>,
  );
}

beforeEach(() => {
  state.rules = [
    {
      id: 'rule-1',
      name: 'Margem crítica',
      criteria: 'MIN_MARGIN_BELOW',
      thresholdNumeric: 20,
      approverRoles: ['DIRETOR_COMERCIAL'],
      enabled: true,
    },
  ];
  captured.remove = null;
  captured.mutate.remove = vi.fn();
  captured.invalidate = vi.fn();
});

describe('/admin/approval-rules — Remover via AlertDialog (P-96)', () => {
  it('clicar em "Remover" abre AlertDialog do design system', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /^Remover$/i }));

    const dialog = screen.getByRole('dialog', { name: /Remover regra\?/i });
    expect(dialog).toBeInTheDocument();
    // menciona o nome da regra na descrição
    expect(within(dialog).getByText(/Margem crítica/i)).toBeInTheDocument();
    // NÃO chamou remove ainda — só abriu o dialog
    expect(captured.mutate.remove).not.toHaveBeenCalled();
  });

  it('confirmar dispara remove.mutate com id correto', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /^Remover$/i }));
    const dialog = screen.getByRole('dialog', { name: /Remover regra\?/i });
    await user.click(within(dialog).getByRole('button', { name: /^Remover$/i }));

    expect(captured.mutate.remove).toHaveBeenCalledTimes(1);
    expect(captured.mutate.remove).toHaveBeenCalledWith({ id: 'rule-1' });
  });

  it('cancelar NÃO dispara remove e fecha o dialog', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /^Remover$/i }));
    const dialog = screen.getByRole('dialog', { name: /Remover regra\?/i });
    await user.click(within(dialog).getByRole('button', { name: /Cancelar/i }));

    expect(captured.mutate.remove).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /Remover regra\?/i }),
      ).not.toBeInTheDocument();
    });
  });

  it('remove onSuccess dispara toast + invalida list + fecha dialog', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Remover$/i }));
    expect(captured.remove?.onSuccess).toBeTypeOf('function');

    await act(async () => {
      captured.remove!.onSuccess!();
    });

    await waitFor(() => {
      expect(screen.getByText(/Regra removida\./i)).toBeInTheDocument();
    });
    expect(captured.invalidate).toHaveBeenCalled();
    expect(
      screen.queryByRole('dialog', { name: /Remover regra\?/i }),
    ).not.toBeInTheDocument();
  });

  it('remove onError dispara toast com friendlyTrpcError + fecha dialog', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Remover$/i }));
    expect(captured.remove?.onError).toBeTypeOf('function');

    await act(async () => {
      captured.remove!.onError!({ message: 'Regra em uso por proposta ativa.' });
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Regra em uso por proposta ativa/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('dialog', { name: /Remover regra\?/i }),
    ).not.toBeInTheDocument();
  });
});
