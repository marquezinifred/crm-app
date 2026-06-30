'use client';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { daysSince, urgencyFromStageDays, urgencyFromDate } from '@/lib/utils/hooks';
import { formatBRL, formatBRLCompact } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import type { OpportunityCard as Card } from './types';

/**
 * Card de oportunidade do Kanban — Sprint 14.5.
 *
 * Aplica spec §6.1 + Sprint 14.5 §1: header stack (título line-clamp-2 +
 * valor monetário em gold/tabular-nums abaixo), empresa em sub-text,
 * footer com avatar do responsável + dias no estágio + indicador de
 * urgência. border-left de 3px muda conforme prazo.
 */

const urgencyBorder = {
  ok: 'border-l-border',
  soon: 'border-l-warning',
  urgent: 'border-l-danger',
} as const;

const urgencyDot = {
  ok: 'bg-success',
  soon: 'bg-warning',
  urgent: 'bg-danger',
} as const;

interface Props {
  opp: Card;
  variant?: 'compact' | 'full';
  onClick?: () => void;
  onAdvance?: () => void;
}

export function OpportunityCard({ opp, variant = 'compact', onClick, onAdvance }: Props) {
  const days = daysSince(opp.currentStageEnteredAt);
  const urgency = opp.expectedCloseDate
    ? urgencyFromDate(opp.expectedCloseDate)
    : urgencyFromStageDays(days);
  const company = opp.clientCompany?.nomeFantasia ?? opp.clientCompany?.razaoSocial ?? '—';
  const owner = opp.owner?.fullName ?? '—';
  const value = Number(opp.estimatedValue ?? 0);

  return (
    <article
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'rounded-md border border-border border-l-[3px] bg-card p-3 transition-all',
        'hover:-translate-y-px hover:border-brand-primary hover:shadow-md',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary',
        urgencyBorder[urgency],
        onClick && 'cursor-pointer',
        variant === 'full' && 'p-4',
      )}
    >
      <header className="space-y-1 mb-2">
        <h3 className="text-[14px] font-semibold text-text-1 leading-[1.3] line-clamp-2">
          {opp.title}
        </h3>
        <p className="text-caption text-text-2 line-clamp-1">{company}</p>
        <p
          title={formatBRL(value)}
          aria-label={formatBRL(value)}
          className="font-mono tabular-nums text-[15px] font-bold text-brand-accent"
        >
          {formatBRLCompact(value)}
        </p>
      </header>

      <footer className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border">
        <div className="flex items-center gap-1.5 min-w-0">
          <Avatar name={owner} size="xs" />
          <span className="text-caption text-text-2 truncate">{owner}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="default" className="lowercase">
            <span className={cn('h-1.5 w-1.5 rounded-full', urgencyDot[urgency])} aria-hidden="true" />
            {days}d
          </Badge>
        </div>
      </footer>

      {onAdvance && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAdvance();
            }}
            className="rounded border border-border bg-card px-2.5 py-1 text-caption font-medium text-text-1 hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            Avançar →
          </button>
        </div>
      )}
    </article>
  );
}
