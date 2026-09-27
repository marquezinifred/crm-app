import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Sprint 15H Bloco A (chip 2a) — /admin/approvals-orphaned (P-77).
 *
 * Cobre (Testing Library, padrão P-53 / opportunity-transfer.test.tsx):
 *  - empty state Venzo "Sem approvals órfãs. Fila limpa."
 *  - render de linha com badge de motivo + contexto
 *  - fluxo reassign: expandir → Select candidato → AlertDialog → mutate com
 *    args certos + toast success
 */

type MutationOpts = {
  onSuccess?: (data?: unknown) => void;
  onError?: (err: { message: string; data?: unknown }) => void;
};

const state = vi.hoisted(() => ({
  list: { data: [] as unknown[], error: null as unknown, isLoading: false, refetch: vi.fn() },
  candidates: { data: [] as unknown[], error: null as unknown, isLoading: false },
  reassignOpts: null as MutationOpts | null,
  reassignMutate: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      approvalsReconcile: { listOrphaned: { invalidate: state.invalidate } },
    }),
    approvalsReconcile: {
      listOrphaned: { useQuery: () => state.list },
      candidatesForReassign: { useQuery: () => state.candidates },
      reassign: {
        useMutation: (opts: MutationOpts) => {
          state.reassignOpts = opts;
          return { mutate: state.reassignMutate, isPending: false };
        },
      },
    },
  },
}));

import ApprovalsOrphanedPage from '@/app/admin/approvals-orphaned/page';
import { ToastProvider } from '@/components/ui/toast';

function renderPage() {
  return render(
    <ToastProvider>
      <ApprovalsOrphanedPage />
    </ToastProvider>,
  );
}

const APPROVAL_ID = 'a1111111-1111-1111-1111-111111111111';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: APPROVAL_ID,
    status: 'ORPHANED',
    approverId: 'old-approver',
    orphanedAt: new Date('2026-09-01T12:00:00Z'),
    orphanedReason: 'approver_role_no_longer_matches_rule',
    applicableRuleId: 'rule-1',
    approver: { id: 'old-approver', fullName: 'Ex Diretor', role: 'DIRETOR_FINANCEIRO', active: true },
    applicableRule: { id: 'rule-1', name: 'Margem baixa', enabled: true, deletedAt: null },
    proposalVersion: {
      version: 2,
      totalValue: 120000,
      marginPct: 8,
      proposal: {
        id: 'prop-1',
        title: 'Proposta ACME',
        opportunity: {
          id: 'opp-1',
          title: 'Projeto ACME',
          clientCompany: { razaoSocial: 'ACME Ltda' },
        },
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  state.list = { data: [], error: null, isLoading: false, refetch: vi.fn() };
  state.candidates = { data: [], error: null, isLoading: false };
  state.reassignOpts = null;
  state.reassignMutate = vi.fn();
  state.invalidate = vi.fn();
});

describe('ApprovalsOrphanedPage', () => {
  it('empty state Venzo quando não há órfãs', () => {
    renderPage();
    expect(screen.getByText(/Sem approvals órfãs\. Fila limpa\./i)).toBeInTheDocument();
  });

  it('renderiza linha com motivo legível e contexto', () => {
    state.list.data = [row()];
    renderPage();
    expect(screen.getByText(/Perfil não corresponde mais/i)).toBeInTheDocument();
    expect(screen.getByText('Projeto ACME')).toBeInTheDocument();
    expect(screen.getByText(/ACME Ltda/)).toBeInTheDocument();
  });

  it('reassign: expandir → escolher candidato → confirmar dispara mutate + toast', async () => {
    const user = userEvent.setup();
    state.list.data = [row()];
    state.candidates.data = [
      { id: 'new-approver', fullName: 'Novo Diretor', role: 'DIRETOR_FINANCEIRO' },
    ];
    renderPage();

    // expandir a linha
    await user.click(screen.getByRole('button', { expanded: false }));

    // escolher candidato no Select
    const select = await screen.findByLabelText(/Novo aprovador/i);
    await user.selectOptions(select, 'new-approver');

    // clicar Reatribuir → abre AlertDialog
    await user.click(screen.getByRole('button', { name: /^Reatribuir$/i }));

    // confirmar no dialog (botão confirmLabel "Reatribuir" dentro do modal)
    const confirmButtons = screen.getAllByRole('button', { name: /Reatribuir/i });
    await user.click(confirmButtons[confirmButtons.length - 1]!);

    expect(state.reassignMutate).toHaveBeenCalledWith({
      approvalId: APPROVAL_ID,
      newApproverId: 'new-approver',
    });

    // dispara toast success via onSuccess
    act(() => state.reassignOpts?.onSuccess?.());
    await waitFor(() =>
      expect(screen.getByText(/Aprovação reatribuída\./i)).toBeInTheDocument(),
    );
  });

  it('rule sem candidatos válidos mostra aviso e esconde o Select', async () => {
    const user = userEvent.setup();
    state.list.data = [row()];
    state.candidates.data = [];
    renderPage();

    await user.click(screen.getByRole('button', { expanded: false }));
    expect(
      screen.getByText(/Nenhum aprovador válido para esta regra/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Novo aprovador/i)).not.toBeInTheDocument();
  });
});
