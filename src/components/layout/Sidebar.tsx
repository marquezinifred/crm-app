'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { cn } from '@/lib/utils/cn';
import { trpc } from '@/lib/trpc/client';
import { hasPermissionByRole } from '@/lib/auth/rbac';
import type { Permission } from '@/lib/auth/permissions-catalog';

/**
 * Sidebar Venzo — Sprint 14.
 *
 * 3 zonas de viewport (P5):
 *  - < 768 mobile: BottomNav, sem sidebar (componente retorna null)
 *  - 768–1023 tablet: variant="overlay" — escondida por padrão,
 *    botão hamburger no topbar abre como sheet sobre o conteúdo
 *  - ≥ 1024 desktop: variant="fixed" — 240px lado a lado com conteúdo,
 *    colapsável para 56px com Cmd+B / Ctrl+B
 *
 * Estrutura: 4 seções (Operação / Documentos / Parceiros / Admin) +
 * logo Venzo + footer com avatar do usuário.
 */

type Variant = 'overlay' | 'fixed';

// Sprint 15E — items opcionalmente gated por permission. Se `permission`
// setada, item só renderiza se `hasPermissionByRole(role, permission)`.
// Ausente = visível a todos os authed (comportamento pré-15E preservado).
// UI é hint apenas — backend re-valida em cada procedure.
type Item = {
  href: string;
  label: string;
  Icon: (p: { className?: string }) => JSX.Element;
  permission?: Permission;
};
type Section = { title: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    title: 'Operação',
    items: [
      { href: '/dashboard', label: 'Dashboard', Icon: IconDashboard },
      { href: '/pipeline', label: 'Pipeline', Icon: IconFunnel },
      { href: '/contacts', label: 'Contatos', Icon: IconUsers },
      { href: '/companies', label: 'Empresas', Icon: IconBuilding },
      { href: '/inbox', label: 'Inbox', Icon: IconMail },
      { href: '/inbox/prospects', label: 'Fila inbound', Icon: IconInbox, permission: 'inbound:view_queue' },
      { href: '/search', label: 'Buscar', Icon: IconSearch },
    ],
  },
  {
    title: 'Documentos',
    items: [
      { href: '/approvals', label: 'Aprovações', Icon: IconCheck },
      { href: '/contracts', label: 'Contratos', Icon: IconWriting },
      { href: '/reports', label: 'Relatórios', Icon: IconChart },
    ],
  },
  {
    title: 'Parceiros',
    items: [
      { href: '/admin/partners', label: 'Parceiros', Icon: IconUsersGroup },
    ],
  },
  {
    title: 'Admin',
    items: [
      { href: '/admin/users', label: 'Usuários', Icon: IconUserCog },
      { href: '/admin/products', label: 'Produtos', Icon: IconPackage },
      { href: '/admin/listas', label: 'Listas', Icon: IconSettings },
      { href: '/admin/billing', label: 'Plano e cobrança', Icon: IconCard },
      { href: '/admin/branding', label: 'Identidade', Icon: IconPalette },
      { href: '/admin/ai', label: 'IA', Icon: IconSparkles },
      { href: '/admin/alerts', label: 'Alertas', Icon: IconBell },
      { href: '/admin/approval-rules', label: 'Regras de aprovação', Icon: IconShield },
      { href: '/admin/contracts', label: 'Config. contratos', Icon: IconSettings },
      { href: '/admin/conversion-rates', label: 'Taxas de conversão', Icon: IconPercent },
      { href: '/admin/email-inbound', label: 'E-mail inbound', Icon: IconAt, permission: 'inbound:configure' },
      { href: '/admin/templates', label: 'Templates', Icon: IconFiles },
      { href: '/admin/privacy', label: 'LGPD', Icon: IconLock },
      { href: '/imports', label: 'Importação', Icon: IconUpload, permission: 'import:run' },
    ],
  },
];

const HIDDEN_ON = [
  '/sign-in', '/sign-up', '/onboarding', '/p/',
  '/privacy-request', '/privacy', '/terms',
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  variant,
  open,
  onClose,
  collapsed,
  onToggleCollapsed,
}: {
  variant: Variant;
  open?: boolean;
  onClose?: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const pathname = usePathname() ?? '/';
  // Sprint 15E — hooks ficam ANTES do early return pra respeitar rules-of-hooks.
  // Filtro condicional baseado no role default. Não considera overrides
  // individuais (backend re-valida). Enquanto `me` carrega, mostramos todos
  // os itens (opção mais permissiva) — o server bloqueará um clique em item
  // que o user não tem permissão.
  const me = trpc.users.me.useQuery(undefined, { staleTime: 60_000 });
  const visibleSections = useMemo(() => {
    const role = me.data?.role;
    if (!role) return SECTIONS;
    return SECTIONS.map((s) => ({
      ...s,
      items: s.items.filter(
        (i) => !i.permission || hasPermissionByRole(role, i.permission),
      ),
    })).filter((s) => s.items.length > 0);
  }, [me.data?.role]);

  if (HIDDEN_ON.some((p) => pathname.startsWith(p))) return null;

  const isOverlay = variant === 'overlay';
  const isCollapsed = !isOverlay && collapsed;
  const widthClass = isOverlay ? 'w-60' : isCollapsed ? 'w-14' : 'w-60';

  return (
    <>
      {isOverlay && open && (
        <div
          role="presentation"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/60 md:block lg:hidden animate-fade-in"
        />
      )}
      <aside
        aria-label="Navegação principal"
        aria-hidden={isOverlay && !open}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-card',
          'transition-[width,transform] duration-200',
          widthClass,
          isOverlay && (open ? 'translate-x-0' : '-translate-x-full'),
          isOverlay ? 'md:flex lg:hidden' : 'hidden lg:flex',
        )}
      >
        {/* Logo */}
        <div className="px-4 py-4 border-b border-border flex items-center justify-between">
          {!isCollapsed && (
            <div>
              <div className="font-extrabold text-[22px] leading-none text-brand-primary-light tracking-tight">
                VENZO
              </div>
              <div className="text-[10px] text-text-3 mt-0.5">CRM B2B</div>
            </div>
          )}
          {!isOverlay && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-expanded={!isCollapsed}
              aria-controls="sidebar-nav"
              aria-label={isCollapsed ? 'Expandir menu lateral' : 'Colapsar menu lateral'}
              title="⌘B / Ctrl+B"
              className="rounded p-1 text-text-2 hover:bg-hover hover:text-text-1"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                {isCollapsed ? (
                  <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
            </button>
          )}
          {isOverlay && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar menu"
              className="rounded p-1 text-text-2 hover:bg-hover hover:text-text-1"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {/* Nav groups */}
        <nav id="sidebar-nav" className="flex-1 overflow-y-auto py-3 px-2">
          {visibleSections.map((section) => (
            <div key={section.title} className="mb-4">
              {!isCollapsed && (
                <div className="px-2 pb-1 text-[10px] uppercase tracking-wider font-semibold text-text-3">
                  {section.title}
                </div>
              )}
              <ul className="space-y-px">
                {section.items.map(({ href, label, Icon }) => {
                  const active = isActive(pathname, href);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        title={isCollapsed ? label : undefined}
                        onClick={isOverlay ? onClose : undefined}
                        className={cn(
                          'flex items-center gap-2.5 px-2.5 py-2 rounded text-[13.5px] font-medium transition-colors',
                          active
                            ? 'bg-brand-primary/12 text-brand-primary-light border-l-2 border-brand-primary -ml-0.5 pl-[10px]'
                            : 'text-text-2 hover:bg-hover hover:text-text-1',
                          isCollapsed && 'justify-center px-2',
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0 opacity-80" />
                        {!isCollapsed && <span className="truncate">{label}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}

/* ---------------- Ícones inline (estilo Tabler — stroke 1.8) ---------------- */
function I(props: { className?: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={props.className} aria-hidden="true" strokeLinecap="round" strokeLinejoin="round">
      {props.children}
    </svg>
  );
}
function IconDashboard(p: { className?: string }) { return <I {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></I>; }
function IconFunnel(p: { className?: string }) { return <I {...p}><path d="M4 5h16l-6 8v6l-4-2v-4z"/></I>; }
function IconUsers(p: { className?: string }) { return <I {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></I>; }
function IconBuilding(p: { className?: string }) { return <I {...p}><path d="M3 21V7l9-4 9 4v14"/><path d="M9 21V12h6v9"/></I>; }
function IconMail(p: { className?: string }) { return <I {...p}><path d="M4 6h16v12H4z"/><path d="M4 6l8 7 8-7"/></I>; }
function IconInbox(p: { className?: string }) { return <I {...p}><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></I>; }
function IconSearch(p: { className?: string }) { return <I {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></I>; }
function IconCheck(p: { className?: string }) { return <I {...p}><path d="M5 13l4 4L19 7"/></I>; }
function IconWriting(p: { className?: string }) { return <I {...p}><path d="M14 4l6 6-10 10H4v-6z"/></I>; }
function IconChart(p: { className?: string }) { return <I {...p}><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></I>; }
function IconUsersGroup(p: { className?: string }) { return <I {...p}><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 14h2a3 3 0 0 1 3 3v1"/></I>; }
function IconUserCog(p: { className?: string }) { return <I {...p}><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4"/><circle cx="18" cy="16" r="3"/><path d="M18 11v1M18 20v1M22.4 13.4l-.7.7M14.3 18.7l-.7.7M23 16h-1M14 16h-1M22.4 18.7l-.7-.7M14.3 13.4l-.7-.7"/></I>; }
function IconPackage(p: { className?: string }) { return <I {...p}><path d="M12 2l9 4v12l-9 4-9-4V6z"/><path d="M3 6l9 4 9-4M12 10v12"/></I>; }
function IconCard(p: { className?: string }) { return <I {...p}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></I>; }
function IconPalette(p: { className?: string }) { return <I {...p}><path d="M12 22a10 10 0 1 1 0-20c5 0 9 3.5 9 8 0 3-2.5 4-5 4h-2a2 2 0 0 0-2 2 2 2 0 0 0 .5 1.3A2 2 0 0 1 12 22z"/><circle cx="7" cy="11" r="1"/><circle cx="9.5" cy="6.5" r="1"/><circle cx="14.5" cy="6.5" r="1"/></I>; }
function IconSparkles(p: { className?: string }) { return <I {...p}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M19 14l.7 1.9 1.9.6-1.9.7-.7 1.8-.7-1.8-1.9-.7 1.9-.6z"/></I>; }
function IconBell(p: { className?: string }) { return <I {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8z"/><path d="M10 21a2 2 0 0 0 4 0"/></I>; }
function IconShield(p: { className?: string }) { return <I {...p}><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/></I>; }
function IconSettings(p: { className?: string }) { return <I {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></I>; }
function IconPercent(p: { className?: string }) { return <I {...p}><circle cx="7" cy="7" r="2"/><circle cx="17" cy="17" r="2"/><path d="M19 5L5 19"/></I>; }
function IconAt(p: { className?: string }) { return <I {...p}><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></I>; }
function IconFiles(p: { className?: string }) { return <I {...p}><path d="M9 3h7l5 5v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M16 3v5h5"/></I>; }
function IconLock(p: { className?: string }) { return <I {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></I>; }
function IconUpload(p: { className?: string }) { return <I {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/></I>; }
