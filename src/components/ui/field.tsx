'use client';

import * as React from 'react';

/**
 * Field — wrapper a11y para inputs Venzo.
 *
 * Renderiza <label> + helper text + erro com aria-describedby/aria-required
 * propagados ao primeiro child. Use:
 *
 *   <Field label="Nome" required error="Nome obrigatório">
 *     <Input value={...} onChange={...} />
 *   </Field>
 */
export interface FieldProps {
  label: string;
  required?: boolean;
  helper?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, required, helper, error, className, children }: FieldProps) {
  const id = React.useId();
  const helperId = helper ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  const child = React.Children.only(children) as React.ReactElement;
  const cloned = React.cloneElement(child, {
    id,
    'aria-required': required || undefined,
    'aria-describedby': [helperId, errorId].filter(Boolean).join(' ') || undefined,
    'aria-invalid': error ? true : child.props['aria-invalid'],
    error: error ? true : child.props.error,
  });

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-[13px] font-medium text-text-1 mb-1.5">
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger ml-0.5">*</span>
        )}
      </label>
      {cloned}
      {helper && !error && (
        <p id={helperId} className="text-caption text-text-3 mt-1">{helper}</p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-caption text-danger mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
