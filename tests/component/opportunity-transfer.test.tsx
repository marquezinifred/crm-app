import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Sprint 15G.5 Fase 3a — componentes de transferência em /pipeline/[id] (P-87).
 *
 * Cobre (Testing Library, padrão P-53):
 *  - TransferBadge presentational (com/sem nome)
 *  - TransferActionButton: escondido quando targetsForOpportunity erra/vazio,
 *    visível com targets; modal dispara `request` com args certos; toast
 *    success/error
 *  - CancelTransferButton: AlertDialog confirma → `cancel({ transferId })`;
 *    toast success/error
 *  - TransferHistorySection: escondido em erro (sem permission) / vazio;
 *    renderiza linhas com data
 */

type MutationOpts = {
  onSuccess?: (data?: unknown) => void;
  onError?: (err: { message: string; data?: unknown }) => void;
};

const state = vi.hoisted(() => ({
  targets: { data: [] as unknown[], error: null as unknown, isLoading: false },
  history: { data: [] as unknown[], error: null as unknown, isLoading: false },
  requestOpts: null as MutationOpts | null,
  requestMutate: vi.fn(),
  cancelOpts: null as MutationOpts | null,
  cancelMutate: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      opportunities: { byId: { invalidate: state.invalidate } },
      opportunityTransfers: {
        targetsForOpportunity: { invalidate: state.invalidate },
        historyForOpportunity: { invalidate: state.invalidate },
      },
    }),
    opportunityTransfers: {
      targetsForOpportunity: { useQuery: () => state.targets },
      historyForOpportunity: { useQuery: () => state.history },
      request: {
        useMutation: (opts: MutationOpts) => {
          state.requestOpts = opts;
          return { mutate: state.requestMutate, isLoading: false };
        },
      },
      cancel: {
        useMutation: (opts: MutationOpts) => {
          state.cancelOpts = opts;
          return { mutate: state.cancelMutate, isLoading: false };
        },
      },
    },
  },
}));

import { TransferBadge } from '@/components/transfers/TransferBadge';
import { TransferActionButton } from '@/components/transfers/TransferActionButton';
import { CancelTransferButton } from '@/components/transfers/CancelTransferButton';
import { TransferHistorySection } from '@/components/transfers/TransferHistorySection';
import { ToastProvider } from '@/components/ui/toast';

function renderWithToast(node: React.ReactElement) {
  return render(<ToastProvider>{node}</ToastProvider>);
}

beforeEach(() => {
  state.targets = { data: [], error: null, isLoading: false };
  state.history = { data: [], error: null, isLoading: false };
  state.requestOpts = null;
  state.cancelOpts = null;
  state.requestMutate = vi.fn();
  state.cancelMutate = vi.fn();
  state.invalidate = vi.fn();
});

// ════════════════════════════════════════════════════════════════════
// TransferBadge
// ════════════════════════════════════════════════════════════════════
describe('TransferBadge', () => {
  it('mostra o nome do destino', () => {
    renderWithToast(<TransferBadge toName="Gestora Enterprise" />);
    expect(
      screen.getByText(/Em transferência para Gestora Enterprise/i),
    ).toBeInTheDocument();
  });

  it('sem nome → texto genérico', () => {
    renderWithToast(<TransferBadge toName={null} />);
    expect(screen.getByText(/^Em transferência$/i)).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════
// TransferActionButton — visibilidade por-opp (T13)
// ════════════════════════════════════════════════════════════════════
describe('TransferActionButton', () => {
  it('não renderiza nada quando targetsForOpportunity ERRA (FORBIDDEN / flag off)', () => {
    state.targets = { data: undefined as unknown as unknown[], error: { message: 'forbidden' }, isLoading: false };
    renderWithToast(<TransferActionButton opportunityId="opp-1" />);
    expect(
      screen.queryByRole('button', { name: /Transferir responsabilidade/i }),
    ).toBeNull();
  });

  it('não renderiza nada quando targets é vazio', () => {
    state.targets = { data: [], error: null, isLoading: false };
    renderWithToast(<TransferActionButton opportunityId="opp-1" />);
    expect(
      screen.queryByRole('button', { name: /Transferir responsabilidade/i }),
    ).toBeNull();
  });

  it('mostra o botão quando há targets e abre o modal com o Select populado', async () => {
    const user = userEvent.setup();
    state.targets = {
      data: [
        { id: 't-1', fullName: 'Ana Gestora', role: 'GESTOR' },
        { id: 't-2', fullName: 'Bruno Diretor', role: 'DIRETOR_COMERCIAL' },
      ],
      error: null,
      isLoading: false,
    };
    renderWithToast(<TransferActionButton opportunityId="opp-1" />);

    const trigger = screen.getByRole('button', { name: /Transferir responsabilidade/i });
    await user.click(trigger);

    // Modal aberto: título + Select com as duas opções + submit
    const dialog = await screen.findByRole('dialog');
    const select = within(dialog).getByRole('combobox') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain('t-1');
    expect(optionValues).toContain('t-2');
    expect(
      within(dialog).getByRole('button', { name: /Solicitar transferência/i }),
    ).toBeInTheDocument();
  });

  it('submit dispara request com { opportunityId, targetManagerId, reason }', async () => {
    const user = userEvent.setup();
    state.targets = {
      data: [{ id: 't-1', fullName: 'Ana Gestora', role: 'GESTOR' }],
      error: null,
      isLoading: false,
    };
    renderWithToast(<TransferActionButton opportunityId="opp-1" />);

    await user.click(screen.getByRole('button', { name: /Transferir responsabilidade/i }));
    const dialog = await screen.findByRole('dialog');
    const select = within(dialog).getByRole('combobox');
    await user.selectOptions(select, 't-1');
    await user.click(
      within(dialog).getByRole('button', { name: /Solicitar transferência/i }),
    );

    expect(state.requestMutate).toHaveBeenCalledTimes(1);
    expect(state.requestMutate).toHaveBeenCalledWith({
      opportunityId: 'opp-1',
      targetManagerId: 't-1',
      reason: undefined,
    });
  });

  it('submit desabilitado enquanto nenhum destino selecionado', async () => {
    const user = userEvent.setup();
    state.targets = {
      data: [{ id: 't-1', fullName: 'Ana Gestora', role: 'GESTOR' }],
      error: null,
      isLoading: false,
    };
    renderWithToast(<TransferActionButton opportunityId="opp-1" />);
    await user.click(screen.getByRole('button', { name: /Transferir responsabilidade/i }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: /Solicitar transferência/i });
    expect(submit).toBeDisabled();
  });

  it('onSuccess dispara toast success', async () => {
    state.targets = {
      data: [{ id: 't-1', fullName: 'Ana', role: 'GESTOR' }],
      error: null,
      isLoading: false,
    };
    renderWithToast(<TransferActionButton opportunityId="opp-1" />);
    expect(state.requestOpts?.onSuccess).toBeTypeOf('function');

    await act(async () => {
      state.requestOpts!.onSuccess!();
    });

    await waitFor(() => {
      expect(screen.getByText(/Transferência solicitada\./i)).toBeInTheDocument();
    });
    expect(state.invalidate).toHaveBeenCalled();
  });

  it('onError dispara toast com friendlyTrpcError', async () => {
    state.targets = {
      data: [{ id: 't-1', fullName: 'Ana', role: 'GESTOR' }],
      error: null,
      isLoading: false,
    };
    renderWithToast(<TransferActionButton opportunityId="opp-1" />);

    await act(async () => {
      state.requestOpts!.onError!({ message: 'Já existe transferência pendente.' });
    });

    await waitFor(() => {
      expect(screen.getByText(/Já existe transferência pendente\./i)).toBeInTheDocument();
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// CancelTransferButton
// ════════════════════════════════════════════════════════════════════
describe('CancelTransferButton', () => {
  it('confirma no AlertDialog → cancel({ transferId })', async () => {
    const user = userEvent.setup();
    renderWithToast(<CancelTransferButton transferId="tr-9" opportunityId="opp-1" />);

    await user.click(screen.getByRole('button', { name: /Cancelar transferência/i }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Sim, cancelar/i }));

    expect(state.cancelMutate).toHaveBeenCalledTimes(1);
    expect(state.cancelMutate).toHaveBeenCalledWith({ transferId: 'tr-9' });
  });

  it('AlertDialog "Voltar" fecha sem cancelar', async () => {
    const user = userEvent.setup();
    renderWithToast(<CancelTransferButton transferId="tr-9" opportunityId="opp-1" />);
    await user.click(screen.getByRole('button', { name: /Cancelar transferência/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Voltar/i }));
    expect(state.cancelMutate).not.toHaveBeenCalled();
  });

  it('onSuccess dispara toast + invalida queries', async () => {
    renderWithToast(<CancelTransferButton transferId="tr-9" opportunityId="opp-1" />);
    expect(state.cancelOpts?.onSuccess).toBeTypeOf('function');

    await act(async () => {
      state.cancelOpts!.onSuccess!();
    });

    await waitFor(() => {
      expect(screen.getByText(/Transferência cancelada\./i)).toBeInTheDocument();
    });
    expect(state.invalidate).toHaveBeenCalled();
  });

  it('onError dispara toast com friendlyTrpcError', async () => {
    renderWithToast(<CancelTransferButton transferId="tr-9" opportunityId="opp-1" />);

    await act(async () => {
      state.cancelOpts!.onError!({ message: 'Transferência não está mais pendente.' });
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Transferência não está mais pendente\./i),
      ).toBeInTheDocument();
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// TransferHistorySection
// ════════════════════════════════════════════════════════════════════
describe('TransferHistorySection', () => {
  it('escondido quando a query erra (sem permission — não quebra a página)', () => {
    state.history = { data: undefined as unknown as unknown[], error: { message: 'forbidden' }, isLoading: false };
    const { container } = renderWithToast(<TransferHistorySection opportunityId="opp-1" />);
    expect(screen.queryByText(/Histórico de transferências/i)).toBeNull();
    expect(container.querySelector('section')).toBeNull();
  });

  it('escondido quando não há transfers', () => {
    state.history = { data: [], error: null, isLoading: false };
    const { container } = renderWithToast(<TransferHistorySection opportunityId="opp-1" />);
    expect(screen.queryByText(/Histórico de transferências/i)).toBeNull();
    expect(container.querySelector('section')).toBeNull();
  });

  it('renderiza as linhas do histórico com status e nomes', () => {
    state.history = {
      data: [
        {
          id: 'tr-1',
          status: 'APPROVED',
          requestedAt: '2026-07-20T12:00:00.000Z',
          reason: 'conta enterprise',
          decisionReason: null,
          requestedBy: { fullName: 'Fred' },
          targetManager: { fullName: 'Ana Gestora' },
          newOwner: { fullName: 'Carla Vendas' },
        },
        {
          id: 'tr-2',
          status: 'REJECTED',
          requestedAt: '2026-07-19T12:00:00.000Z',
          reason: null,
          decisionReason: 'fora do escopo',
          requestedBy: { fullName: 'Fred' },
          targetManager: { fullName: 'Bruno' },
          newOwner: null,
        },
      ],
      error: null,
      isLoading: false,
    };
    renderWithToast(<TransferHistorySection opportunityId="opp-1" />);

    expect(screen.getByText(/Histórico de transferências/i)).toBeInTheDocument();
    expect(screen.getByText(/Aprovada/i)).toBeInTheDocument();
    expect(screen.getByText(/Recusada/i)).toBeInTheDocument();
    expect(screen.getByText(/novo responsável: Carla Vendas/i)).toBeInTheDocument();
    expect(screen.getByText(/Decisão: fora do escopo/i)).toBeInTheDocument();
  });
});
