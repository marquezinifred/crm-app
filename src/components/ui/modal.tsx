'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Modal Venzo — Sprint 14.
 *
 * `role="dialog"` + `aria-modal="true"` + focus trap simples (Tab cicla
 * dentro). Escape fecha. Ação destrutiva (`tone="danger"`) usa botão
 * danger — nunca primary. Ordem de botões: Cancelar antes de Confirmar.
 */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const titleId = React.useId();
  const descId = React.useId();
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const previouslyFocused = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusables?.[0]?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && focusables && focusables.length > 0) {
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = '';
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const maxW =
    size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg';

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4 animate-fade-in"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        onClick={(e) => e.stopPropagation()}
        className={cn('bg-card border border-border rounded-lg w-full p-6 shadow-2xl', maxW)}
      >
        <header className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-h3 text-text-1">{title}</h2>
            {description && (
              <p id={descId} className="text-body text-text-2 mt-1">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 text-text-2 hover:text-text-1 hover:bg-hover p-1 rounded"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function ModalFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex justify-end gap-2 mt-6', className)}>
      {children}
    </div>
  );
}
