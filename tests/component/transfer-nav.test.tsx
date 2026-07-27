import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import type { UserRole } from '@prisma/client';

/**
 * Sprint 15G.5 Fase 3b — navegação do workflow de transferência.
 *
 * Cobre os dois pontos que o chip 3b é dono:
 *  - Topbar `<TransferBell />`: conta `pendingForMe`, some quando 0 e quando
 *    a query erra (FORBIDDEN → 0), leva pra fila do destinatário.
 *  - Sidebar: os DOIS itens gated por `opportunity:transfer` — o de 3b
 *    (/inbox/transferencias-recebidas) e o de 3c
 *    (/pipeline/transferencias-em-andamento).
 */

let meRole: UserRole | undefined = 'ADMIN';
let bellData: unknown = undefined;
let bellError: { message: string } | null = null;

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

// Topbar importa esses no topo do módulo — mockamos pra `import { TransferBell }`
// não puxar Clerk/CommandPalette/ThemeToggle reais no jsdom.
vi.mock('@clerk/nextjs', () => ({ UserButton: () => null }));
vi.mock('@/components/theme/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/components/search/CommandPalette', () => ({ CommandPalette: () => null }));

vi.mock('@/lib/trpc/client', () => {
  const q = (data: unknown, error: unknown = null) => ({
    data,
    isLoading: false,
    isFetching: false,
    error,
    refetch: vi.fn(),
  });
  return {
    trpc: {
      users: {
        me: {
          useQuery: () =>
            q(meRole ? { id: 'me-1', fullName: 'Test User', role: meRole } : undefined),
        },
      },
      opportunityTransfers: {
        pendingForMe: {
          useQuery: () => q(bellData, bellError),
        },
      },
    },
  };
});

import { TransferBell } from '@/components/layout/Topbar';
import { Sidebar } from '@/components/layout/Sidebar';

beforeEach(() => {
  meRole = 'ADMIN';
  bellData = undefined;
  bellError = null;
});

describe('Topbar <TransferBell /> (Sprint 15G.5 3b)', () => {
  it('mostra o sino com a contagem e link pra fila quando há pendências', () => {
    bellData = [{ id: 'tr-1' }, { id: 'tr-2' }];
    render(<TransferBell />);

    const link = screen.getByRole('link', { name: /2 transferências aguardando/i });
    expect(link).toHaveAttribute('href', '/inbox/transferencias-recebidas');
    expect(within(link).getByText('2')).toBeInTheDocument();
  });

  it('usa singular no aria-label com 1 pendência', () => {
    bellData = [{ id: 'tr-1' }];
    render(<TransferBell />);
    expect(
      screen.getByRole('link', { name: /1 transferência aguardando sua decisão/i }),
    ).toBeInTheDocument();
  });

  it('não renderiza o sino quando a fila está vazia', () => {
    bellData = [];
    const { container } = render(<TransferBell />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('não renderiza o sino quando a query erra (FORBIDDEN → 0)', () => {
    bellError = { message: 'Recurso indisponível.' };
    bellData = undefined;
    const { container } = render(<TransferBell />);
    expect(container).toBeEmptyDOMElement();
  });

  it('mostra "9+" quando a contagem passa de 9', () => {
    bellData = Array.from({ length: 12 }, (_, i) => ({ id: `tr-${i}` }));
    render(<TransferBell />);
    expect(screen.getByText('9+')).toBeInTheDocument();
  });
});

describe('Sidebar — itens de transferência (Sprint 15G.5 3b/3c)', () => {
  function renderSidebar() {
    return render(<Sidebar variant="fixed" collapsed={false} onToggleCollapsed={vi.fn()} />);
  }

  it('ADMIN vê os 2 itens (recebidas 3b + em andamento 3c) com hrefs corretos', () => {
    meRole = 'ADMIN';
    renderSidebar();
    const nav = screen.getByRole('navigation');

    const recebidas = within(nav).getByRole('link', { name: /Transferências recebidas/i });
    expect(recebidas).toHaveAttribute('href', '/inbox/transferencias-recebidas');

    const andamento = within(nav).getByRole('link', { name: /Transferências em andamento/i });
    expect(andamento).toHaveAttribute('href', '/pipeline/transferencias-em-andamento');
  });

  it('GESTOR vê os 2 itens (tem opportunity:transfer)', () => {
    meRole = 'GESTOR';
    renderSidebar();
    const nav = screen.getByRole('navigation');
    expect(within(nav).queryByRole('link', { name: /Transferências recebidas/i })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: /Transferências em andamento/i })).toBeInTheDocument();
  });

  it('ANALISTA NÃO vê nenhum dos 2 itens (sem opportunity:transfer)', () => {
    meRole = 'ANALISTA';
    renderSidebar();
    const nav = screen.getByRole('navigation');
    expect(within(nav).queryByRole('link', { name: /Transferências recebidas/i })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: /Transferências em andamento/i })).not.toBeInTheDocument();
  });

  it('PARCEIRO NÃO vê nenhum dos 2 itens', () => {
    meRole = 'PARCEIRO';
    renderSidebar();
    const nav = screen.getByRole('navigation');
    expect(within(nav).queryByRole('link', { name: /Transferências recebidas/i })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: /Transferências em andamento/i })).not.toBeInTheDocument();
  });
});
