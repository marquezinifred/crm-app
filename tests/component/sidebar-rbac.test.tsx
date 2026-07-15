import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import type { UserRole } from '@prisma/client';

/**
 * P-88 — Sidebar RBAC gate em Users/Products/Listas.
 *
 * Antes do fix, 3 items da seção Admin (`/admin/users`, `/admin/products`,
 * `/admin/listas`) não tinham `permission:` configurada e apareciam para
 * ANALISTA/GESTOR/PARCEIRO no menu lateral em produção. Backend barra
 * com FORBIDDEN corretamente (usa `adminOnlyProcedure`), mas o menu
 * confundia o usuário.
 *
 * Fix adiciona:
 *  - /admin/users → permission: 'user:update'
 *  - /admin/products → permission: 'catalog:update'
 *  - /admin/listas → permission: 'catalog:update'
 *
 * Estes testes garantem:
 *  - ANALISTA/GESTOR/PARCEIRO não veem os itens (têm apenas catalog:read
 *    e não têm user:update).
 *  - ADMIN vê todos (tem user:update + catalog:update).
 *  - DIRETOR_COMERCIAL não vê os itens (não tem user:update nem
 *    catalog:update — apenas user:read + catalog:read).
 *
 * Padrão de mock replicado de `admin-commercial-structure.test.tsx`
 * (mock direto do `trpc.users.me.useQuery`).
 */

let currentRole: UserRole | undefined = 'ADMIN';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard',
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
      users: {
        me: {
          useQuery: () =>
            queryReturn(
              currentRole
                ? { id: 'me-1', fullName: 'Test User', role: currentRole }
                : undefined,
            ),
        },
      },
    },
  };
});

import { Sidebar } from '@/components/layout/Sidebar';

function renderSidebar() {
  return render(
    <Sidebar
      variant="fixed"
      collapsed={false}
      onToggleCollapsed={vi.fn()}
    />,
  );
}

/**
 * A sidebar renderiza items em `<aside aria-label="Navegação principal">`
 * como `<a>` (via Next Link). Buscamos por link name pra evitar match em
 * outros elementos (headers de seção, tooltip aria-label etc).
 */
function getNav() {
  return screen.getByRole('navigation') ?? screen.getByLabelText('Navegação principal');
}

function hasLink(label: RegExp | string): boolean {
  const nav = getNav();
  return within(nav).queryAllByRole('link', { name: label }).length > 0;
}

beforeEach(() => {
  currentRole = 'ADMIN';
});

describe('Sidebar RBAC gate — P-88', () => {
  it('ADMIN vê os 3 items gated (Usuários, Produtos, Listas) + demais Admin', () => {
    currentRole = 'ADMIN';
    renderSidebar();

    expect(hasLink(/^Usuários$/)).toBe(true);
    expect(hasLink(/^Produtos$/)).toBe(true);
    expect(hasLink(/^Listas$/)).toBe(true);
    // Sanity: itens não-gated também aparecem
    expect(hasLink(/^Dashboard$/)).toBe(true);
    expect(hasLink(/^Plano e cobrança$/)).toBe(true);
  });

  it('ANALISTA NÃO vê Usuários/Produtos/Listas (sem user:update nem catalog:update)', () => {
    currentRole = 'ANALISTA';
    renderSidebar();

    expect(hasLink(/^Usuários$/)).toBe(false);
    expect(hasLink(/^Produtos$/)).toBe(false);
    expect(hasLink(/^Listas$/)).toBe(false);
    // Sanity: itens não-gated continuam aparecendo pra ANALISTA
    expect(hasLink(/^Dashboard$/)).toBe(true);
    expect(hasLink(/^Pipeline$/)).toBe(true);
  });

  it('GESTOR NÃO vê Usuários/Produtos/Listas (sem user:update nem catalog:update)', () => {
    currentRole = 'GESTOR';
    renderSidebar();

    expect(hasLink(/^Usuários$/)).toBe(false);
    expect(hasLink(/^Produtos$/)).toBe(false);
    expect(hasLink(/^Listas$/)).toBe(false);
    expect(hasLink(/^Dashboard$/)).toBe(true);
    expect(hasLink(/^Pipeline$/)).toBe(true);
  });

  it('PARCEIRO NÃO vê Usuários/Produtos/Listas', () => {
    currentRole = 'PARCEIRO';
    renderSidebar();

    expect(hasLink(/^Usuários$/)).toBe(false);
    expect(hasLink(/^Produtos$/)).toBe(false);
    expect(hasLink(/^Listas$/)).toBe(false);
  });

  it('DIRETOR_COMERCIAL NÃO vê Usuários/Produtos/Listas (só tem user:read + catalog:read)', () => {
    // DIRETOR_C não tem user:update nem catalog:update — só user:read + catalog:read.
    // O item de sidebar exige update, portanto DIRETOR_C não vê.
    // Backend confirma: /admin/users usa adminOnlyProcedure em mutations,
    // então DIRETOR_C nunca deveria estar operando essas telas de qualquer forma.
    currentRole = 'DIRETOR_COMERCIAL';
    renderSidebar();

    expect(hasLink(/^Usuários$/)).toBe(false);
    expect(hasLink(/^Produtos$/)).toBe(false);
    expect(hasLink(/^Listas$/)).toBe(false);
    // Sanity: DIRETOR_C mantém itens não-gated (Dashboard, Pipeline etc.)
    expect(hasLink(/^Dashboard$/)).toBe(true);
    expect(hasLink(/^Pipeline$/)).toBe(true);
    expect(hasLink(/^Relatórios$/)).toBe(true);
  });

  it('DIRETOR_OPERACOES NÃO vê Usuários/Produtos/Listas', () => {
    currentRole = 'DIRETOR_OPERACOES';
    renderSidebar();

    expect(hasLink(/^Usuários$/)).toBe(false);
    expect(hasLink(/^Produtos$/)).toBe(false);
    expect(hasLink(/^Listas$/)).toBe(false);
  });

  it('DIRETOR_FINANCEIRO NÃO vê Usuários/Produtos/Listas', () => {
    currentRole = 'DIRETOR_FINANCEIRO';
    renderSidebar();

    expect(hasLink(/^Usuários$/)).toBe(false);
    expect(hasLink(/^Produtos$/)).toBe(false);
    expect(hasLink(/^Listas$/)).toBe(false);
  });

  it('sem role carregado (loading state) mostra todos os itens (comportamento permissivo pré-fix)', () => {
    // Enquanto `users.me.useQuery` retorna undefined, o Sidebar mantém
    // todos os itens visíveis — o server bloqueia clique com FORBIDDEN.
    // Preservado no fix P-88 (só o filtro por permission mudou).
    currentRole = undefined;
    renderSidebar();

    expect(hasLink(/^Usuários$/)).toBe(true);
    expect(hasLink(/^Produtos$/)).toBe(true);
    expect(hasLink(/^Listas$/)).toBe(true);
  });
});
