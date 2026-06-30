'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

type ToastKind = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  duration?: number;
}

type Ctx = {
  toast: (t: Omit<ToastItem, 'id'>) => string;
  dismiss: (id: string) => void;
};

const ToastContext = React.createContext<Ctx | null>(null);

export function useToast(): Ctx {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast deve estar dentro de <ToastProvider>');
  return ctx;
}

const KIND_STYLE: Record<ToastKind, { border: string; live: 'polite' | 'assertive'; icon: React.ReactNode }> = {
  success: { border: 'border-l-success', live: 'polite', icon: <IconCheck /> },
  error: { border: 'border-l-danger', live: 'assertive', icon: <IconX /> },
  warning: { border: 'border-l-warning', live: 'polite', icon: <IconAlert /> },
  info: { border: 'border-l-info', live: 'polite', icon: <IconInfo /> },
};

function genId(): string {
  return `t_${Math.random().toString(36).slice(2, 9)}_${performance.now().toFixed(0)}`;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setItems((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback<Ctx['toast']>((t) => {
    const id = genId();
    const duration = t.duration ?? (t.kind === 'error' ? 0 : t.kind === 'warning' ? 6000 : 4000);
    setItems((cur) => {
      const next = [...cur, { ...t, id }];
      return next.slice(-3); // máx 3 visíveis
    });
    if (duration > 0) setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none md:items-end items-stretch md:max-w-sm w-[calc(100%-3rem)]"
      >
        {items.map((it) => (
          <ToastItem key={it.id} item={it} onClose={() => dismiss(it.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const style = KIND_STYLE[item.kind];
  return (
    <div
      role={item.kind === 'error' ? 'alert' : 'status'}
      aria-live={style.live}
      className={cn(
        'pointer-events-auto flex items-start gap-3 bg-card border border-border border-l-[3px] rounded-md p-3 shadow-lg animate-slide-in-right min-w-[280px]',
        style.border,
      )}
    >
      <span className="shrink-0 mt-0.5">{style.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-semibold text-text-1">{item.title}</p>
        {item.description && (
          <p className="text-caption text-text-2 mt-0.5">{item.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="shrink-0 text-text-3 hover:text-text-1 p-0.5"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function IconCheck() { return <svg viewBox="0 0 24 24" className="h-4 w-4 text-success" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function IconX() { return <svg viewBox="0 0 24 24" className="h-4 w-4 text-danger" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round"/></svg>; }
function IconAlert() { return <svg viewBox="0 0 24 24" className="h-4 w-4 text-warning" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M10.3 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01" strokeLinecap="round"/></svg>; }
function IconInfo() { return <svg viewBox="0 0 24 24" className="h-4 w-4 text-info" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01" strokeLinecap="round"/></svg>; }
