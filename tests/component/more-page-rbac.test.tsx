import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { render, screen } from '@testing-library/react';
import type { UserRole } from '@prisma/client';

/**
 * P-97 — Gate de permissão na página /more (índice mobile).
 *
 * Bug em prod (2026-07-17, Fred como ANALISTA): /more listava TODOS os
 * items admin (Usuários, IA, Plano e cobrança, etc.) sem gate, enquanto a
 * Sidebar já era gateada (P-88/P-88b). Mesmo bug de defesa em profundidade
 * UI numa superfície diferente.
 *
 * O fix replica o padrão da Sidebar: cada item admin ganha `permission`
 * opcional; a lista renderizada filtra por `hasPermissionByRole(role, perm)`.
 * As permissions espelham 1:1 as da Sidebar (pós P-88b).
 *
 * Padrão de mock replicado de `sidebar-rbac.test.tsx`: mocka só
 * `next/navigation` + `@/lib/trpc/client`; usa o `hasPermissionByRole`
 * REAL (nenhum mock de rbac/catalog).
 */

let currentRole: UserRole | undefined = 'ADMIN';
let currentLoading = false;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/more',
}));

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    users: {
      me: {
        useQuery: () => ({
          data:
            !currentLoading && currentRole
              ? { id: 'me-1', fullName: 'Test User', role: currentRole }
              : undefined,
          isLoading: currentLoading,
          isFetching: false,
          error: null,
        }),
      },
    },
  },
}));

import MorePage from '@/app/more/page';

function renderMore() {
  return render(<MorePage />);
}

function hasLink(label: string): boolean {
  return screen.queryByRole('link', { name: label }) !== null;
}

// Items admin gated (não devem aparecer pra quem não tem a permission).
const ADMIN_LINKS = [
  'Admin · Usuários',
  'Admin · Produtos',
  'Admin · Listas',
  'Admin · Plano e cobrança',
  'Admin · Identidade',
  'Admin · Alertas',
  'Admin · IA',
  'Admin · Taxas de conversão',
  'Admin · Regras de aprovação',
  'Admin · Contratos',
  'Admin · Parceiros',
  'Admin · Templates',
  'Admin · E-mail Inbound',
  'Admin · Inbound rejeitados',
  'Admin · Solicitações LGPD',
];

// Items operacionais sem gate — visíveis a qualquer authenticated.
const UNGATED_LINKS = [
  'Empresas',
  'Contatos',
  'Relatórios',
  'Contratos',
  'Aprovações',
];

beforeEach(() => {
  currentRole = 'ADMIN';
  currentLoading = false;
});

describe('/more RBAC gate — P-97', () => {
  it('ADMIN vê todos os items admin + operacionais', () => {
    currentRole = 'ADMIN';
    renderMore();

    for (const label of ADMIN_LINKS) {
      expect(hasLink(label)).toBe(true);
    }
    for (const label of UNGATED_LINKS) {
      expect(hasLink(label)).toBe(true);
    }
    // ADMIN tem import:run → vê Importação.
    expect(hasLink('Importação')).toBe(true);
  });

  it('ANALISTA NÃO vê nenhum item admin gated', () => {
    currentRole = 'ANALISTA';
    renderMore();

    for (const label of ADMIN_LINKS) {
      expect(hasLink(label)).toBe(false);
    }
  });

  it('ANALISTA continua vendo os items operacionais sem gate', () => {
    currentRole = 'ANALISTA';
    renderMore();

    for (const label of UNGATED_LINKS) {
      expect(hasLink(label)).toBe(true);
    }
  });

  it('ANALISTA vê "Estrutura comercial" (tem sales_structure:read) mas NÃO "Importação" (sem import:run)', () => {
    currentRole = 'ANALISTA';
    renderMore();

    expect(hasLink('Admin · Estrutura comercial')).toBe(true);
    expect(hasLink('Importação')).toBe(false);
  });

  it('GESTOR vê Parceiros (tem partner:invite) mas não os items ADMIN-only', () => {
    currentRole = 'GESTOR';
    renderMore();

    expect(hasLink('Admin · Parceiros')).toBe(true);
    expect(hasLink('Admin · Usuários')).toBe(false);
    expect(hasLink('Admin · IA')).toBe(false);
    expect(hasLink('Admin · Plano e cobrança')).toBe(false);
  });

  it('PARCEIRO só vê operacionais sem gate, nenhum admin', () => {
    currentRole = 'PARCEIRO';
    renderMore();

    for (const label of ADMIN_LINKS) {
      expect(hasLink(label)).toBe(false);
    }
    // PARCEIRO tem company:read/contact:read → vê Empresas/Contatos.
    expect(hasLink('Empresas')).toBe(true);
    expect(hasLink('Contatos')).toBe(true);
  });

  it('loading (role ainda carregando) mostra skeleton e NÃO pisca a lista completa de admin', () => {
    currentLoading = true;
    currentRole = undefined;
    renderMore();

    expect(screen.getByTestId('more-skeleton')).toBeInTheDocument();
    // Nenhum item admin vaza durante o loading.
    for (const label of ADMIN_LINKS) {
      expect(hasLink(label)).toBe(false);
    }
    // Também não renderiza os operacionais ainda (skeleton no lugar da lista).
    expect(hasLink('Empresas')).toBe(false);
  });

  it('role indefinido pós-load (erro/sem sessão) esconde admin, mostra só ungated', () => {
    currentLoading = false;
    currentRole = undefined;
    renderMore();

    // Sem skeleton (não está mais carregando).
    expect(screen.queryByTestId('more-skeleton')).not.toBeInTheDocument();
    // Items gated escondidos (fail-safe — nunca vaza admin sem role).
    for (const label of ADMIN_LINKS) {
      expect(hasLink(label)).toBe(false);
    }
    // Operacionais sem gate continuam visíveis.
    expect(hasLink('Empresas')).toBe(true);
  });
});
