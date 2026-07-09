import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Sprint 15G Fase 4a — cobertura da UI /admin/commercial-structure.
 *
 * Padrão P-53 replicado: mocka `@/lib/trpc/client` capturando
 * `onSuccess`/`onError` das mutations, `ToastProvider` real, dispara
 * handlers manualmente e verifica DOM via role/text.
 *
 * Cobertura:
 *  1. render sem crash + PageHeader
 *  2. tabs presentes
 *  3. listUnitTypes vazio → EmptyState
 *  4. listUnitTypes com dados → tabela populada
 *  5. Botão "+ Novo nível" abre modal
 *  6. Submit modal happy → createUnitType chamada com args corretos
 *  7. Click "Editar" abre modal em edit mode
 *  8. deleteUnitType — AlertDialog + confirm → mutation
 *  9. deleteUnitType onError → toast via friendlyTrpcError
 * 10. Ir pra tab Organograma; getTree vazio → EmptyState
 * 11. getTree flat com pai/filho → árvore hierárquica renderiza
 * 12. Click num nó → Sheet detalhe abre com membros
 * 13. addMember happy path
 */

type MutationOpts = {
  onSuccess?: (data?: unknown) => void;
  onError?: (err: { message: string; data?: unknown }) => void;
};

interface UnitType {
  id: string;
  name: string;
  level: number;
  color: string | null;
  icon: string | null;
}

interface TreeNode {
  id: string;
  tenantId: string;
  typeId: string;
  name: string;
  path: string;
  depth: number;
  parentId: string | null;
  typeName: string;
  typeLevel: number;
  typeColor: string | null;
  typeIcon: string | null;
  memberCount: number;
  active: boolean;
}

const state: {
  unitTypes: UnitType[];
  tree: TreeNode[];
  users: Array<{ id: string; fullName: string; email: string; role: string; active: boolean }>;
  unitDetail: {
    unit: {
      id: string;
      name: string;
      type: { name: string; level: number; color: string | null };
      members: Array<{
        user: { id: string; fullName: string; email: string };
        role: 'MANAGER' | 'MEMBER';
        isPrimary: boolean;
      }>;
    };
    ancestors: Array<{ id: string; name: string }>;
    children: unknown[];
  } | null;
} = {
  unitTypes: [],
  tree: [],
  users: [],
  unitDetail: null,
};

const captured: {
  createUnitType: MutationOpts | null;
  updateUnitType: MutationOpts | null;
  deleteUnitType: MutationOpts | null;
  createUnit: MutationOpts | null;
  deactivateUnit: MutationOpts | null;
  addMember: MutationOpts | null;
  removeMember: MutationOpts | null;
  mutate: {
    createUnitType: ReturnType<typeof vi.fn>;
    updateUnitType: ReturnType<typeof vi.fn>;
    deleteUnitType: ReturnType<typeof vi.fn>;
    createUnit: ReturnType<typeof vi.fn>;
    deactivateUnit: ReturnType<typeof vi.fn>;
    addMember: ReturnType<typeof vi.fn>;
    removeMember: ReturnType<typeof vi.fn>;
  };
  invalidates: {
    listUnitTypes: ReturnType<typeof vi.fn>;
    getTree: ReturnType<typeof vi.fn>;
    getUnit: ReturnType<typeof vi.fn>;
  };
} = {
  createUnitType: null,
  updateUnitType: null,
  deleteUnitType: null,
  createUnit: null,
  deactivateUnit: null,
  addMember: null,
  removeMember: null,
  mutate: {
    createUnitType: vi.fn(),
    updateUnitType: vi.fn(),
    deleteUnitType: vi.fn(),
    createUnit: vi.fn(),
    deactivateUnit: vi.fn(),
    addMember: vi.fn(),
    removeMember: vi.fn(),
  },
  invalidates: {
    listUnitTypes: vi.fn(),
    getTree: vi.fn(),
    getUnit: vi.fn(),
  },
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/commercial-structure',
}));

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
        salesStructure: {
          listUnitTypes: { invalidate: captured.invalidates.listUnitTypes },
          getTree: { invalidate: captured.invalidates.getTree },
          getUnit: { invalidate: captured.invalidates.getUnit },
        },
      }),
      users: {
        me: {
          useQuery: () => queryReturn({ id: 'me-1', fullName: 'Fred', role: 'ADMIN' }),
        },
        list: {
          useQuery: () => queryReturn(state.users),
        },
      },
      salesStructure: {
        listUnitTypes: {
          useQuery: () => queryReturn(state.unitTypes),
        },
        createUnitType: {
          useMutation: (opts: MutationOpts) => {
            captured.createUnitType = opts;
            return {
              mutate: captured.mutate.createUnitType,
              isPending: false,
              error: null,
            };
          },
        },
        updateUnitType: {
          useMutation: (opts: MutationOpts) => {
            captured.updateUnitType = opts;
            return {
              mutate: captured.mutate.updateUnitType,
              isPending: false,
              error: null,
            };
          },
        },
        deleteUnitType: {
          useMutation: (opts: MutationOpts) => {
            captured.deleteUnitType = opts;
            return {
              mutate: captured.mutate.deleteUnitType,
              isPending: false,
              error: null,
            };
          },
        },
        getTree: {
          useQuery: () => queryReturn(state.tree),
        },
        getUnit: {
          useQuery: (input: { id: string }, opts?: { enabled?: boolean }) => {
            if (opts && opts.enabled === false) {
              return queryReturn(undefined);
            }
            return queryReturn(state.unitDetail);
          },
        },
        createUnit: {
          useMutation: (opts: MutationOpts) => {
            captured.createUnit = opts;
            return {
              mutate: captured.mutate.createUnit,
              isPending: false,
              error: null,
            };
          },
        },
        deactivateUnit: {
          useMutation: (opts: MutationOpts) => {
            captured.deactivateUnit = opts;
            return {
              mutate: captured.mutate.deactivateUnit,
              isPending: false,
              error: null,
            };
          },
        },
        addMember: {
          useMutation: (opts: MutationOpts) => {
            captured.addMember = opts;
            return {
              mutate: captured.mutate.addMember,
              isPending: false,
              error: null,
            };
          },
        },
        removeMember: {
          useMutation: (opts: MutationOpts) => {
            captured.removeMember = opts;
            return {
              mutate: captured.mutate.removeMember,
              isPending: false,
              error: null,
            };
          },
        },
      },
    },
  };
});

import CommercialStructurePage from '@/app/admin/commercial-structure/page';
import { ToastProvider } from '@/components/ui/toast';

function renderPage() {
  return render(
    <ToastProvider>
      <CommercialStructurePage />
    </ToastProvider>,
  );
}

beforeEach(() => {
  state.unitTypes = [];
  state.tree = [];
  state.users = [];
  state.unitDetail = null;
  captured.createUnitType = null;
  captured.updateUnitType = null;
  captured.deleteUnitType = null;
  captured.createUnit = null;
  captured.deactivateUnit = null;
  captured.addMember = null;
  captured.removeMember = null;
  captured.mutate.createUnitType = vi.fn();
  captured.mutate.updateUnitType = vi.fn();
  captured.mutate.deleteUnitType = vi.fn();
  captured.mutate.createUnit = vi.fn();
  captured.mutate.deactivateUnit = vi.fn();
  captured.mutate.addMember = vi.fn();
  captured.mutate.removeMember = vi.fn();
  captured.invalidates.listUnitTypes = vi.fn();
  captured.invalidates.getTree = vi.fn();
  captured.invalidates.getUnit = vi.fn();
});

describe('/admin/commercial-structure (Sprint 15G Fase 4a)', () => {
  it('render sem crash + PageHeader com título correto', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: /Estrutura comercial/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Defina níveis hierárquicos/i),
    ).toBeInTheDocument();
  });

  it('mostra ambas as tabs (Níveis + Organograma)', () => {
    renderPage();
    // Radix Tabs renderiza como role="tab"
    expect(screen.getByRole('tab', { name: /Níveis/i })).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: /Organograma/i }),
    ).toBeInTheDocument();
  });

  it('listUnitTypes vazio → EmptyState com CTA para ADMIN', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /Nenhum nível cadastrado/i }),
    ).toBeInTheDocument();
    // ADMIN vê CTA "+ Novo nível" — 2 ocorrências (header + EmptyState)
    const buttons = screen.getAllByRole('button', { name: /Novo nível/i });
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('listUnitTypes populado renderiza tabela com nome, level e cor', () => {
    state.unitTypes = [
      { id: 'ut-1', name: 'Equipe', level: 1, color: '#6366F1', icon: 'users' },
      { id: 'ut-2', name: 'Gerência', level: 2, color: null, icon: null },
    ];
    renderPage();
    expect(screen.getByText('Equipe')).toBeInTheDocument();
    expect(screen.getByText('Gerência')).toBeInTheDocument();
    // Level 1 e Level 2 aparecem em Badges
    expect(screen.getByText(/Nível 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Nível 2/i)).toBeInTheDocument();
    expect(screen.getByText('#6366F1')).toBeInTheDocument();
    expect(screen.getByText('users')).toBeInTheDocument();
  });

  it('botão "+ Novo nível" abre modal com título esperado', async () => {
    const user = userEvent.setup();
    renderPage();
    const btns = screen.getAllByRole('button', { name: /Novo nível/i });
    await user.click(btns[0]!);
    expect(
      screen.getByRole('dialog', { name: /Novo nível hierárquico/i }),
    ).toBeInTheDocument();
  });

  it('submit UnitTypeModal happy path chama createUnitType com args corretos', async () => {
    const user = userEvent.setup();
    renderPage();
    const btns = screen.getAllByRole('button', { name: /Novo nível/i });
    await user.click(btns[0]!);

    const dialog = screen.getByRole('dialog', {
      name: /Novo nível hierárquico/i,
    });
    const nameInput = within(dialog).getByLabelText(/Nome/i);
    await user.type(nameInput, 'Diretoria');

    // Level select — 8 opções (1-8)
    const levelSelect = within(dialog).getByLabelText(
      /Nível hierárquico/i,
    ) as HTMLSelectElement;
    await user.selectOptions(levelSelect, '3');

    const colorInput = within(dialog).getByLabelText(/^Cor/i);
    await user.type(colorInput, '#FF00AA');

    await user.click(
      within(dialog).getByRole('button', { name: /Criar nível/i }),
    );

    expect(captured.mutate.createUnitType).toHaveBeenCalledTimes(1);
    const payload = captured.mutate.createUnitType.mock.calls[0]![0] as {
      name: string;
      level: number;
      color?: string;
    };
    expect(payload.name).toBe('Diretoria');
    expect(payload.level).toBe(3);
    expect(payload.color).toBe('#FF00AA');
  });

  it('click "Editar" abre modal em edit mode com dados preenchidos', async () => {
    const user = userEvent.setup();
    state.unitTypes = [
      { id: 'ut-1', name: 'Equipe', level: 1, color: '#6366F1', icon: 'users' },
    ];
    renderPage();

    await user.click(screen.getByRole('button', { name: /Editar/i }));

    expect(
      screen.getByRole('dialog', { name: /Editar nível/i }),
    ).toBeInTheDocument();

    // Level select some (é imutável em edit)
    expect(
      screen.queryByLabelText(/Nível hierárquico/i),
    ).not.toBeInTheDocument();

    // Nome pré-preenchido
    const nameInput = screen.getByLabelText(/Nome/i) as HTMLInputElement;
    expect(nameInput.value).toBe('Equipe');
  });

  it('excluir nível dispara AlertDialog e confirm chama deleteUnitType', async () => {
    const user = userEvent.setup();
    state.unitTypes = [
      { id: 'ut-1', name: 'Equipe', level: 1, color: null, icon: null },
    ];
    renderPage();

    await user.click(
      screen.getByRole('button', { name: /Excluir Equipe/i }),
    );

    // AlertDialog
    const alertDialog = screen.getByRole('dialog', {
      name: /Excluir este nível\?/i,
    });
    expect(alertDialog).toBeInTheDocument();

    // O botão × da tabela também tem aria-label "Excluir Equipe"; restringe a
    // busca pro dentro do dialog pra pegar só o "Excluir" do AlertDialog footer.
    await user.click(
      within(alertDialog).getByRole('button', { name: /^Excluir$/i }),
    );

    expect(captured.mutate.deleteUnitType).toHaveBeenCalledWith({
      id: 'ut-1',
    });
  });

  it('deleteUnitType onError renderiza toast via friendlyTrpcError', async () => {
    renderPage();
    expect(captured.deleteUnitType?.onError).toBeTypeOf('function');

    await act(async () => {
      captured.deleteUnitType!.onError!({
        message: 'Tipo em uso por unidades ativas.',
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Tipo em uso por unidades ativas/i),
      ).toBeInTheDocument();
    });
  });

  it('tab Organograma com tree vazio mostra EmptyState com CTA', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('tab', { name: /Organograma/i }));

    expect(
      screen.getByRole('heading', { name: /Organograma vazio/i }),
    ).toBeInTheDocument();
    // ADMIN vê botão "+ Nova unidade"
    expect(
      screen.getAllByRole('button', { name: /Nova unidade/i }).length,
    ).toBeGreaterThan(0);
  });

  it('tree flat com pai/filho renderiza árvore hierárquica', async () => {
    const user = userEvent.setup();
    state.tree = [
      {
        id: 'u-root',
        tenantId: 't-1',
        typeId: 'ut-1',
        name: 'Equipe Padrão',
        path: 'root.a1',
        depth: 1,
        parentId: null,
        typeName: 'Equipe',
        typeLevel: 1,
        typeColor: '#6366F1',
        typeIcon: 'users',
        memberCount: 3,
        active: true,
      },
      {
        id: 'u-child',
        tenantId: 't-1',
        typeId: 'ut-2',
        name: 'Sub Equipe SP',
        path: 'root.a1.b2',
        depth: 2,
        parentId: 'u-root',
        typeName: 'Gerência',
        typeLevel: 2,
        typeColor: '#7C3AED',
        typeIcon: null,
        memberCount: 1,
        active: true,
      },
    ];
    renderPage();

    await user.click(screen.getByRole('tab', { name: /Organograma/i }));

    expect(screen.getByRole('tree')).toBeInTheDocument();
    expect(screen.getByText('Equipe Padrão')).toBeInTheDocument();
    expect(screen.getByText('Sub Equipe SP')).toBeInTheDocument();
    expect(screen.getByText(/3 membros/i)).toBeInTheDocument();
    expect(screen.getByText(/1 membro/i)).toBeInTheDocument();
  });

  it('click em nó da árvore abre Sheet com detalhes e membros', async () => {
    const user = userEvent.setup();
    state.tree = [
      {
        id: 'u-root',
        tenantId: 't-1',
        typeId: 'ut-1',
        name: 'Equipe Padrão',
        path: 'root.a1',
        depth: 1,
        parentId: null,
        typeName: 'Equipe',
        typeLevel: 1,
        typeColor: '#6366F1',
        typeIcon: 'users',
        memberCount: 1,
        active: true,
      },
    ];
    state.unitDetail = {
      unit: {
        id: 'u-root',
        name: 'Equipe Padrão',
        type: { name: 'Equipe', level: 1, color: '#6366F1' },
        members: [
          {
            user: { id: 'usr-1', fullName: 'Alice Neves', email: 'alice@venzo.com' },
            role: 'MANAGER',
            isPrimary: true,
          },
        ],
      },
      ancestors: [],
      children: [],
    };
    renderPage();

    await user.click(screen.getByRole('tab', { name: /Organograma/i }));

    // Click no nó — botão com o nome do nó
    const nodeBtn = screen.getAllByRole('button', { name: /Equipe Padrão/i })[0]!;
    await user.click(nodeBtn);

    // Sheet renderiza como dialog. Radix Dialog anexa via portal ao body.
    await waitFor(() => {
      expect(screen.getByText(/Alice Neves/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/alice@venzo\.com/i)).toBeInTheDocument();
    expect(screen.getByText(/Gerente/i)).toBeInTheDocument();
    expect(screen.getByText(/Primária/i)).toBeInTheDocument();
  });

  it('addMember onSuccess dispara toast e invalida getUnit + getTree', async () => {
    // O AddMemberModal só monta quando o Sheet detalhe abre. Pra registrar
    // o hook `useMutation` do addMember precisamos abrir o Sheet + click no
    // "+ Adicionar" primeiro. Depois exercemos onSuccess diretamente
    // (P-54 pattern: handlers > multiplos portals no jsdom).
    state.tree = [
      {
        id: 'u-root',
        tenantId: 't-1',
        typeId: 'ut-1',
        name: 'Equipe Padrão',
        path: 'root.a1',
        depth: 1,
        parentId: null,
        typeName: 'Equipe',
        typeLevel: 1,
        typeColor: '#6366F1',
        typeIcon: null,
        memberCount: 0,
        active: true,
      },
    ];
    state.unitDetail = {
      unit: {
        id: 'u-root',
        name: 'Equipe Padrão',
        type: { name: 'Equipe', level: 1, color: '#6366F1' },
        members: [],
      },
      ancestors: [],
      children: [],
    };
    state.users = [
      { id: 'usr-1', fullName: 'Alice', email: 'a@x.com', role: 'ANALISTA', active: true },
    ];
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('tab', { name: /Organograma/i }));
    const nodeBtn = screen.getAllByRole('button', { name: /Equipe Padrão/i })[0]!;
    await user.click(nodeBtn);

    // Depois de abrir o Sheet + click no botão "+ Adicionar", o
    // AddMemberModal monta e registra o hook.
    await waitFor(() => {
      expect(screen.getByText('+ Adicionar')).toBeInTheDocument();
    });
    await user.click(screen.getByText('+ Adicionar'));

    // Handler capturado após montagem do modal.
    await waitFor(() => {
      expect(captured.addMember?.onSuccess).toBeTypeOf('function');
    });

    await act(async () => {
      // Simula retorno pós-P-79 do addMember: distingue created vs update vs no-op.
      captured.addMember!.onSuccess!({ ok: true, created: true, roleChanged: false, primaryChanged: false });
    });

    await waitFor(() => {
      expect(screen.getByText(/Membro adicionado\./i)).toBeInTheDocument();
    });
    expect(captured.invalidates.getUnit).toHaveBeenCalled();
    expect(captured.invalidates.getTree).toHaveBeenCalled();
  });

  it('createUnitType onSuccess dispara toast success', async () => {
    renderPage();
    expect(captured.createUnitType?.onSuccess).toBeTypeOf('function');

    await act(async () => {
      captured.createUnitType!.onSuccess!();
    });

    await waitFor(() => {
      expect(screen.getByText(/Nível criado\./i)).toBeInTheDocument();
    });
    expect(captured.invalidates.listUnitTypes).toHaveBeenCalled();
  });
});
