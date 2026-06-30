import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * PageHeader Venzo — Sprint 14.5 (item 4).
 *
 * Padrão consistente entre as 25+ telas internas: título h1 + descrição
 * + ação primária no canto direito. Em mobile, ação cai abaixo do título.
 */
export function PageHeader({
  title,
  description,
  primaryAction,
  secondaryAction,
  meta,
  className,
}: {
  title: string;
  description?: string;
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-6 flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="text-h1 text-text-1">{title}</h1>
        {description && (
          <p className="mt-1 text-body text-text-2 max-w-prose">{description}</p>
        )}
        {meta && <div className="mt-2 text-caption text-text-3">{meta}</div>}
      </div>
      {(primaryAction || secondaryAction) && (
        <div className="flex items-center gap-2">
          {secondaryAction}
          {primaryAction}
        </div>
      )}
    </header>
  );
}
