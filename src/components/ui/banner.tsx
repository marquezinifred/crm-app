'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Banner contextual Venzo — Sprint 14.5 (spec §7.3).
 *
 * Base reutilizável para banners de manutenção, offline, past due, trial.
 * Cor por variante (info/warning/danger). Ícone padrão por variante ou
 * customizável. Dismissible opcional. `aria-live="polite"` para anúncios
 * não críticos; consumidor de variant=danger deve usar `role="alert"`
 * próprio (ex.: PastDueBanner).
 */

type BannerVariant = 'info' | 'warning' | 'danger';

const VARIANT: Record<BannerVariant, { bg: string; text: string; border: string; defaultIcon: React.ReactNode }> = {
  info: {
    bg: 'bg-info-bg',
    text: 'text-info-text',
    border: 'border-info/30',
    defaultIcon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
      </svg>
    ),
  },
  warning: {
    bg: 'bg-warning-bg',
    text: 'text-warning-text',
    border: 'border-warning/30',
    defaultIcon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M10.3 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeLinejoin="round" />
        <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
      </svg>
    ),
  },
  danger: {
    bg: 'bg-danger-bg',
    text: 'text-danger-text',
    border: 'border-danger/30',
    defaultIcon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M15 9l-6 6M9 9l6 6" strokeLinecap="round" />
      </svg>
    ),
  },
};

export function Banner({
  variant,
  icon,
  children,
  action,
  dismissible = false,
  onDismiss,
  className,
}: {
  variant: BannerVariant;
  icon?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
  className?: string;
}) {
  const v = VARIANT[variant];
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-3 border-b px-4 py-2 text-[13.5px]',
        v.bg, v.text, v.border,
        className,
      )}
    >
      <span className="shrink-0">{icon ?? v.defaultIcon}</span>
      <div className="flex-1 min-w-0">{children}</div>
      {action}
      {dismissible && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dispensar aviso"
          className="shrink-0 rounded p-1 hover:bg-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
