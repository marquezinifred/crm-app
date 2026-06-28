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
import { brl } from '@/lib/utils/hooks';
import { OpportunityCard } from './OpportunityCard';
import { STAGES, STAGE_LABELS, type OpportunityCard as Card } from './types';
import type { OpportunityStage } from '@prisma/client';

interface Props {
  onCardClick?: (id: string) => void;
  onAdvanceError?: (msg: string, opportunityId: string) => void;
}

export function PipelineKanban({ onCardClick, onAdvanceError }: Props) {
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.opportunities.kanban.useQuery({});
  const advance = trpc.opportunities.advanceStage.useMutation({
    onSuccess: () => utils.opportunities.kanban.invalidate(),
    onError: (err, vars) => {
      onAdvanceError?.(err.message, vars.id);
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

  if (isLoading) return <p className="p-6 text-sm text-neutral-600">Carregando pipeline…</p>;
  if (error) return <p className="p-6 text-sm text-red-600">{error.message}</p>;
  if (!data) return null;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-7 gap-2 overflow-x-auto pb-4">
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
      className={`flex min-h-[400px] flex-col rounded-md bg-neutral-50 p-2 ${
        isOver ? 'ring-2 ring-blue-400' : ''
      }`}
    >
      <header className="mb-2 flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-700">
          {STAGE_LABELS[stage]}
        </span>
        <span className="text-[10px] text-neutral-500">{count}</span>
      </header>
      <p className="mb-2 text-[10px] text-neutral-500">{brl(sumValue)}</p>

      <div className="flex flex-1 flex-col gap-1.5">
        {cards.map((c) => (
          <DraggableCard
            key={c.id}
            opp={c}
            isDragging={draggingId === c.id}
            onCardClick={onCardClick}
          />
        ))}
        {cards.length === 0 && (
          <p className="rounded border border-dashed border-neutral-300 p-3 text-center text-[11px] text-neutral-400">
            Solte aqui
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
