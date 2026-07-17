'use client';

import { useState } from 'react';
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import { trpc } from '@/lib/trpc/client';
import { friendlyTrpcError } from '@/lib/trpc/error-format';
import { formatBRL, formatBRLCompact } from '@/lib/utils/format';
import { OpportunityCard } from './OpportunityCard';
import { Badge } from '@/components/ui/badge';
import { STAGES, STAGE_LABELS, type OpportunityCard as Card } from './types';
import type { OpportunityStage } from '@prisma/client';

interface Props {
  onCardClick?: (id: string) => void;
  onAdvanceError?: (msg: string, opportunityId: string) => void;
  /**
   * Sprint 15G Fase 4b — filtro `ownerId` opcional aplicado por cima do
   * escopo servidor (ScopeSwitcher grava aqui `currentUser.id` quando
   * "Minhas oportunidades"). Undefined = usa escopo servidor puro.
   */
  ownerFilter?: string;
}

export function PipelineKanban({ onCardClick, onAdvanceError, ownerFilter }: Props) {
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.opportunities.kanban.useQuery(
    ownerFilter ? { ownerId: ownerFilter } : {},
  );
  const advance = trpc.opportunities.advanceStage.useMutation({
    onSuccess: () => utils.opportunities.kanban.invalidate(),
    onError: (err, vars) => {
      onAdvanceError?.(friendlyTrpcError(err), vars.id);
    },
  });
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function handleDragStart(e: DragStartEvent) {
    setDraggingId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setDraggingId(null);
    const { active, over } = e;
    if (!over) return;
    const opp = active.data.current as { fromStage: OpportunityStage } | undefined;
    if (!opp) return;
    const toStage = String(over.id) as OpportunityStage;
    if (toStage === opp.fromStage) return;
    advance.mutate({
      id: String(active.id),
      fromStage: opp.fromStage,
      toStage,
    });
  }

  if (isLoading) return <p className="p-6 text-sm text-text-2">Carregando pipeline…</p>;
  if (error) return <p role="alert" className="p-6 text-sm text-danger">{friendlyTrpcError(error)}</p>;
  if (!data) return null;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div
        className="flex gap-3 overflow-x-auto pb-4 snap-x snap-mandatory scroll-px-4 px-4"
        style={{ scrollPaddingInline: 'var(--space-4)' }}
      >
        {STAGES.map((stage) => {
          const col = data.columns[stage];
          return (
            <StageColumn
              key={stage}
              stage={stage}
              count={col.total}
              sumValue={col.sumValue}
              cards={col.rows}
              draggingId={draggingId}
              onCardClick={onCardClick}
            />
          );
        })}
      </div>
    </DndContext>
  );
}

function StageColumn({
  stage,
  count,
  sumValue,
  cards,
  draggingId,
  onCardClick,
}: {
  stage: OpportunityStage;
  count: number;
  sumValue: number;
  cards: Card[];
  draggingId: string | null;
  onCardClick?: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <div
      ref={setNodeRef}
      style={{ minWidth: 280, maxWidth: 320, flexShrink: 0, scrollSnapAlign: 'start' }}
      className={`flex min-h-[400px] flex-col rounded-md bg-card border border-border p-3 transition-shadow ${
        isOver ? 'ring-2 ring-brand-primary border-brand-primary' : ''
      }`}
    >
      <header className="mb-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-label text-text-3">{STAGE_LABELS[stage]}</span>
          <Badge variant="default">{count}</Badge>
        </div>
        <p
          title={formatBRL(sumValue)}
          aria-label={`Total: ${formatBRL(sumValue)}`}
          className="mt-1 font-mono tabular-nums text-[13px] font-bold text-brand-accent"
        >
          {formatBRLCompact(sumValue)}
        </p>
      </header>

      <div className="flex flex-1 flex-col gap-2">
        {cards.map((c) => (
          <DraggableCard
            key={c.id}
            opp={c}
            isDragging={draggingId === c.id}
            onCardClick={onCardClick}
          />
        ))}
        {cards.length === 0 && (
          <p className="rounded border border-dashed border-border p-4 text-center text-caption text-text-3">
            Arraste cards aqui.
          </p>
        )}
      </div>
    </div>
  );
}

function DraggableCard({
  opp,
  isDragging,
  onCardClick,
}: {
  opp: Card;
  isDragging: boolean;
  onCardClick?: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: opp.id,
    data: { fromStage: opp.stage },
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={isDragging ? 'opacity-50' : ''}
    >
      <OpportunityCard opp={opp} onClick={() => onCardClick?.(opp.id)} />
    </div>
  );
}
