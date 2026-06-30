'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { brl } from '@/lib/utils/hooks';
import { OpportunityCard } from './OpportunityCard';
import { STAGES, STAGE_LABELS } from './types';
import type { OpportunityStage } from '@prisma/client';

interface Props {
  onCardClick?: (id: string) => void;
  onAdvanceError?: (msg: string, opportunityId: string) => void;
}

export function PipelineMobile({ onCardClick, onAdvanceError }: Props) {
  const utils = trpc.useUtils();
  const [active, setActive] = useState<OpportunityStage>('PROSPECT');
  const { data, isLoading, error } = trpc.opportunities.kanban.useQuery({});
  const advance = trpc.opportunities.advanceStage.useMutation({
    onSuccess: () => utils.opportunities.kanban.invalidate(),
    onError: (err, vars) => onAdvanceError?.(err.message, vars.id),
  });

  if (isLoading) return <p className="p-4 text-sm text-text-2">Carregando…</p>;
  if (error) return <p className="p-4 text-sm text-danger">{error.message}</p>;
  if (!data) return null;

  const currentIdx = STAGES.indexOf(active);
  const next = STAGES[currentIdx + 1];
  const col = data.columns[active];

  return (
    <div className="p-4">
      <div className="mb-3 flex gap-1 overflow-x-auto border-b border-border pb-2">
        {STAGES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setActive(s)}
            className={`whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium ${
              s === active
                ? 'border border-border-strong bg-card'
                : 'text-text-2'
            }`}
          >
            {STAGE_LABELS[s]} ({data.columns[s].total})
          </button>
        ))}
      </div>

      <p className="mb-3 text-xs text-text-2">
        {col.total} oportunidade{col.total === 1 ? '' : 's'} · {brl(col.sumValue)}
      </p>

      <div className="space-y-2">
        {col.rows.map((opp) => (
          <OpportunityCard
            key={opp.id}
            opp={opp}
            variant="full"
            onClick={() => onCardClick?.(opp.id)}
            onAdvance={
              next
                ? () =>
                    advance.mutate({
                      id: opp.id,
                      fromStage: opp.stage,
                      toStage: next,
                    })
                : undefined
            }
          />
        ))}
        {col.rows.length === 0 && (
          <p className="rounded border border-dashed border-border-strong p-4 text-center text-sm text-text-2">
            Sem oportunidades em {STAGE_LABELS[active]}
          </p>
        )}
      </div>
    </div>
  );
}
