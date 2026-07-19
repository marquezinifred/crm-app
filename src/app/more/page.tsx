'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { trpc } from '@/lib/trpc/client';
import { hasPermissionByRole } from '@/lib/auth/rbac';
import type { Permission } from '@/lib/auth/permissions-catalog';

/**
 * P-97 — Cada item admin é opcionalmente gated por `permission`, espelhando
 * 1:1 a Sidebar (src/components/layout/Sidebar.tsx, pós P-88/P-88b). Defesa
 * em profundidade UI: o backend re-valida em cada procedure (adminOnlyProcedure
 * / withPermission). Items sem `permission` seguem visíveis a todo usuário
 * autenticado (comportamento pré-fix preservado — paridade com a Sidebar).
 *
 * As permissions foram conferidas contra `permissions-catalog.ts` E contra o
 * que a Sidebar realmente usa hoje por rota — NÃO inventar permission nova.
 * Nota: /admin/alerts usa `alert:configure` (não `tenant:update`) pra bater
 * com a Sidebar. Os 3 items novos (Listas, Estrutura comercial, Inbound
 * rejeitados) fecham a paridade da seção Admin com a Sidebar.
 */
type MoreLink = { href: string; label: string; permission?: Permission };

const LINKS: MoreLink[] = [
  // Operação — sem gate (visíveis a todo authenticated, igual à Sidebar).
  { href: '/companies', label: 'Empresas' },
  { href: '/contacts', label: 'Contatos' },
  { href: '/reports', label: 'Relatórios' },
  { href: '/contracts', label: 'Contratos' },
  { href: '/approvals', label: 'Aprovações' },
  { href: '/imports', label: 'Importação', permission: 'import:run' },
  // Admin — gated com a mesma permission que a Sidebar aplica por rota.
  { href: '/admin/users', label: 'Admin · Usuários', permission: 'user:update' },
  { href: '/admin/products', label: 'Admin · Produtos', permission: 'catalog:update' },
  { href: '/admin/listas', label: 'Admin · Listas', permission: 'catalog:update' },
  { href: '/admin/commercial-structure', label: 'Admin · Estrutura comercial', permission: 'sales_structure:read' },
  { href: '/admin/billing', label: 'Admin · Plano e cobrança', permission: 'tenant:update' },
  { href: '/admin/branding', label: 'Admin · Identidade', permission: 'tenant:update' },
  { href: '/admin/alerts', label: 'Admin · Alertas', permission: 'alert:configure' },
  { href: '/admin/ai', label: 'Admin · IA', permission: 'ai:configure_global' },
  { href: '/admin/conversion-rates', label: 'Admin · Taxas de conversão', permission: 'tenant:update' },
  { href: '/admin/approval-rules', label: 'Admin · Regras de aprovação', permission: 'tenant:update' },
  { href: '/admin/contracts', label: 'Admin · Contratos', permission: 'tenant:update' },
  { href: '/admin/partners', label: 'Admin · Parceiros', permission: 'partner:invite' },
  { href: '/admin/templates', label: 'Admin · Templates', permission: 'catalog:update' },
  { href: '/admin/email-inbound', label: 'Admin · E-mail Inbound', permission: 'inbound:configure' },
  { href: '/admin/inbound-rejected', label: 'Admin · Inbound rejeitados', permission: 'inbound:configure' },
  { href: '/admin/privacy', label: 'Admin · Solicitações LGPD', permission: 'tenant:update' },
];

const SKELETON_KEYS = ['s0', 's1', 's2', 's3', 's4', 's5'] as const;

/**
 * /more — usado apenas em mobile (<md). No desktop a Sidebar substitui esta
 * página e o BottomNav que linka pra cá fica oculto via `md:hidden`. Mantemos
 * o conteúdo acessível por URL direta (deep link / e2e) com um aviso visual
 * em viewport grande.
 */
export default function MorePage() {
  // P-97 — hooks ANTES de qualquer early return (rules-of-hooks). Filtro por
  // role default (backend re-valida). Diferente da Sidebar (que é permissiva
  // no loading), aqui NÃO piscamos a lista completa: enquanto `me` carrega
  // mostramos skeleton; se o role não resolver, só os items sem gate aparecem.
  const me = trpc.users.me.useQuery(undefined, { staleTime: 60_000 });
  const role = me.data?.role;
  const visible = useMemo(
    () =>
      LINKS.filter(
        (l) => !l.permission || (role ? hasPermissionByRole(role, l.permission) : false),
      ),
    [role],
  );

  return (
    <main className="mx-auto max-w-3xl p-4 md:p-6">
      <PageHeader
        title="Mais"
        description="Configurações e ferramentas adicionais."
      />
      <p className="hidden md:block text-sm text-text-2 mb-4">
        Esta página é otimizada para mobile. No desktop, use o menu lateral à esquerda.
      </p>
      {me.isLoading ? (
        <ul className="space-y-1" aria-hidden="true" data-testid="more-skeleton">
          {SKELETON_KEYS.map((k) => (
            <li
              key={k}
              className="h-11 rounded-lg border border-border bg-card animate-pulse"
            />
          ))}
        </ul>
      ) : (
        <ul className="space-y-1">
          {visible.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="block rounded-lg border border-border bg-card p-3 text-sm hover:bg-page focus-visible:ring-2 focus-visible:ring-brand"
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
