'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils/cn';

/**
 * Modal Venzo — Sprint 15G refactor.
 *
 * Antes: implementação custom com backdrop + `onClick={stopPropagation}` +
 * focus trap manual. Problema descoberto no Sprint 15G Fase 4a: quando o
 * Modal era aberto em cima de um `<Sheet>` (Radix Dialog), o Radix
 * detectava pointerdown/focus "fora" do Content da Sheet e a fechava —
 * o Modal (renderizado condicional) desaparecia junto.
 *
 * Agora: usa `@radix-ui/react-dialog` internamente. Radix suporta
 * dialogs empilhados nativamente (o de cima "gancha" os eventos e o
 * de baixo não fecha). API pública mantida idêntica pra evitar
 * refactor em todos os callers (12+ modais).
 *
 * P-12 (foco roubado a cada keystroke) fica resolvido "de graça" —
 * Radix não tem esse bug porque o focus manager dele não depende de
 * closure identity dos props.
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
  const maxW =
    size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg';

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-[70] bg-black/60',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:duration-200 data-[state=closed]:duration-150',
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[80] w-full -translate-x-1/2 -translate-y-1/2',
            'bg-card border border-border rounded-lg p-6 shadow-2xl',
            'max-h-[90vh] overflow-y-auto',
            'focus-visible:outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
            'data-[state=open]:duration-200 data-[state=closed]:duration-150',
            maxW,
          )}
        >
          <header className="flex items-start justify-between gap-3 mb-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-h3 text-text-1">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-body text-text-2 mt-1">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label="Fechar"
              className="shrink-0 text-text-2 hover:text-text-1 hover:bg-hover p-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </DialogPrimitive.Close>
          </header>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
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
