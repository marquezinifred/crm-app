import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

/**
 * Button Venzo — Sprint 14.
 *
 * 5 variantes:
 *  - primary: ação principal, 1 por tela (violeta sólido)
 *  - secondary: ações secundárias (outlined violeta)
 *  - ghost: ações terciárias, cancel
 *  - danger: irreversível
 *  - link: navegação inline em texto
 *
 * 3 tamanhos: sm (32px) / md (40px) / lg (48px). Loading desabilita
 * o botão mas mantém o tab order (a11y). Focus ring 2px offset 2px.
 *
 * Legado: variants `default`, `destructive`, `outline` continuam
 * mapeados pra manter compatibilidade com telas pré-Sprint 14.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none',
  {
    variants: {
      variant: {
        primary: 'bg-brand-primary text-white hover:bg-brand-primary-mid active:bg-brand-primary-dark',
        secondary: 'bg-transparent text-brand-primary-light border border-brand-primary hover:bg-brand-primary/10',
        ghost: 'bg-transparent text-text-2 hover:bg-hover hover:text-text-1',
        danger: 'bg-danger text-white hover:bg-danger/90',
        link: 'bg-transparent text-brand-primary-light underline-offset-4 hover:underline px-0',
        accent: 'bg-brand-accent text-[#1a1200] hover:bg-brand-accent/90',
        // legado
        default: 'bg-brand-primary text-white hover:bg-brand-primary-mid',
        destructive: 'bg-danger text-white hover:bg-danger/90',
        outline: 'bg-transparent text-brand-primary-light border border-brand-primary hover:bg-brand-primary/10',
      },
      size: {
        sm: 'h-8 px-3 text-[12.5px]',
        md: 'h-10 px-4 text-[13.5px]',
        lg: 'h-12 px-5 text-[15px]',
        icon: 'h-10 w-10',
        // legado
        default: 'h-10 px-4 text-[13.5px]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, leftIcon, rightIcon, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    const isLoading = Boolean(loading);
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        disabled={isLoading || disabled}
        aria-busy={isLoading || undefined}
        {...props}
      >
        {isLoading ? (
          <Spinner className="h-4 w-4" />
        ) : leftIcon}
        {children}
        {!isLoading && rightIcon}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('animate-spin', className)} aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export { Button, buttonVariants };
