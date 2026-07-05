import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * P-54 — Fix crítico: Salvar/Avançar/Cancelar em /pipeline/[id] agora
 * disparam toast + limpam editStageFields no sucesso; erro vira toast
 * com friendlyTrpcError. Bug original deixava tela muda e mantinha
 * dirty flag que travava o botão "Resumir com IA".
 */

const routerPush = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'opp-1' }),
  useRouter: () => ({ push: routerPush, back: vi.fn() }),
}));

type MutationOpts = {
  onSuccess?: (data?: unknown) => void;
  onError?: (err: { message: string; data?: unknown }) => void;
};

const captured: {
  update: MutationOpts | null;
  advance: MutationOpts | null;
  cancel: MutationOpts | null;
} = { update: null, advance: null, cancel: null };

const invalidateSpy = vi.fn();

const oppFixture = {
  id: 'opp-1',
  title: 'Oportunidade teste',
  stage: 'LEAD' as const,
  status: 'ACTIVE' as const,
  estimatedValue: 100,
  clientCompany: { razaoSocial: 'Empresa X' },
  owner: { fullName: 'Fulano de Tal' },
  partnerCompany: null,
  team: [],
  meetingScheduledAt: null,
  meetingHappened: null,
  briefing: null,
  expectedCloseDate: null,
  proposalPresentedAt: null,
  decisionExpectedAt: null,
  acceptedAt: null,
  stageHistory: [],
};

vi.mock('@/lib/trpc/client', () => {
  const useQueryReturn = (data: unknown) => ({
    data,
    isLoading: false,
    isFetching: false,
    error: null,
  });
  const noopMutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isLoading: false,
    isPending: false,
    error: null,
    data: null,
  });
  return {
    trpc: {
      useUtils: () => ({
        opportunities: { byId: { invalidate: invalidateSpy } },
        tasks: { list: { invalidate: vi.fn() } },
        documents: { listByOpportunity: { invalidate: vi.fn() } },
      }),
      opportunities: {
        byId: { useQuery: () => useQueryReturn(oppFixture) },
        update: {
          useMutation: (opts: MutationOpts) => {
            captured.update = opts;
            return { mutate: vi.fn(), isLoading: false, isPending: false, error: null };
          },
        },
        advanceStage: {
          useMutation: (opts: MutationOpts) => {
            captured.advance = opts;
            return { mutate: vi.fn(), isLoading: false, isPending: false, error: null };
          },
        },
        cancel: {
          useMutation: (opts: MutationOpts) => {
            captured.cancel = opts;
            return { mutate: vi.fn(), isLoading: false, isPending: false, error: null };
          },
        },
      },
      activities: {
        list: { useQuery: () => useQueryReturn([]) },
        summarize: { useMutation: noopMutation },
        confirmSummary: { useMutation: noopMutation },
      },
      tasks: {
        list: { useQuery: () => useQueryReturn([]) },
        create: { useMutation: noopMutation },
        update: { useMutation: noopMutation },
        delete: { useMutation: noopMutation },
        updateStatus: { useMutation: noopMutation },
      },
      users: { list: { useQuery: () => useQueryReturn([]) } },
      documents: {
        listByOpportunity: { useQuery: () => useQueryReturn([]) },
        getUploadIntent: { useMutation: noopMutation },
        uploadProxy: { useMutation: noopMutation },
        create: { useMutation: noopMutation },
      },
      proposals: {
        listByOpportunity: { useQuery: () => useQueryReturn([]) },
        create: { useMutation: noopMutation },
        addVersion: { useMutation: noopMutation },
      },
    },
  };
});

import OpportunityDetailPage from '@/app/pipeline/[id]/page';
import { ToastProvider } from '@/components/ui/toast';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  captured.update = null;
  captured.advance = null;
  captured.cancel = null;
  invalidateSpy.mockClear();
  routerPush.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.documentElement.style.overflow = '';
});

async function render(node: React.ReactElement) {
  await act(async () => {
    root.render(<ToastProvider>{node}</ToastProvider>);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function findToastTitles(): string[] {
  return Array.from(
    container.ownerDocument.querySelectorAll('[role="status"] p, [role="alert"] p'),
  )
    .map((el) => el.textContent ?? '')
    .filter((t) => t.length > 0);
}

describe('/pipeline/[id] page (P-54)', () => {
  it('update.onSuccess dispara toast success', async () => {
    await render(<OpportunityDetailPage />);
    expect(captured.update?.onSuccess).toBeTypeOf('function');

    await act(async () => {
      captured.update!.onSuccess!();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ id: 'opp-1' });
    expect(findToastTitles()).toContain('Alterações salvas.');
  });

  it('update.onError dispara toast error com friendlyTrpcError', async () => {
    await render(<OpportunityDetailPage />);
    expect(captured.update?.onError).toBeTypeOf('function');

    await act(async () => {
      captured.update!.onError!({
        message: 'Erro genérico',
        data: {
          zodError: { fieldErrors: { estimatedValue: ['Valor inválido'] }, formErrors: [] },
        },
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    // friendlyTrpcError extrai a fieldError primeiro
    expect(findToastTitles()).toContain('Valor inválido');
  });

  it('update.onSuccess limpa editStageFields (botão Salvar some após edit + save)', async () => {
    await render(<OpportunityDetailPage />);

    // Antes de editar não existe botão Salvar
    const buttonsBefore = Array.from(
      container.querySelectorAll('button'),
    ).map((b) => b.textContent);
    expect(buttonsBefore).not.toContain('Salvar alterações');

    // Edita o campo `meetingHappened` do stage LEAD
    const select = container.querySelector<HTMLSelectElement>(
      'select',
    );
    expect(select).toBeTruthy();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        'value',
      )!.set!;
      setter.call(select!, 'true');
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Agora Salvar/Descartar aparecem
    const buttonsAfterEdit = Array.from(
      container.querySelectorAll('button'),
    ).map((b) => b.textContent);
    expect(buttonsAfterEdit).toContain('Salvar alterações');
    expect(buttonsAfterEdit).toContain('Descartar');

    // Simula sucesso da mutation
    await act(async () => {
      captured.update!.onSuccess!();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Botão Salvar sumiu — dirty state limpo (bug do P-54 fixado)
    const buttonsAfterSave = Array.from(
      container.querySelectorAll('button'),
    ).map((b) => b.textContent);
    expect(buttonsAfterSave).not.toContain('Salvar alterações');
    expect(buttonsAfterSave).not.toContain('Descartar');
  });

  it('advance.onSuccess dispara toast + limpa edits + invalida query', async () => {
    await render(<OpportunityDetailPage />);
    expect(captured.advance?.onSuccess).toBeTypeOf('function');

    await act(async () => {
      captured.advance!.onSuccess!();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ id: 'opp-1' });
    expect(findToastTitles()).toContain('Estágio avançado.');
  });

  it('advance.onError dispara toast error com friendlyTrpcError', async () => {
    await render(<OpportunityDetailPage />);
    expect(captured.advance?.onError).toBeTypeOf('function');

    await act(async () => {
      captured.advance!.onError!({ message: 'Não pode avançar' });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(findToastTitles()).toContain('Não pode avançar');
  });

  it('cancel.onError dispara toast error com friendlyTrpcError', async () => {
    await render(<OpportunityDetailPage />);
    expect(captured.cancel?.onError).toBeTypeOf('function');

    await act(async () => {
      captured.cancel!.onError!({ message: 'Falha ao cancelar' });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(findToastTitles()).toContain('Falha ao cancelar');
  });

  it('cancel.onSuccess redireciona para /pipeline (sem toast — redirect é o feedback)', async () => {
    await render(<OpportunityDetailPage />);
    expect(captured.cancel?.onSuccess).toBeTypeOf('function');

    await act(async () => {
      captured.cancel!.onSuccess!();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(routerPush).toHaveBeenCalledWith('/pipeline');
    expect(invalidateSpy).toHaveBeenCalledWith({ id: 'opp-1' });
  });
});
