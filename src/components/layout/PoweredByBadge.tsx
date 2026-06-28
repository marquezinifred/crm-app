import type { PoweredByMode } from '@prisma/client';

/**
 * Badge "Powered by Venzo" three-state. Sprint 10.5.
 * Variantes seguem brand guide seção 05.
 */
export function PoweredByBadge({ poweredBy }: { poweredBy: PoweredByMode }) {
  if (poweredBy === 'HIDDEN') return null;

  const isVisible = poweredBy === 'VISIBLE';
  return (
    <div
      className={
        isVisible
          ? 'mt-6 pb-4 text-center text-[14px]'
          : 'pb-2 pr-3 text-right text-[9px] text-neutral-500'
      }
      style={isVisible ? { color: 'var(--brand-primary)' } : undefined}
    >
      <a
        href="https://venzo.com.br"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline"
      >
        Powered by Venzo
      </a>
    </div>
  );
}
