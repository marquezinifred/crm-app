import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Avatar Venzo — foto OU iniciais (violet 15% bg, violet-light text).
 * Tamanhos: 24/32/40/48/64. Avatar group sobreposto via <AvatarGroup>.
 */

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const sizeMap: Record<AvatarSize, string> = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-[12px]',
  md: 'h-10 w-10 text-[14px]',
  lg: 'h-12 w-12 text-[16px]',
  xl: 'h-16 w-16 text-[20px]',
};

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: AvatarSize;
  online?: boolean;
  className?: string;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

export function Avatar({ name, src, size = 'md', online, className }: AvatarProps) {
  const classes = cn(
    'relative inline-flex items-center justify-center rounded-full font-bold bg-brand-primary/15 text-brand-primary-light shrink-0 select-none',
    sizeMap[size],
    className,
  );
  if (src) {
    return (
      <span className={classes}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={name} className="h-full w-full rounded-full object-cover" />
        {online && <OnlineDot />}
      </span>
    );
  }
  return (
    <span className={classes} role="img" aria-label={name}>
      {initialsOf(name)}
      {online && <OnlineDot />}
    </span>
  );
}

function OnlineDot() {
  return (
    <span
      aria-label="Online"
      className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-success border-2 border-card"
    />
  );
}

export function AvatarGroup({
  children,
  max = 4,
  size = 'sm',
}: {
  children: React.ReactNode;
  max?: number;
  size?: AvatarSize;
}) {
  const arr = React.Children.toArray(children);
  const visible = arr.slice(0, max);
  const remaining = arr.length - visible.length;
  return (
    <div className="inline-flex -space-x-2">
      {visible.map((c, i) => (
        <span key={i} className="ring-2 ring-card rounded-full">
          {c}
        </span>
      ))}
      {remaining > 0 && (
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full bg-hover text-text-2 text-[11px] font-semibold ring-2 ring-card',
            sizeMap[size],
          )}
          aria-label={`mais ${remaining}`}
        >
          +{remaining}
        </span>
      )}
    </div>
  );
}
