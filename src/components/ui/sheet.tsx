'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils/cn';

/**
 * Sheet Venzo — Sprint 14.5 (spec §6.4).
 *
 * Wrapper sobre `@radix-ui/react-dialog`. Variants:
 *  - `right` (desktop ≥ md): slide-in da direita, 400px, h-full
 *  - `bottom` (mobile): slide-up do rodapé, 85vh, rounded-t-2xl com handle
 *
 * Swipe-down NÃO é suportado (sem framer-motion). Fechar via:
 *  - botão X (rendered no `SheetHeader`)
 *  - clique no overlay
 *  - Escape
 *  - back do navegador (via intercepting route do consumidor)
 *
 * Mantém role="dialog" + aria-modal="true" + focus trap via Radix.
 */

type SheetVariant = 'right' | 'bottom';

export const SheetRoot = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

interface SheetProps extends React.ComponentProps<typeof DialogPrimitive.Content> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: SheetVariant;
}

export function Sheet({
  open,
  onOpenChange,
  variant = 'right',
  children,
  className,
  ...props
}: SheetProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:duration-300 data-[state=closed]:duration-200',
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed z-50 flex flex-col bg-card shadow-2xl focus-visible:outline-none',
            variant === 'right' && [
              'right-0 top-0 h-full w-full md:w-[400px]',
              'border-l border-border',
              'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
            ],
            variant === 'bottom' && [
              'inset-x-0 bottom-0 h-[85vh] rounded-t-xl',
              'border-t border-border',
              'data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
            ],
            'data-[state=open]:animate-in data-[state=closed]:animate-out duration-300',
            className,
          )}
          {...props}
        >
          {variant === 'bottom' && (
            <div className="flex justify-center pt-2 pb-1" aria-hidden="true">
              <div className="h-1 w-10 rounded-full bg-border" />
            </div>
          )}
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function SheetHeader({
  title,
  status,
  rightAction,
  onClose,
}: {
  title: string;
  status?: React.ReactNode;
  rightAction?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
      <div className="min-w-0">
        <DialogPrimitive.Title className="line-clamp-2 text-h3 text-text-1">
          {title}
        </DialogPrimitive.Title>
        {status && <div className="mt-1">{status}</div>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {rightAction}
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="flex h-8 w-8 items-center justify-center rounded text-text-2 hover:bg-hover hover:text-text-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}

export function SheetBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('flex-1 overflow-y-auto px-5 py-4', className)}>{children}</div>;
}
