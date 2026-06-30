'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

const ITEMS = [
  { href: '/platform/dashboard', label: 'Visão geral' },
  { href: '/platform/tenants', label: 'Tenants' },
  { href: '/platform/impersonate', label: 'Impersonar' },
  { href: '/platform/audit', label: 'Audit log' },
  { href: '/platform/privacy', label: 'Privacy (LGPD)' },
  { href: '/platform/feature-flags', label: 'Feature flags' },
];

/**
 * PlatformShell — Sprint 15A.
 *
 * Layout dedicado para o Platform Owner. Sidebar fixa simples (sem
 * BottomNav, sem ContextBanners). Banner persistente vermelho no topo
 * deixa explícito que o usuário está no console da plataforma.
 */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';

  return (
    <div className="min-h-screen bg-page">
      <div className="bg-danger text-white px-4 py-1.5 text-caption font-semibold flex items-center justify-between">
        <span>Console da Plataforma · Acesso restrito a Platform Owners.</span>
        <Link href="/" className="underline">Sair do console</Link>
      </div>
      <div className="flex">
        <aside className="hidden md:flex md:flex-col w-60 min-h-[calc(100vh-2rem)] border-r border-border bg-card">
          <div className="px-4 py-4 border-b border-border">
            <div className="text-[22px] font-black tracking-tight text-brand-primary-light">VENZO</div>
            <div className="text-[10px] text-text-3">Platform Console</div>
          </div>
          <nav className="flex-1 py-3 px-2">
            <ul className="space-y-0.5">
              {ITEMS.map((it) => {
                const active = pathname.startsWith(it.href);
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 rounded text-[13.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary',
                        active
                          ? 'bg-brand-primary/12 text-brand-primary-light border-l-2 border-brand-primary -ml-0.5 pl-[10px]'
                          : 'text-text-2 hover:bg-hover hover:text-text-1',
                      )}
                    >
                      {it.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>
        <main id="main-content" className="flex-1 min-w-0 px-4 md:px-8 py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
