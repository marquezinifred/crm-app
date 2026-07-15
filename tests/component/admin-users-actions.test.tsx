import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * P-86 — cobertura da UI /admin/users pós-fix do dropdown Papel e
 * do botão Desativar (bug reproduzido em prod: ações apareciam
 * clicáveis mas nenhum feedback + confirm() nativo em vez do
 * AlertDialog do design system).
 *
 * Padrão P-53 replicado: mocka `@/lib/trpc/client` capturando
 * `onSuccess`/`onError` das mutations, `ToastProvider` real,
 * dispara handlers manualmente + interações reais via userEvent.
 *
 * Cobertura:
 *  1. render sem crash + PageHeader
 *  2. dropdown de papel dispara updateRole com args corretos
 *  3. updateRole onSuccess → toast "Papel atualizado." + invalidate
 *  4. updateRole onError → toast com friendlyTrpcError
 *  5. botão "Desativar" abre AlertDialog (não confirm() nativo)
 *  6. confirmar no AlertDialog dispara deactivate com id correto
 *  7. cancelar no AlertDialog NÃO dispara deactivate
 *  8. deactivate onSuccess → toast "Usuário desativado." + invalidate
 *  9. deactivate onError → toast com friendlyTrpcError
 * 10. não mostra botão "Desativar" pra si mesmo
 */

type MutationOpts = {
  onSuccess?: (data?: unknown) => void;
  onError?: (err: { message: string; data?: unknown }) => void;
};

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  role:
    | 'ADMIN'
    | 'DIRETOR_COMERCIAL'
    | 'DIRETOR_OPERACOES'
    | 'DIRETOR_FINANCEIRO'
    | 'GESTOR'
    | 'ANALISTA'
    | 'PARCEIRO';
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

const state: {
  me: { id: string; fullName: string; role: string; email: string; tenantId: string } | null;
  users: UserRow[];
  currentTenant: { name: string; impersonating: boolean } | null;
} = {
  me: null,
  users: [],
  currentTenant: null,
};

const captured: {
  invite: MutationOpts | null;
  updateRole: MutationOpts | null;
  deactivate: MutationOpts | null;
  mutate: {
    invite: ReturnType<typeof vi.fn>;
    updateRole: ReturnType<typeof vi.fn>;
    deactivate: ReturnType<typeof vi.fn>;
  };
  invalidates: {
    list: ReturnType<typeof vi.fn>;
  };
} = {
  invite: null,
  updateRole: null,
  deactivate: null,
  mutate: {
    invite: vi.fn(),
    updateRole: vi.fn(),
    deactivate: vi.fn(),
  },
  invalidates: {
    list: vi.fn(),
  },
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/users',
}));

vi.mock('@/lib/trpc/client', () => {
  const queryReturn = <T,>(data: T) => ({
    data,
    isLoading: false,
    isFetching: false,
    error: null,
  });
  return {
    trpc: {
      useUtils: () => ({
        users: {
          list: { invalidate: captured.invalidates.list },
        },
      }),
      users: {
        me: {
          useQuery: () => queryReturn(state.me),
        },
        list: {
          useQuery: () => queryReturn(state.users),
        },
        invite: {
          useMutation: (opts: MutationOpts) => {
            captured.invite = opts;
            return {
              mutate: captured.mutate.invite,
              isPending: false,
              error: null,
            };
          },
        },
        updateRole: {
          useMutation: (opts: MutationOpts) => {
            captured.updateRole = opts;
            return {
              mutate: captured.mutate.updateRole,
              isPending: false,
              error: null,
            };
          },
        },
        deactivate: {
          useMutation: (opts: MutationOpts) => {
            captured.deactivate = opts;
            return {
              mutate: captured.mutate.deactivate,
              isPending: false,
              error: null,
            };
          },
        },
      },
      tenants: {
        current: {
          useQuery: () => queryReturn(state.currentTenant),
        },
      },
    },
  };
});

import AdminUsersPage from '@/app/admin/users/page';
import { ToastProvider } from '@/components/ui/toast';

function renderPage() {
  return render(
    <ToastProvider>
      <AdminUsersPage />
    </ToastProvider>,
  );
}

const now = new Date('2026-07-15T12:00:00Z');

beforeEach(() => {
  state.me = {
    id: 'me-1',
    fullName: 'Fred Admin',
    role: 'ADMIN',
    email: 'fred@venzo.com',
    tenantId: 't-1',
  };
  state.users = [
    {
      id: 'me-1',
      email: 'fred@venzo.com',
      fullName: 'Fred Admin',
      role: 'ADMIN',
      active: true,
      lastLoginAt: now,
      createdAt: now,
    },
    {
      id: 'usr-2',
      email: 'joao@venzo.com',
      fullName: 'João Silva',
      role: 'ANALISTA',
      active: true,
      lastLoginAt: now,
      createdAt: now,
    },
  ];
  state.currentTenant = { name: 'Marquezini', impersonating: false };
  captured.invite = null;
  captured.updateRole = null;
  captured.deactivate = null;
  captured.mutate.invite = vi.fn();
  captured.mutate.updateRole = vi.fn();
  captured.mutate.deactivate = vi.fn();
  captured.invalidates.list = vi.fn();
});

describe('/admin/users (P-86 wiring)', () => {
  it('render sem crash + PageHeader', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: /Usuários/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Gerencie acesso, papéis e status/i),
    ).toBeInTheDocument();
  });

  it('mudança no dropdown Papel dispara updateRole com args corretos', async () => {
    const user = userEvent.setup();
    renderPage();

    // Dropdown do João (não-eu)
    const joaoRoleSelect = screen.getByLabelText(
      /Papel de João Silva/i,
    ) as HTMLSelectElement;
    expect(joaoRoleSelect.value).toBe('ANALISTA');

    await user.selectOptions(joaoRoleSelect, 'GESTOR');

    expect(captured.mutate.updateRole).toHaveBeenCalledTimes(1);
    expect(captured.mutate.updateRole).toHaveBeenCalledWith({
      id: 'usr-2',
      role: 'GESTOR',
    });
  });

  it('updateRole onSuccess dispara toast success + invalida list', async () => {
    renderPage();
    expect(captured.updateRole?.onSuccess).toBeTypeOf('function');

    await act(async () => {
      captured.updateRole!.onSuccess!();
    });

    await waitFor(() => {
      expect(screen.getByText(/Papel atualizado\./i)).toBeInTheDocument();
    });
    expect(captured.invalidates.list).toHaveBeenCalled();
  });

  it('updateRole onError renderiza toast com friendlyTrpcError', async () => {
    renderPage();
    expect(captured.updateRole?.onError).toBeTypeOf('function');

    await act(async () => {
      captured.updateRole!.onError!({
        message: 'Não é possível alterar a própria role.',
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Não é possível alterar a própria role/i),
      ).toBeInTheDocument();
    });
  });

  it('click no botão "Desativar" abre AlertDialog do design system', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      screen.getByRole('button', { name: /Desativar João Silva/i }),
    );

    // AlertDialog (Modal) do design system — role="dialog" com título
    // "Desativar usuário?".
    const dialog = screen.getByRole('dialog', {
      name: /Desativar usuário\?/i,
    });
    expect(dialog).toBeInTheDocument();
    // Descrição menciona o nome do target
    expect(
      within(dialog).getByText(/João Silva perde acesso/i),
    ).toBeInTheDocument();
    // Botões Confirmar + Cancelar presentes
    expect(
      within(dialog).getByRole('button', { name: /^Desativar$/i }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: /Cancelar/i }),
    ).toBeInTheDocument();
    // deactivate NÃO foi chamado ainda — só abriu o dialog
    expect(captured.mutate.deactivate).not.toHaveBeenCalled();
  });

  it('confirmar no AlertDialog dispara deactivate com id correto', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      screen.getByRole('button', { name: /Desativar João Silva/i }),
    );

    const dialog = screen.getByRole('dialog', {
      name: /Desativar usuário\?/i,
    });
    await user.click(
      within(dialog).getByRole('button', { name: /^Desativar$/i }),
    );

    expect(captured.mutate.deactivate).toHaveBeenCalledTimes(1);
    expect(captured.mutate.deactivate).toHaveBeenCalledWith({ id: 'usr-2' });
  });

  it('cancelar no AlertDialog NÃO dispara deactivate', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      screen.getByRole('button', { name: /Desativar João Silva/i }),
    );

    const dialog = screen.getByRole('dialog', {
      name: /Desativar usuário\?/i,
    });
    await user.click(
      within(dialog).getByRole('button', { name: /Cancelar/i }),
    );

    expect(captured.mutate.deactivate).not.toHaveBeenCalled();
    // Dialog fechou
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /Desativar usuário\?/i }),
      ).not.toBeInTheDocument();
    });
  });

  it('deactivate onSuccess dispara toast + invalida list', async () => {
    renderPage();
    expect(captured.deactivate?.onSuccess).toBeTypeOf('function');

    await act(async () => {
      captured.deactivate!.onSuccess!();
    });

    await waitFor(() => {
      expect(screen.getByText(/Usuário desativado\./i)).toBeInTheDocument();
    });
    expect(captured.invalidates.list).toHaveBeenCalled();
  });

  it('deactivate onError renderiza toast com friendlyTrpcError', async () => {
    renderPage();
    expect(captured.deactivate?.onError).toBeTypeOf('function');

    await act(async () => {
      captured.deactivate!.onError!({
        message: 'Não é possível desativar a si mesmo.',
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Não é possível desativar a si mesmo/i),
      ).toBeInTheDocument();
    });
  });

  it('não mostra botão "Desativar" para o próprio usuário logado', () => {
    renderPage();
    // João aparece com botão
    expect(
      screen.getByRole('button', { name: /Desativar João Silva/i }),
    ).toBeInTheDocument();
    // Fred (me) NÃO aparece
    expect(
      screen.queryByRole('button', { name: /Desativar Fred Admin/i }),
    ).not.toBeInTheDocument();
  });
});
