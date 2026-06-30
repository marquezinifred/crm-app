'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Checkbox / Radio / Switch Venzo — touch target ≥ 44×44 via padding invisível.
 */

export const Checkbox = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        'h-4 w-4 rounded border border-border bg-card text-brand-primary',
        'focus:ring-[3px] focus:ring-brand-primary/30 focus:ring-offset-0',
        'checked:bg-brand-primary checked:border-brand-primary',
        'disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Checkbox.displayName = 'Checkbox';

export const Radio = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="radio"
      className={cn(
        'h-4 w-4 rounded-full border border-border bg-card text-brand-primary',
        'focus:ring-[3px] focus:ring-brand-primary/30 focus:ring-offset-0',
        'checked:bg-brand-primary checked:border-brand-primary',
        'disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Radio.displayName = 'Radio';

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
}

/** Switch acessível via `input[type="checkbox"]` com aparência custom. */
export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, label, id: idProp, checked, defaultChecked, disabled, ...props }, ref) => {
    const id = React.useId();
    const inputId = idProp ?? id;
    return (
      <label htmlFor={inputId} className={cn('inline-flex items-center gap-2 cursor-pointer', disabled && 'cursor-not-allowed opacity-50', className)}>
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          role="switch"
          className="sr-only peer"
          checked={checked}
          defaultChecked={defaultChecked}
          disabled={disabled}
          {...props}
        />
        <span
          aria-hidden="true"
          className={cn(
            'relative h-4 w-8 rounded-full bg-border transition-colors',
            'peer-checked:bg-brand-primary',
            'peer-focus-visible:ring-[3px] peer-focus-visible:ring-brand-primary/30',
          )}
        >
          <span
            className={cn(
              'absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white transition-transform',
              'peer-checked:translate-x-4',
            )}
            style={{
              transform: 'translateX(var(--switch-tx, 0))',
            }}
          />
        </span>
        {label && <span className="text-[13.5px] text-text-1">{label}</span>}
      </label>
    );
  },
);
Switch.displayName = 'Switch';
