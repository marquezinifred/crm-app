import type { OpportunityStage } from '@prisma/client';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@/server/trpc/routers/_app';

export type KanbanColumns = inferRouterOutputs<AppRouter>['opportunities']['kanban']['columns'];
export type OpportunityCard = KanbanColumns[OpportunityStage]['rows'][number];

export const STAGES: OpportunityStage[] = [
  'PROSPECT',
  'LEAD',
  'OPORTUNIDADE',
  'PROPOSTA',
  'NEGOCIACAO',
  'ACEITE',
  'CONTRATO',
];

export const STAGE_LABELS: Record<OpportunityStage, string> = {
  PROSPECT: 'Prospect',
  LEAD: 'Lead',
  OPORTUNIDADE: 'Oportunidade',
  PROPOSTA: 'Proposta',
  NEGOCIACAO: 'Negociação',
  ACEITE: 'Aceite',
  CONTRATO: 'Contrato',
};
