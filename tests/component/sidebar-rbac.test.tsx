import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import type { UserRole } from '@prisma/client';

/**
 * P-88 + P-88b — Sidebar RBAC gate em items admin.
 *
 * ## P-88 (original)
 * Antes do fix, 3 items da seção Admin (`/admin/users`, `/admin/products`,
 * `/admin/listas`) não tinham `permission:` configurada e apareciam para
 * ANALISTA/GESTOR/PARCEIRO no menu lateral em produção. Backend barra
 * com FORBIDDEN corretamente (usa `adminOnlyProcedure`), mas o menu
 * confundia o usuário.
 *
 * Adicionou:
 *  - /admin/users → permission: 'user:update'
 *  - /admin/products → permission: 'catalog:update'
 *  - /admin/listas → permission: 'catalog:update'
 *
 * ## P-88b (residual)
 * P-88 original ficou cirúrgico demais — cobriu apenas 3 items.
 * ANALISTA reportou em prod que via/acessava /admin/conversion-rates
 * (backend só bloqueia mutations; leitura da tela vazava).
 *
 * P-88b cobre os 10 items restantes da seção Admin + o único item da
 * seção Parceiros:
 *
 *  - /admin/billing → permission: 'tenant:update' (ADMIN-only)
 *  - /admin/branding → permission: 'tenant:update' (ADMIN-only)
 *  - /admin/ai → permission: 'ai:configure_global' (ADMIN-only)
 *  - /admin/alerts → permission: 'alert:configure' (ADMIN-only)
 *  - /admin/approval-rules → permission: 'tenant:update' (ADMIN-only)
 *  - /admin/contracts → permission: 'tenant:update' (ADMIN-only)
 *  - /admin/conversion-rates → permission: 'tenant:update' (ADMIN-only)
 *  - /admin/templates → permission: 'catalog:update' (ADMIN-only)
 *  - /admin/privacy → permission: 'tenant:update' (ADMIN-only)
 *  - /admin/partners → permission: 'partner:invite'
 *    (ADMIN + DIRETOR_C + DIRETOR_O + GESTOR — únicos que operam com
 *    parceiros; DIRETOR_F/ANALISTA/PARCEIRO ficam fora)
 *
 * Racional de escolha: cada gate escolhido baseado em
 * ROLE_DEFAULT_PERMISSIONS. Prefere permission existente que só ADMIN
 * tem por default. `tenant:update` (ADMIN-only) usado quando nenhuma
 * permission mais específica alinha semanticamente — defesa em
 * profundidade UI. Backend continua re-validando em cada procedure via
 * adminOnlyProcedure.
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

/**
 * P-88b — 10 items admin restantes.
 *
 * Cobre gates aplicados aos items que P-88 original deixou de fora.
 * Tabela de decisão está no topo do arquivo.
 *
 * ADMIN vê todos; DIRETOR_* / GESTOR / ANALISTA / PARCEIRO seguem
 * comportamento role-a-role documentado.
 */

const P88B_ADMIN_ONLY_LABELS = [
  /^Plano e cobrança$/,
  /^Identidade$/,
  /^IA$/,
  /^Alertas$/,
  /^Regras de aprovação$/,
  /^Config\. contratos$/,
  /^Taxas de conversão$/,
  /^Templates$/,
  /^LGPD$/,
];

describe('Sidebar RBAC gate — P-88b (10 items admin restantes)', () => {
  it('ADMIN vê todos os 10 items novos gated + Parceiros', () => {
    currentRole = 'ADMIN';
    renderSidebar();

    for (const label of P88B_ADMIN_ONLY_LABELS) {
      expect(hasLink(label)).toBe(true);
    }
    expect(hasLink(/^Parceiros$/)).toBe(true);
  });

  it('ANALISTA NÃO vê nenhum dos 10 items novos (sem tenant:update / ai:configure_global / alert:configure / catalog:update)', () => {
    currentRole = 'ANALISTA';
    renderSidebar();

    for (const label of P88B_ADMIN_ONLY_LABELS) {
      expect(hasLink(label)).toBe(false);
    }
    // ANALISTA não tem partner:invite → não vê Parceiros também
    expect(hasLink(/^Parceiros$/)).toBe(false);
    // Sanity: itens operacionais intactos
    expect(hasLink(/^Dashboard$/)).toBe(true);
    expect(hasLink(/^Pipeline$/)).toBe(true);
  });

  it('GESTOR NÃO vê itens ADMIN-only mas VÊ Parceiros (tem partner:invite)', () => {
    currentRole = 'GESTOR';
    renderSidebar();

    for (const label of P88B_ADMIN_ONLY_LABELS) {
      expect(hasLink(label)).toBe(false);
    }
    // GESTOR tem partner:invite (default do role) → vê Parceiros
    expect(hasLink(/^Parceiros$/)).toBe(true);
  });

  it('PARCEIRO NÃO vê nada dos 10 items + Parceiros', () => {
    currentRole = 'PARCEIRO';
    renderSidebar();

    for (const label of P88B_ADMIN_ONLY_LABELS) {
      expect(hasLink(label)).toBe(false);
    }
    expect(hasLink(/^Parceiros$/)).toBe(false);
  });

  it('DIRETOR_COMERCIAL NÃO vê itens ADMIN-only mas VÊ Parceiros (tem partner:invite)', () => {
    // DIRETOR_C não tem tenant:update / ai:configure_global / alert:configure /
    // catalog:update — todos os 9 items ADMIN-only ficam escondidos.
    // Tem partner:invite → vê /admin/partners.
    currentRole = 'DIRETOR_COMERCIAL';
    renderSidebar();

    for (const label of P88B_ADMIN_ONLY_LABELS) {
      expect(hasLink(label)).toBe(false);
    }
    expect(hasLink(/^Parceiros$/)).toBe(true);
  });

  it('DIRETOR_OPERACOES NÃO vê itens ADMIN-only mas VÊ Parceiros (tem partner:invite)', () => {
    currentRole = 'DIRETOR_OPERACOES';
    renderSidebar();

    for (const label of P88B_ADMIN_ONLY_LABELS) {
      expect(hasLink(label)).toBe(false);
    }
    expect(hasLink(/^Parceiros$/)).toBe(true);
  });

  it('DIRETOR_FINANCEIRO NÃO vê itens ADMIN-only NEM Parceiros (sem partner:invite)', () => {
    // DIRETOR_F NÃO tem partner:invite — foco em financeiro/auditoria.
    // Também não tem tenant:update / ai:configure_global / alert:configure /
    // catalog:update. Fica sem nenhum item ADMIN-only nem Parceiros.
    currentRole = 'DIRETOR_FINANCEIRO';
    renderSidebar();

    for (const label of P88B_ADMIN_ONLY_LABELS) {
      expect(hasLink(label)).toBe(false);
    }
    expect(hasLink(/^Parceiros$/)).toBe(false);
    // Sanity: DIRETOR_F ainda vê Relatórios (não gated) e Estrutura comercial
    // (tem sales_structure:read por default)
    expect(hasLink(/^Relatórios$/)).toBe(true);
    expect(hasLink(/^Estrutura comercial$/)).toBe(true);
  });

  it('sem role carregado (loading state) mostra todos os itens novos (comportamento permissivo)', () => {
    currentRole = undefined;
    renderSidebar();

    for (const label of P88B_ADMIN_ONLY_LABELS) {
      expect(hasLink(label)).toBe(true);
    }
    expect(hasLink(/^Parceiros$/)).toBe(true);
  });
});
