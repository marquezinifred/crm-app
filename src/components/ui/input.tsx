import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Input Venzo — Sprint 14. 6 estados (default/hover/focus/filled/error/disabled).
 * Altura 40px, padding 0 12px. Label deve ser associado externamente via
 * <Field> ou <label htmlFor> pra manter a11y.
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, ...props }, ref) => (
    <input
      ref={ref}
      type={type ?? 'text'}
      aria-invalid={error || undefined}
      className={cn(
        'h-10 w-full rounded border bg-card px-3 text-[14px] text-text-1 placeholder:text-text-3',
        'transition-colors hover:border-border-strong',
        'focus:border-brand-primary focus:outline-none focus:ring-[3px] focus:ring-brand-primary/20',
        'disabled:bg-hover disabled:cursor-not-allowed disabled:opacity-60',
        error
          ? 'border-danger focus:border-danger focus:ring-danger/20'
          : 'border-border',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean }>(
  ({ className, error, rows = 4, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={error || undefined}
      className={cn(
        'min-h-[96px] w-full rounded border bg-card px-3 py-2 text-[14px] text-text-1 placeholder:text-text-3',
        'transition-colors resize-y hover:border-border-strong',
        'focus:border-brand-primary focus:outline-none focus:ring-[3px] focus:ring-brand-primary/20',
        'disabled:bg-hover disabled:cursor-not-allowed disabled:opacity-60',
        error ? 'border-danger focus:border-danger focus:ring-danger/20' : 'border-border',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { error?: boolean }>(
  ({ className, error, children, ...props }, ref) => (
    <select
      ref={ref}
      aria-invalid={error || undefined}
      className={cn(
        'h-10 w-full rounded border bg-card pl-3 pr-8 text-[14px] text-text-1 appearance-none',
        'bg-[length:14px_14px] bg-[right_0.75rem_center] bg-no-repeat',
        'transition-colors hover:border-border-strong',
        'focus:border-brand-primary focus:outline-none focus:ring-[3px] focus:ring-brand-primary/20',
        'disabled:bg-hover disabled:cursor-not-allowed disabled:opacity-60',
        error ? 'border-danger focus:border-danger focus:ring-danger/20' : 'border-border',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
      }}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';
