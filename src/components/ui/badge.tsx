import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

/**
 * Badge Venzo — 7 tipos (Default/Primary/Success/Danger/Warning/Info/Gold).
 * Altura 20px · font-size 11px 600 · radius-full.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 h-5 px-2 rounded-full text-[11px] font-semibold whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-hover text-text-2',
        primary: 'bg-brand-primary/15 text-brand-primary-light',
        success: 'bg-success-bg text-success-text',
        danger: 'bg-danger-bg text-danger-text',
        warning: 'bg-warning-bg text-warning-text',
        info: 'bg-info-bg text-info-text',
        gold: 'bg-warning-bg text-warning-text',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-current"
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
