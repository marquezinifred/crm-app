import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Sprint 15G.5 Fase 3b — /inbox/transferencias-recebidas.
 *
 * Fila do gestor destinatário. Cobre:
 *  - render da lista com dados de `pendingForMe` (opp/disparador/dono/motivo)
 *  - empty state quando a fila está vazia
 *  - ErrorState quando a query falha (kill-switch OFF / FORBIDDEN)
 *  - Aceitar abre sub-modal, popula Select via `newOwnerCandidates`, e
 *    dispara `approve` com o `newOwnerId` escolhido
 *  - Rejeitar abre modal e dispara `reject`
 *  - toast em success/error das mutations
 *
 * Padrão de mock replicado de `pipeline-new.test.tsx` (P-53).
 */

type MutationOpts = {
  onSuccess?: (data?: unknown) => void;
  onError?: (err: { message: string; data?: unknown }) => void;
};

const SAMPLE = {
  id: 'tr-1',
  opportunityId: 'opp-1',
  requestedById: 'u-req',
  originalOwnerId: 'u-own',
  targetManagerId: 'me',
  newOwnerId: null,
  targetUnitId: null,
  status: 'PENDING',
  reason: 'Cliente migrou pra região da equipe do Sul.',
  decisionReason: null,
  decidedById: null,
  requestedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 48 * 3_600_000).toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  opportunity: {
    id: 'opp-1',
    title: 'Renovação ACME',
    estimatedValue: '120000',
    clientCompany: { id: 'co-1', razaoSocial: 'ACME LTDA' },
  },
  requestedBy: { id: 'u-req', fullName: 'Ana Diretora', email: 'ana@x.com' },
  originalOwner: { id: 'u-own', fullName: 'Bruno Vendedor', email: 'bruno@x.com' },
};

const CANDIDATES = [
  { id: 'u-a', fullName: 'Carla Silva', role: 'ANALISTA' },
  { id: 'u-b', fullName: 'Diego Souza', role: 'GESTOR' },
];

let pendingData: unknown = undefined;
let pendingError: { message: string } | null = null;
let pendingLoading = false;
let candidatesData: unknown = CANDIDATES;

const invalidatePending = vi.fn();
const refetchPending = vi.fn();

const captured: {
  approve: MutationOpts | null;
  reject: MutationOpts | null;
  approveMutate: ReturnType<typeof vi.fn>;
  rejectMutate: ReturnType<typeof vi.fn>;
} = {
  approve: null,
  reject: null,
  approveMutate: vi.fn(),
  rejectMutate: vi.fn(),
};

vi.mock('@/lib/trpc/client', () => {
  return {
    trpc: {
      useUtils: () => ({
        opportunityTransfers: {
          pendingForMe: { invalidate: invalidatePending },
        },
      }),
      opportunityTransfers: {
        pendingForMe: {
          useQuery: () => ({
            data: pendingData,
            isLoading: pendingLoading,
            error: pendingError,
            refetch: refetchPending,
          }),
        },
        newOwnerCandidates: {
          useQuery: () => ({
            data: candidatesData,
            isLoading: false,
            error: null,
          }),
        },
        approve: {
          useMutation: (opts: MutationOpts) => {
            captured.approve = opts;
            return { mutate: captured.approveMutate, isPending: false };
          },
        },
        reject: {
          useMutation: (opts: MutationOpts) => {
            captured.reject = opts;
            return { mutate: captured.rejectMutate, isPending: false };
          },
        },
      },
    },
  };
});

import Page from '@/app/inbox/transferencias-recebidas/page';
import { ToastProvider } from '@/components/ui/toast';

function renderPage() {
  return render(
    <ToastProvider>
      <Page />
    </ToastProvider>,
  );
}

beforeEach(() => {
  pendingData = undefined;
  pendingError = null;
  pendingLoading = false;
  candidatesData = CANDIDATES;
  invalidatePending.mockClear();
  refetchPending.mockClear();
  captured.approve = null;
  captured.reject = null;
  captured.approveMutate = vi.fn();
  captured.rejectMutate = vi.fn();
});

describe('/inbox/transferencias-recebidas (Sprint 15G.5 3b)', () => {
  it('renderiza a lista com opp, disparador, dono original e motivo', () => {
    pendingData = [SAMPLE];
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: /Transferências recebidas \(1\)/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Renovação ACME/i })).toBeInTheDocument();
    expect(screen.getByText(/ACME LTDA/)).toBeInTheDocument();
    expect(screen.getByText(/Ana Diretora/)).toBeInTheDocument();
    expect(screen.getByText(/Bruno Vendedor/)).toBeInTheDocument();
    expect(screen.getByText(/Cliente migrou pra região/)).toBeInTheDocument();
    // Prazo restante com destaque (48h → "Expira em 2d")
    expect(screen.getByText(/Expira em 2d/)).toBeInTheDocument();
  });

  it('mostra empty state Venzo quando a fila está vazia', () => {
    pendingData = [];
    renderPage();

    expect(screen.getByText(/Sem transferências aguardando você\./i)).toBeInTheDocument();
    expect(screen.getByText(/Fila limpa\./i)).toBeInTheDocument();
    // Sem "(N)" no título quando vazio
    expect(
      screen.getByRole('heading', { level: 1, name: /^Transferências recebidas$/i }),
    ).toBeInTheDocument();
  });

  it('mostra ErrorState quando a query falha (kill-switch OFF / FORBIDDEN)', () => {
    pendingError = { message: 'Recurso indisponível.' };
    renderPage();

    expect(screen.getByText(/Não foi possível carregar as transferências\./i)).toBeInTheDocument();
    expect(screen.getByText(/Recurso indisponível\./i)).toBeInTheDocument();
    // Não renderiza cards
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('Aceitar abre sub-modal, popula Select com candidatos e dispara approve com o newOwnerId', async () => {
    pendingData = [SAMPLE];
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /^Aceitar$/i }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Escolha quem da sua equipe assume/i)).toBeInTheDocument();

    const select = within(dialog).getByRole('combobox') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['', 'u-a', 'u-b']);

    // Botão de submit desabilitado enquanto nenhum owner escolhido
    const submit = within(dialog).getByRole('button', { name: /Aceitar transferência/i });
    expect(submit).toBeDisabled();

    await user.selectOptions(select, 'u-b');
    expect(submit).not.toBeDisabled();

    await user.click(submit);

    expect(captured.approveMutate).toHaveBeenCalledTimes(1);
    expect(captured.approveMutate).toHaveBeenCalledWith({
      transferId: 'tr-1',
      newOwnerId: 'u-b',
      decisionReason: undefined,
    });
  });

  it('Rejeitar abre modal e dispara reject com o transferId', async () => {
    pendingData = [SAMPLE];
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /^Rejeitar$/i }));

    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: /Rejeitar transferência/i });
    await user.click(submit);

    expect(captured.rejectMutate).toHaveBeenCalledTimes(1);
    expect(captured.rejectMutate).toHaveBeenCalledWith({
      transferId: 'tr-1',
      decisionReason: undefined,
    });
  });

  it('approve.onSuccess dispara toast de sucesso e invalida a fila', async () => {
    pendingData = [SAMPLE];
    renderPage();
    expect(captured.approve?.onSuccess).toBeTypeOf('function');

    await act(async () => {
      captured.approve!.onSuccess!();
    });

    await waitFor(() => {
      expect(screen.getByText(/Transferência aceita\./i)).toBeInTheDocument();
    });
    expect(invalidatePending).toHaveBeenCalledTimes(1);
  });

  it('approve.onError dispara toast de erro com friendlyTrpcError', async () => {
    pendingData = [SAMPLE];
    renderPage();

    await act(async () => {
      captured.approve!.onError!({ message: 'Recurso indisponível.' });
    });

    await waitFor(() => {
      expect(screen.getByText(/Não foi possível aceitar\./i)).toBeInTheDocument();
      expect(screen.getByText(/Recurso indisponível\./i)).toBeInTheDocument();
    });
  });

  it('reject.onSuccess dispara toast de sucesso e invalida a fila', async () => {
    pendingData = [SAMPLE];
    renderPage();

    await act(async () => {
      captured.reject!.onSuccess!();
    });

    await waitFor(() => {
      expect(screen.getByText(/Transferência recusada\./i)).toBeInTheDocument();
    });
    expect(invalidatePending).toHaveBeenCalledTimes(1);
  });
});
