'use client';

import { brl, daysSince, initials, urgencyFromStageDays, urgencyFromDate } from '@/lib/utils/hooks';
import { cn } from '@/lib/utils/cn';
import type { OpportunityCard as Card } from './types';

const urgencyColor = {
  ok: 'bg-emerald-500',
  soon: 'bg-amber-500',
  urgent: 'bg-red-500',
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

  return (
    <article
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        'rounded-md border border-neutral-200 bg-white p-2.5 transition hover:border-neutral-300',
        onClick && 'cursor-pointer',
        variant === 'full' && 'p-3',
      )}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium leading-tight">{opp.title}</h3>
        <span className="shrink-0 text-sm font-medium">{brl(Number(opp.estimatedValue ?? 0))}</span>
      </div>
      <p className="mb-2 truncate text-xs text-neutral-600">{company}</p>

      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-medium text-neutral-700"
            aria-hidden="true"
          >
            {initials(owner)}
          </span>
          <span className="truncate text-neutral-700">{owner}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className={cn('h-1.5 w-1.5 rounded-full', urgencyColor[urgency])} aria-hidden="true" />
          <span className="text-neutral-600">{days}d</span>
        </div>
      </div>

      {onAdvance && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAdvance();
            }}
            className="rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-neutral-50"
          >
            Avançar →
          </button>
        </div>
      )}
    </article>
  );
}
