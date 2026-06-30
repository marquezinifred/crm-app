'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

const ITEMS = [
  { href: '/dashboard', label: 'Início', Icon: IconHome },
  { href: '/pipeline', label: 'Pipeline', Icon: IconFunnel },
  { href: '/inbox', label: 'Inbox', Icon: IconMail, badgeKey: 'inbox' },
  { href: '/dashboard#alerts', label: 'Alertas', Icon: IconBell, badgeKey: 'alerts' },
  { href: '/more', label: 'Mais', Icon: IconDots },
] as const;

const HIDDEN_ON = [
  '/sign-in', '/sign-up', '/onboarding', '/p/',
  '/privacy-request', '/privacy', '/terms',
];

export function BottomNav() {
  const pathname = usePathname() ?? '/';
  if (HIDDEN_ON.some((p) => pathname.startsWith(p))) return null;

  return (
    <nav
      aria-label="Navegação inferior"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {ITEMS.map(({ href, label, Icon }) => {
        const active = pathname.startsWith(href.split('#')[0]!);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 min-h-[48px] text-[11px] font-medium',
              active
                ? 'text-brand-primary-light bg-brand-primary/12'
                : 'text-text-2',
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function IconHome(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={props.className} aria-hidden="true">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/>
    </svg>
  );
}
function IconFunnel(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={props.className} aria-hidden="true">
      <path d="M4 5h16l-6 8v6l-4-2v-4z" strokeLinejoin="round"/>
    </svg>
  );
}
function IconMail(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={props.className} aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 7l9 7 9-7"/>
    </svg>
  );
}
function IconBell(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={props.className} aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8z"/><path d="M10 21a2 2 0 0 0 4 0"/>
    </svg>
  );
}
function IconDots(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={props.className} aria-hidden="true">
      <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
    </svg>
  );
}
