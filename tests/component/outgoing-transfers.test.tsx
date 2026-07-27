import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Sprint 15G.5 Fase 3c — /pipeline/transferencias-em-andamento.
 *
 * Acompanhamento do disparador. Cobre:
 *  1. render da lista com `myOutgoing` mockado (título, destino, valor, badge)
 *  2. botão "Cancelar" só nas linhas PENDING
 *  3. clicar em "Cancelar" abre AlertDialog (role=dialog), NÃO dispara cancel
 *  4. confirmar dispara `cancel.mutate({ transferId })`
 *  5. cancelar o dialog NÃO dispara cancel e fecha
 *  6. cancel onSuccess → toast + invalida myOutgoing + fecha dialog
 *  7. cancel onError → toast com friendlyTrpcError + fecha dialog
 *  8. filtro por status filtra a lista (client-side)
 *  9. empty state quando myOutgoing vazio
 * 10. ErrorState quando a query falha (degrade do kill-switch OFF)
 *
 * Padrão de mock: approval-rules-remove.test.tsx (P-96) + admin-query-error (P-92b).
 */

type MutationOpts = {
  onSuccess?: (data?: unknown) => void;
  onError?: (err: { message: string; data?: unknown }) => void;
};

interface TransferFixture {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'TIMED_OUT';
  reason: string | null;
  decisionReason: string | null;
  requestedAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  opportunity: {
    id: string;
    title: string;
    estimatedValue: number | null;
    clientCompany: { id: string; razaoSocial: string } | null;
  };
  targetManager: { id: string; fullName: string | null; email: string };
  originalOwner: { id: string; fullName: string | null; email: string };
  newOwner: { id: string; fullName: string | null; email: string } | null;
}

const state: {
  data: TransferFixture[] | undefined;
  error: { message: string; data?: unknown } | null;
} = { data: [], error: null };

const captured: {
  cancel: MutationOpts | null;
  mutate: ReturnType<typeof vi.fn>;
  invalidate: ReturnType<typeof vi.fn>;
  refetch: ReturnType<typeof vi.fn>;
} = {
  cancel: null,
  mutate: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
};

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      opportunityTransfers: { myOutgoing: { invalidate: captured.invalidate } },
    }),
    opportunityTransfers: {
      myOutgoing: {
        useQuery: () => ({
          data: state.error ? undefined : state.data,
          error: state.error,
          isError: !!state.error,
          // Semântica react-query: sem data e sem erro = carregando.
          isLoading: !state.data && !state.error,
          isFetching: false,
          refetch: captured.refetch,
        }),
      },
      cancel: {
        useMutation: (opts: MutationOpts) => {
          captured.cancel = opts;
          return { mutate: captured.mutate, isPending: false, error: null };
        },
      },
    },
  },
}));

import OutgoingTransfersPage from '@/app/pipeline/transferencias-em-andamento/page';
import { ToastProvider } from '@/components/ui/toast';

function renderPage() {
  return render(
    <ToastProvider>
      <OutgoingTransfersPage />
    </ToastProvider>,
  );
}

function makeRow(over: Partial<TransferFixture> = {}): TransferFixture {
  return {
    id: 'tr-1',
    status: 'PENDING',
    reason: null,
    decisionReason: null,
    requestedAt: new Date('2026-07-20T10:00:00Z'),
    expiresAt: new Date('2026-08-20T10:00:00Z'),
    decidedAt: null,
    opportunity: {
      id: 'opp-1',
      title: 'ACME — expansão',
      estimatedValue: 120000,
      clientCompany: { id: 'co-1', razaoSocial: 'ACME LTDA' },
    },
    targetManager: { id: 'tm-1', fullName: 'Beatriz Gestora', email: 'bia@x.com' },
    originalOwner: { id: 'oo-1', fullName: 'Carlos Vendedor', email: 'carlos@x.com' },
    newOwner: null,
    ...over,
  };
}

beforeEach(() => {
  state.data = [makeRow()];
  state.error = null;
  captured.cancel = null;
  captured.mutate = vi.fn();
  captured.invalidate = vi.fn();
  captured.refetch = vi.fn();
});

describe('/pipeline/transferencias-em-andamento (Fase 3c)', () => {
  it('renderiza PageHeader + filtro + card com dados da transferência', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: /Transferências em andamento/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Filtrar por status/i)).toBeInTheDocument();

    expect(screen.getByText('ACME — expansão')).toBeInTheDocument();
    expect(screen.getByText('ACME LTDA')).toBeInTheDocument();
    // Destino (target manager)
    expect(screen.getByText('Beatriz Gestora')).toBeInTheDocument();
    // Valor formatado em BRL
    expect(screen.getByText(/R\$\s*120\.000/)).toBeInTheDocument();
    // Badge de status — escopado à lista pra não colidir com a <option>
    // homônima do dropdown de filtro.
    expect(within(screen.getByRole('list')).getByText('Pendente')).toBeInTheDocument();
  });

  it('mostra botão "Cancelar" apenas nas linhas PENDING', () => {
    state.data = [
      makeRow({ id: 'p-1', status: 'PENDING', opportunity: makeRow().opportunity }),
      makeRow({
        id: 'a-1',
        status: 'APPROVED',
        decidedAt: new Date('2026-07-22T10:00:00Z'),
        newOwner: { id: 'no-1', fullName: 'Novo Dono', email: 'novo@x.com' },
        opportunity: {
          id: 'opp-2',
          title: 'BETA — renovação',
          estimatedValue: 5000,
          clientCompany: { id: 'co-2', razaoSocial: 'BETA SA' },
        },
      }),
    ];
    renderPage();

    // 2 cards, mas só 1 botão "Cancelar" (o da PENDING)
    const cancelButtons = screen.getAllByRole('button', { name: /^Cancelar$/i });
    expect(cancelButtons).toHaveLength(1);
    // A APPROVED mostra o novo responsável + badge (escopado à lista pra
    // não colidir com a <option> "Aprovada" do filtro).
    const list = screen.getByRole('list');
    expect(within(list).getByText('Novo Dono')).toBeInTheDocument();
    expect(within(list).getByText('Aprovada')).toBeInTheDocument();
  });

  it('clicar em "Cancelar" abre AlertDialog e NÃO dispara cancel', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /^Cancelar$/i }));

    const dialog = screen.getByRole('dialog', { name: /Cancelar transferência\?/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/ACME — expansão/i)).toBeInTheDocument();
    expect(captured.mutate).not.toHaveBeenCalled();
  });

  it('confirmar dispara cancel.mutate com o transferId correto', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /^Cancelar$/i }));
    const dialog = screen.getByRole('dialog', { name: /Cancelar transferência\?/i });
    await user.click(
      within(dialog).getByRole('button', { name: /Cancelar transferência/i }),
    );

    expect(captured.mutate).toHaveBeenCalledTimes(1);
    expect(captured.mutate).toHaveBeenCalledWith({ transferId: 'tr-1' });
  });

  it('fechar o dialog (Voltar) NÃO dispara cancel', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /^Cancelar$/i }));
    const dialog = screen.getByRole('dialog', { name: /Cancelar transferência\?/i });
    await user.click(within(dialog).getByRole('button', { name: /Voltar/i }));

    expect(captured.mutate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /Cancelar transferência\?/i }),
      ).not.toBeInTheDocument();
    });
  });

  it('cancel onSuccess dispara toast + invalida myOutgoing + fecha dialog', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Cancelar$/i }));
    expect(captured.cancel?.onSuccess).toBeTypeOf('function');

    await act(async () => {
      captured.cancel!.onSuccess!();
    });

    await waitFor(() => {
      expect(screen.getByText(/Transferência cancelada\./i)).toBeInTheDocument();
    });
    expect(captured.invalidate).toHaveBeenCalled();
    expect(
      screen.queryByRole('dialog', { name: /Cancelar transferência\?/i }),
    ).not.toBeInTheDocument();
  });

  it('cancel onError dispara toast com friendlyTrpcError + fecha dialog', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Cancelar$/i }));
    expect(captured.cancel?.onError).toBeTypeOf('function');

    await act(async () => {
      captured.cancel!.onError!({ message: 'Transferência não está mais pendente.' });
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Transferência não está mais pendente/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('dialog', { name: /Cancelar transferência\?/i }),
    ).not.toBeInTheDocument();
  });

  it('filtro por status filtra a lista (client-side)', async () => {
    const user = userEvent.setup();
    state.data = [
      makeRow({ id: 'p-1', status: 'PENDING' }),
      makeRow({
        id: 'r-1',
        status: 'REJECTED',
        decidedAt: new Date('2026-07-22T10:00:00Z'),
        opportunity: {
          id: 'opp-3',
          title: 'GAMA — piloto',
          estimatedValue: 9000,
          clientCompany: null,
        },
      }),
    ];
    renderPage();

    // ALL: os dois títulos aparecem
    expect(screen.getByText('ACME — expansão')).toBeInTheDocument();
    expect(screen.getByText('GAMA — piloto')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Filtrar por status/i), 'REJECTED');

    expect(screen.queryByText('ACME — expansão')).not.toBeInTheDocument();
    expect(screen.getByText('GAMA — piloto')).toBeInTheDocument();
  });

  it('mostra empty state quando o disparador não iniciou transferências', () => {
    state.data = [];
    renderPage();

    expect(
      screen.getByText(/Você não iniciou transferências\./i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Cancelar$/i }),
    ).not.toBeInTheDocument();
  });

  it('query em erro (kill-switch OFF → FORBIDDEN) mostra ErrorState amigável', () => {
    state.data = undefined;
    state.error = { message: 'Recurso indisponível.' };
    renderPage();

    expect(
      screen.getByText(/Não foi possível carregar as transferências\./i),
    ).toBeInTheDocument();
    expect(screen.getByText('Recurso indisponível.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Tentar novamente/i }),
    ).toBeInTheDocument();
    // PageHeader preservado como contexto.
    expect(
      screen.getByRole('heading', { name: 'Transferências em andamento' }),
    ).toBeInTheDocument();
  });
});
