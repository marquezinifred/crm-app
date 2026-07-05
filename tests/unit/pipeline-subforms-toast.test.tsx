import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * P-58 — Toast success/error em 3 subforms de pipeline
 * (CommunicationIntake, DocumentsSection, ProposalsSection).
 *
 * Padrão canônico do P-54 replicado: onSuccess dispara toast success
 * + invalida caches locais; onError dispara toast error com
 * friendlyTrpcError. Auditoria pós-P-54 identificou que estes 3
 * componentes ficaram sem feedback padronizado.
 */

type MutationOpts = {
  onSuccess?: (data?: unknown) => void;
  onError?: (err: { message: string; data?: unknown }) => void;
};

const captured: {
  summarize: MutationOpts | null;
  confirmSummary: MutationOpts | null;
  documentsCreate: MutationOpts | null;
  proposalsCreate: MutationOpts | null;
  proposalsAddVersion: MutationOpts | null;
} = {
  summarize: null,
  confirmSummary: null,
  documentsCreate: null,
  proposalsCreate: null,
  proposalsAddVersion: null,
};

const invalidateSpy = vi.fn();

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
        documents: { listByOpportunity: { invalidate: invalidateSpy } },
        proposals: { listByOpportunity: { invalidate: invalidateSpy } },
      }),
      activities: {
        summarize: {
          useMutation: (opts: MutationOpts) => {
            captured.summarize = opts;
            return { mutate: vi.fn(), isLoading: false, isPending: false, error: null };
          },
        },
        confirmSummary: {
          useMutation: (opts: MutationOpts) => {
            captured.confirmSummary = opts;
            return { mutate: vi.fn(), isLoading: false, isPending: false, error: null };
          },
        },
      },
      documents: {
        listByOpportunity: { useQuery: () => useQueryReturn([]) },
        getUploadIntent: { useMutation: noopMutation },
        uploadProxy: { useMutation: noopMutation },
        create: {
          useMutation: (opts: MutationOpts) => {
            captured.documentsCreate = opts;
            return { mutate: vi.fn(), mutateAsync: vi.fn(), isLoading: false, isPending: false, error: null };
          },
        },
      },
      proposals: {
        listByOpportunity: { useQuery: () => useQueryReturn([]) },
        create: {
          useMutation: (opts: MutationOpts) => {
            captured.proposalsCreate = opts;
            return { mutate: vi.fn(), isLoading: false, isPending: false, error: null };
          },
        },
        addVersion: {
          useMutation: (opts: MutationOpts) => {
            captured.proposalsAddVersion = opts;
            return { mutate: vi.fn(), isLoading: false, isPending: false, error: null };
          },
        },
      },
    },
  };
});

import { CommunicationIntake } from '@/components/pipeline/CommunicationIntake';
import { DocumentsSection } from '@/components/pipeline/DocumentsSection';
import { ProposalsSection } from '@/components/pipeline/ProposalsSection';
import { ToastProvider } from '@/components/ui/toast';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  captured.summarize = null;
  captured.confirmSummary = null;
  captured.documentsCreate = null;
  captured.proposalsCreate = null;
  captured.proposalsAddVersion = null;
  invalidateSpy.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
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

describe('CommunicationIntake (P-58)', () => {
  it('summarize.onSuccess com aiGenerated=true dispara toast "Resumo gerado."', async () => {
    await render(<CommunicationIntake opportunityId="opp-1" />);
    expect(captured.summarize?.onSuccess).toBeTypeOf('function');

    await act(async () => {
      captured.summarize!.onSuccess!({
        aiGenerated: true,
        themes: [],
        adjustments: [],
        decisions: [],
        nextSteps: [],
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(findToastTitles()).toContain('Resumo gerado.');
  });

  it('summarize.onSuccess com aiGenerated=false NÃO dispara toast (aiFailed inline)', async () => {
    await render(<CommunicationIntake opportunityId="opp-1" />);

    await act(async () => {
      captured.summarize!.onSuccess!({
        aiGenerated: false,
        themes: [],
        adjustments: [],
        decisions: [],
        nextSteps: [],
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(findToastTitles()).not.toContain('Resumo gerado.');
  });

  it('summarize.onError dispara toast error com friendlyTrpcError', async () => {
    await render(<CommunicationIntake opportunityId="opp-1" />);
    expect(captured.summarize?.onError).toBeTypeOf('function');

    await act(async () => {
      captured.summarize!.onError!({
        message: 'Erro genérico',
        data: {
          zodError: { fieldErrors: { text: ['Texto muito curto'] }, formErrors: [] },
        },
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(findToastTitles()).toContain('Texto muito curto');
  });

  it('confirmSummary.onSuccess dispara toast "Reunião salva."', async () => {
    await render(<CommunicationIntake opportunityId="opp-1" />);
    expect(captured.confirmSummary?.onSuccess).toBeTypeOf('function');

    await act(async () => {
      captured.confirmSummary!.onSuccess!();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(findToastTitles()).toContain('Reunião salva.');
  });

  it('confirmSummary.onError dispara toast error com friendlyTrpcError', async () => {
    await render(<CommunicationIntake opportunityId="opp-1" />);
    expect(captured.confirmSummary?.onError).toBeTypeOf('function');

    await act(async () => {
      captured.confirmSummary!.onError!({ message: 'Falha ao gravar' });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(findToastTitles()).toContain('Falha ao gravar');
  });
});

describe('DocumentsSection (P-58)', () => {
  it('renderiza sem erro e captura mutation callbacks', async () => {
    await render(<DocumentsSection opportunityId="opp-1" />);
    expect(captured.documentsCreate?.onSuccess).toBeTypeOf('function');
  });

  it('create.onSuccess invalida cache de listByOpportunity', async () => {
    await render(<DocumentsSection opportunityId="opp-1" />);

    await act(async () => {
      captured.documentsCreate!.onSuccess!();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ opportunityId: 'opp-1' });
  });
});

describe('ProposalsSection (P-58)', () => {
  it('create.onSuccess dispara toast "Proposta criada." + invalida cache', async () => {
    await render(<ProposalsSection opportunityId="opp-1" />);
    expect(captured.proposalsCreate?.onSuccess).toBeTypeOf('function');

    await act(async () => {
      captured.proposalsCreate!.onSuccess!();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ opportunityId: 'opp-1' });
    expect(findToastTitles()).toContain('Proposta criada.');
  });

  it('create.onError dispara toast error com friendlyTrpcError', async () => {
    await render(<ProposalsSection opportunityId="opp-1" />);
    expect(captured.proposalsCreate?.onError).toBeTypeOf('function');

    await act(async () => {
      captured.proposalsCreate!.onError!({
        message: 'Erro',
        data: {
          zodError: { fieldErrors: { title: ['Título obrigatório'] }, formErrors: [] },
        },
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(findToastTitles()).toContain('Título obrigatório');
  });

  it('addVersion.onSuccess dispara toast "Nova versão da proposta."', async () => {
    await render(<ProposalsSection opportunityId="opp-1" />);
    expect(captured.proposalsAddVersion?.onSuccess).toBeTypeOf('function');

    await act(async () => {
      captured.proposalsAddVersion!.onSuccess!();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(findToastTitles()).toContain('Nova versão da proposta.');
  });

  it('addVersion.onError dispara toast error com friendlyTrpcError', async () => {
    await render(<ProposalsSection opportunityId="opp-1" />);
    expect(captured.proposalsAddVersion?.onError).toBeTypeOf('function');

    await act(async () => {
      captured.proposalsAddVersion!.onError!({ message: 'Valor inválido' });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(findToastTitles()).toContain('Valor inválido');
  });
});
