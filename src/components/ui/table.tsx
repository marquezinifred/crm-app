'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * DataTable Venzo — Sprint 14.
 *
 * Header 13px uppercase tracking 0.06em. Linha 48px hover bg.
 * Em viewport <768 a tabela vira cards empilhados automaticamente
 * (via prop `mobile` controlando uma renderização paralela). Para
 * keep it simple aqui exponho apenas estilos consistentes — a
 * conversão para cards é responsabilidade do consumidor (DataTable
 * full em sprints futuros).
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

export function TH({ children, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      {...props}
      className={cn(
        'text-left px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-text-2 border-b border-border whitespace-nowrap',
        props.className,
      )}
    >
      {children}
    </th>
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
