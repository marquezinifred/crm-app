'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import type { SortDir } from '@/lib/hooks/useTableSort';

/**
 * DataTable Venzo — Sprint 14.
 *
 * Header 13px uppercase tracking 0.06em. Linha 48px hover bg.
 * Em viewport <768 a tabela vira cards empilhados automaticamente
 * (via prop `mobile` controlando uma renderização paralela). Para
 * keep it simple aqui exponho apenas estilos consistentes — a
 * conversão para cards é responsabilidade do consumidor (DataTable
 * full em sprints futuros).
 *
 * P-17: `<TH sortable sortState onSort>` habilita ordenamento clicável
 * com chevrons visuais e a11y (aria-sort + tecla Enter/Space).
 */

export function Table({ className, children, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto border border-border rounded-md">
      <table className={cn('w-full border-collapse text-[13.5px]', className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function THead(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} className={cn('bg-hover', props.className)} />;
}

export interface THProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortable?: boolean;
  sortState?: SortDir | null;
  onSort?: () => void;
}

export function TH({
  children,
  sortable,
  sortState = null,
  onSort,
  ...props
}: THProps) {
  const baseClass =
    'text-left px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-text-2 border-b border-border whitespace-nowrap';

  if (!sortable) {
    return (
      <th scope="col" {...props} className={cn(baseClass, props.className)}>
        {children}
      </th>
    );
  }

  const ariaSort: React.AriaAttributes['aria-sort'] =
    sortState === 'asc'
      ? 'ascending'
      : sortState === 'desc'
      ? 'descending'
      : 'none';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTableCellElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSort?.();
    }
    props.onKeyDown?.(e);
  };

  return (
    <th
      scope="col"
      role="columnheader"
      aria-sort={ariaSort}
      tabIndex={0}
      {...props}
      onClick={(e) => {
        onSort?.();
        props.onClick?.(e);
      }}
      onKeyDown={handleKeyDown}
      className={cn(
        baseClass,
        'cursor-pointer select-none hover:text-text-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-inset',
        sortState && 'text-text-1',
        props.className,
      )}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <SortIcon state={sortState} />
      </span>
    </th>
  );
}

function SortIcon({ state }: { state: SortDir | null }) {
  if (state === 'asc') {
    return (
      <svg
        viewBox="0 0 12 12"
        aria-hidden="true"
        className="h-3 w-3 text-brand-primary-light"
      >
        <path d="M6 3l4 5H2z" fill="currentColor" />
      </svg>
    );
  }
  if (state === 'desc') {
    return (
      <svg
        viewBox="0 0 12 12"
        aria-hidden="true"
        className="h-3 w-3 text-brand-primary-light"
      >
        <path d="M6 9L2 4h8z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className="h-3 w-3 text-text-3"
    >
      <path d="M6 2l3 3H3z" fill="currentColor" />
      <path d="M6 10l3-3H3z" fill="currentColor" />
    </svg>
  );
}

export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TR(props: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      {...props}
      className={cn(
        'border-b border-border last:border-0 hover:bg-hover transition-colors',
        props.className,
      )}
    />
  );
}

export function TD(props: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      {...props}
      className={cn('px-4 py-3 text-text-1 align-middle', props.className)}
    />
  );
}

/**
 * Empty state row pra usar dentro de uma tabela.
 */
export function TableEmpty({
  colSpan,
  children,
}: {
  colSpan: number;
  children: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-12 text-center text-text-2">
        {children}
      </td>
    </tr>
  );
}

export function TableSkeleton({ cols = 4, rows = 5 }: { cols?: number; rows?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-border">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <div className="skeleton h-4 w-full max-w-[160px]" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}
