import type { OpportunityStage } from '@prisma/client';

/**
 * Rótulos semânticos por estágio — descrevem o QUE o gestor está fazendo
 * naquele estágio em vez do nome técnico do enum. Usados em títulos de
 * seção do detalhe da oportunidade para reduzir carga cognitiva
 * ("CAMPOS DO ESTÁGIO ATUAL (LEAD)" não diz nada — "Agendamento de
 * reunião" diz tudo).
 *
 * Para nome curto do estágio em chips, breadcrumbs e cabeçalhos de coluna
 * do kanban, continue usando `STAGE_LABELS` em
 * `src/components/pipeline/types.ts` — esses dois mapas têm propósitos
 * diferentes e são intencionalmente separados.
 */
export const STAGE_INTENT_LABEL: Record<OpportunityStage, string> = {
  PROSPECT: 'Captação de origem',
  LEAD: 'Agendamento de reunião',
  OPORTUNIDADE: 'Briefing e qualificação',
  PROPOSTA: 'Apresentação da proposta',
  NEGOCIACAO: 'Negociação final',
  ACEITE: 'Aceite do cliente',
  CONTRATO: 'Contrato ativo',
};
