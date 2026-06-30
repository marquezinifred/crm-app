'use client';

import { useEffect, useRef } from 'react';

/**
 * Sprint 15C — Auto-focus no primeiro campo quando um modal/sheet abre.
 *
 *   const ref = useAutoFocus<HTMLInputElement>(open)
 *   <Input ref={ref} ... />
 *
 * O `Modal` já chama focus no primeiro focusable; este hook é útil
 * quando o focusable desejado NÃO é o primeiro (ex: botão Cancelar
 * vem antes do form no DOM).
 */
export function useAutoFocus<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => ref.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [open]);
  return ref;
}
