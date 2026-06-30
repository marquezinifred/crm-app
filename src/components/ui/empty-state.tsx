import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Empty state Venzo — ícone 48px + título + descrição + CTA.
 *
 * Copy padrão segue o brand guide: "[Entidade] aparecerá aqui." —
 * NUNCA "Nenhum registro encontrado".
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center py-12 px-6', className)}>
      {icon && <div className="text-text-3 mb-3" aria-hidden="true">{icon}</div>}
      <h3 className="text-h3 text-text-1">{title}</h3>
      {description && (
        <p className="text-body text-text-2 mt-1.5 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = 'Algo saiu errado.',
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      icon={
        <svg viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M10.3 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeLinejoin="round"/>
          <path d="M12 9v4M12 17h.01" strokeLinecap="round"/>
        </svg>
      }
      title={title}
      description={description ?? 'Tente novamente. Se persistir, contate o suporte.'}
      action={
        onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded bg-brand-primary text-white font-semibold text-[13.5px] hover:bg-brand-primary-mid"
          >
            Tentar novamente
          </button>
        )
      }
    />
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="skeleton h-4 flex-1" />
      <div className="skeleton h-4 w-24" />
      <div className="skeleton h-4 w-16" />
    </div>
  );
}
