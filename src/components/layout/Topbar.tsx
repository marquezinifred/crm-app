'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

const HIDDEN_ON = [
  '/sign-in', '/sign-up', '/onboarding', '/p/',
  '/privacy-request', '/privacy', '/terms',
];

/**
 * Topbar Venzo — Sprint 14.
 *
 * Desktop/tablet: 56px com breadcrumb + busca global + theme toggle.
 * Mobile: 48px com título + ThemeToggle.
 */
export function Topbar({
  variant,
  onOpenMenu,
}: {
  variant: 'mobile' | 'tablet' | 'desktop';
  onOpenMenu: () => void;
}) {
  const pathname = usePathname() ?? '/';
  if (HIDDEN_ON.some((p) => pathname.startsWith(p))) return null;

  const crumbs = breadcrumbsFor(pathname);
  const heightClass = variant === 'mobile' ? 'h-12' : 'h-14';

  return (
    <header
      className={`${heightClass} sticky top-0 z-30 border-b border-border bg-page flex items-center gap-3 px-4 md:px-6`}
    >
      {variant !== 'desktop' && (
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Abrir menu"
          className="rounded p-1.5 text-text-2 hover:bg-hover hover:text-text-1 lg:hidden"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
          </svg>
        </button>
      )}

      <nav aria-label="Trilha" className="flex items-center gap-1.5 text-[13px] min-w-0">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={c.href} className="flex items-center gap-1.5 min-w-0">
              {i > 0 && <span className="text-text-3" aria-hidden="true">›</span>}
              {last ? (
                <span className="text-text-1 font-medium truncate" aria-current="page">{c.label}</span>
              ) : (
                <Link href={c.href} className="text-text-2 hover:text-text-1 truncate">{c.label}</Link>
              )}
            </span>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {variant === 'desktop' && (
          <button
            type="button"
            aria-label="Buscar (Cmd+K)"
            className="hidden lg:flex items-center gap-2 h-8 px-3 rounded border border-border bg-card text-text-3 text-[13px] hover:border-border-strong w-64"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
            </svg>
            <span className="flex-1 text-left">Buscar...</span>
            <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-hover border border-border font-mono">⌘K</kbd>
          </button>
        )}
        <ThemeToggle />
        <UserButton
          afterSignOutUrl="/sign-in"
          appearance={{
            elements: {
              avatarBox: 'h-7 w-7',
            },
          }}
        />
      </div>
    </header>
  );
}

const LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  pipeline: 'Pipeline',
  inbox: 'Inbox',
  search: 'Buscar',
  contacts: 'Contatos',
  companies: 'Empresas',
  approvals: 'Aprovações',
  contracts: 'Contratos',
  reports: 'Relatórios',
  imports: 'Importação',
  more: 'Mais',
  admin: 'Admin',
  users: 'Usuários',
  products: 'Produtos',
  billing: 'Cobrança',
  branding: 'Identidade',
  ai: 'IA',
  alerts: 'Alertas',
  'approval-rules': 'Regras de aprovação',
  'conversion-rates': 'Taxas de conversão',
  'email-inbound': 'E-mail inbound',
  partners: 'Parceiros',
  templates: 'Templates',
  privacy: 'LGPD',
  onboarding: 'Onboarding',
  setup: 'Setup',
};

function breadcrumbsFor(pathname: string): Array<{ label: string; href: string }> {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return [{ label: 'Início', href: '/' }];
  const out: Array<{ label: string; href: string }> = [];
  let acc = '';
  for (const seg of segments) {
    acc += `/${seg}`;
    out.push({ label: LABELS[seg] ?? capitalize(seg), href: acc });
  }
  return out;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
