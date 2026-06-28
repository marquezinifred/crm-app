'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

const ITEMS = [
  { href: '/pipeline', label: 'Pipeline', icon: PipelineIcon },
  { href: '/inbox', label: 'Inbox', icon: InboxIcon },
  { href: '/search', label: 'Buscar', icon: SearchIcon },
  { href: '/dashboard', label: 'Dashboard', icon: DashIcon },
  { href: '/more', label: 'Mais', icon: MoreIcon },
] as const;

const HIDDEN_ON = ['/sign-in', '/sign-up', '/onboarding', '/p/'];

export function BottomNav() {
  const pathname = usePathname() ?? '/';
  if (HIDDEN_ON.some((p) => pathname.startsWith(p))) return null;

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-neutral-200 bg-white/95 backdrop-blur md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {ITEMS.map((it) => {
        const active = pathname.startsWith(it.href);
        const Icon = it.icon;
        return (
          <Link
            key={it.href}
            href={it.href}
            className={cn(
              'flex flex-1 flex-col items-center justify-center py-2 text-[11px]',
              'min-h-[48px]',
              active ? 'text-neutral-900' : 'text-neutral-500',
            )}
          >
            <Icon className="mb-0.5 h-5 w-5" aria-hidden="true" />
            <span>{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function PipelineIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M3 6h4v12H3zM10 4h4v16h-4zM17 9h4v9h-4z" strokeLinejoin="round" />
    </svg>
  );
}
function InboxIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M3 13l3-9h12l3 9M3 13v6a2 2 0 002 2h14a2 2 0 002-2v-6M3 13h5l1 2h6l1-2h5" strokeLinejoin="round" />
    </svg>
  );
}
function SearchIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" />
    </svg>
  );
}
function DashIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" />
    </svg>
  );
}
function MoreIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
    </svg>
  );
}
