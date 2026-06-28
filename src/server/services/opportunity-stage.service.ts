import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { OpportunityStage, OpportunityStatus, Prisma } from '@prisma/client';

export const STAGE_ORDER: OpportunityStage[] = [
  'PROSPECT',
  'LEAD',
  'OPORTUNIDADE',
  'PROPOSTA',
  'NEGOCIACAO',
  'ACEITE',
  'CONTRATO',
];

/**
 * Campos obrigatórios para SAIR de cada estágio.
 * O nome do campo é a property do Opportunity model.
 * Validações são checadas antes de permitir transição para o próximo estágio.
 *
 * Notas:
 * - source é obrigatório desde Prospect (toda oportunidade nasce com origem)
 * - clientCompanyId/ownerId já são obrigatórios pelo schema (NOT NULL)
 * - PROPOSTA "saída" exige que haja pelo menos 1 ProposalVersion (verificada em ProposalService)
 * - NEGOCIACAO exige pelo menos 1 atividade do tipo MANUAL_NOTE / EMAIL / WHATSAPP / CALL registrada
 *   na etapa (verificação ad-hoc no service de avanço, não declarativa aqui)
 * - ACEITE exige acceptedAt + pelo menos 1 documento da categoria ACEITE_CLIENTE anexado
 *   (documento será validado em Sprint 7 quando o módulo de documents estiver pronto)
 */
export const STAGE_EXIT_REQUIREMENTS: Record<OpportunityStage, string[]> = {
  PROSPECT: ['source'],
  LEAD: ['meetingScheduledAt'],
  OPORTUNIDADE: ['briefing', 'estimatedValue', 'expectedCloseDate'],
  PROPOSTA: ['proposalPresentedAt', 'decisionExpectedAt'],
  NEGOCIACAO: [],
  ACEITE: ['acceptedAt'],
  CONTRATO: [],
};

export interface StageValidationResult {
  ok: boolean;
  missingFields: string[];
}

export function validateStageExit(
  opportunity: Record<string, unknown>,
  fromStage: OpportunityStage,
): StageValidationResult {
  const required = STAGE_EXIT_REQUIREMENTS[fromStage] ?? [];
  const missing = required.filter((f) => {
    const v = opportunity[f];
    return v === null || v === undefined || v === '';
  });
  return { ok: missing.length === 0, missingFields: missing };
}

export function isValidTransition(
  from: OpportunityStage,
  to: OpportunityStage,
): { ok: boolean; reason?: string } {
  if (from === to) return { ok: false, reason: 'Estágio destino igual ao atual.' };
  const fromIdx = STAGE_ORDER.indexOf(from);
  const toIdx = STAGE_ORDER.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return { ok: false, reason: 'Estágio inválido.' };
  // Permite avançar 1 estágio por vez OU retroceder para qualquer estágio anterior
  if (toIdx === fromIdx + 1) return { ok: true };
  if (toIdx < fromIdx) return { ok: true }; // retrocesso permitido (gestor pode corrigir)
  return {
    ok: false,
    reason: `Não é permitido pular estágios (de ${from} para ${to}).`,
  };
}

export interface AdvanceStageInput {
  opportunityId: string;
  fromStage: OpportunityStage;
  toStage: OpportunityStage;
  userId: string;
  note?: string;
  ip?: string | null;
  userAgent?: string | null;
}

export class StageTransitionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_TRANSITION'
      | 'STAGE_MISMATCH'
      | 'MISSING_FIELDS'
      | 'NOT_ACTIVE'
      | 'NOT_FOUND',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'StageTransitionError';
  }
}

export async function advanceStage(input: AdvanceStageInput): Promise<{
  opportunityId: string;
  fromStage: OpportunityStage;
  toStage: OpportunityStage;
}> {
  return prisma.$transaction(async (tx) => {
    const opp = await tx.opportunity.findFirst({
      where: { id: input.opportunityId, deletedAt: null },
    });
    if (!opp) throw new StageTransitionError('Oportunidade não encontrada.', 'NOT_FOUND');
    if (opp.status !== OpportunityStatus.ACTIVE) {
      throw new StageTransitionError(
        `Oportunidade em status ${opp.status} não pode mudar de estágio.`,
        'NOT_ACTIVE',
      );
    }
    if (opp.stage !== input.fromStage) {
      throw new StageTransitionError(
        `Estágio atual é ${opp.stage}, não ${input.fromStage}. Recarregue a página.`,
        'STAGE_MISMATCH',
      );
    }
    const transition = isValidTransition(input.fromStage, input.toStage);
    if (!transition.ok) {
      throw new StageTransitionError(transition.reason!, 'INVALID_TRANSITION');
    }
    // Validação de campos obrigatórios — só ao AVANÇAR
    const toIdx = STAGE_ORDER.indexOf(input.toStage);
    const fromIdx = STAGE_ORDER.indexOf(input.fromStage);
    if (toIdx > fromIdx) {
      const v = validateStageExit(opp as unknown as Record<string, unknown>, input.fromStage);
      if (!v.ok) {
        throw new StageTransitionError(
          `Campos obrigatórios faltando: ${v.missingFields.join(', ')}`,
          'MISSING_FIELDS',
          { missingFields: v.missingFields },
        );
      }

      // ACEITE → CONTRATO exige documento da categoria ACEITE_CLIENTE anexado
      // (fecha débito técnico do Sprint 2)
      if (input.fromStage === 'ACEITE' && input.toStage === 'CONTRATO') {
        const acceptanceDoc = await tx.document.findFirst({
          where: {
            tenantId: opp.tenantId,
            relatedEntityType: 'opportunity',
            relatedEntityId: opp.id,
            category: 'ACEITE_CLIENTE',
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!acceptanceDoc) {
          throw new StageTransitionError(
            'Para avançar para Contrato é necessário anexar pelo menos 1 documento da categoria "Aceite do cliente".',
            'MISSING_FIELDS',
            { missingFields: ['document:ACEITE_CLIENTE'] },
          );
        }
      }
    }

    const updated = await tx.opportunity.update({
      where: { id: opp.id },
      data: {
        stage: input.toStage,
        currentStageEnteredAt: new Date(),
        updatedBy: input.userId,
        ...(input.toStage === 'ACEITE' && !opp.acceptedAt
          ? { acceptedAt: new Date() }
          : {}),
      } as Prisma.OpportunityUncheckedUpdateInput,
    });

    await tx.opportunityStageHistory.create({
      data: {
        tenantId: opp.tenantId,
        opportunityId: opp.id,
        fromStage: input.fromStage,
        toStage: input.toStage,
        movedById: input.userId,
        note: input.note ?? null,
      } as Prisma.OpportunityStageHistoryUncheckedCreateInput,
    });

    await audit({
      action: 'opportunity.advance_stage',
      tableName: 'opportunities',
      recordId: opp.id,
      before: { stage: input.fromStage },
      after: { stage: input.toStage },
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return {
      opportunityId: updated.id,
      fromStage: input.fromStage,
      toStage: input.toStage,
    };
  });
}

export interface CancelOpportunityInput {
  opportunityId: string;
  reason: string;
  lossReason?:
    | 'CLIENTE_DESISTIU'
    | 'INADEQUACAO_TECNICA'
    | 'INADEQUACAO_COMERCIAL'
    | 'PRECO'
    | 'PRAZO'
    | 'CONCORRENCIA'
    | 'SEM_BUDGET'
    | 'OUTRO';
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export async function cancelOpportunity(input: CancelOpportunityInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const opp = await tx.opportunity.findFirst({
      where: { id: input.opportunityId, deletedAt: null },
    });
    if (!opp) throw new StageTransitionError('Oportunidade não encontrada.', 'NOT_FOUND');
    if (opp.status !== OpportunityStatus.ACTIVE) return;

    await tx.opportunity.update({
      where: { id: opp.id },
      data: {
        status: OpportunityStatus.CANCELLED,
        cancellationReason: input.reason,
        lossReason: input.lossReason ?? null,
        updatedBy: input.userId,
      } as Prisma.OpportunityUncheckedUpdateInput,
    });

    await audit({
      action: 'opportunity.cancel',
      tableName: 'opportunities',
      recordId: opp.id,
      before: { status: opp.status },
      after: { status: 'CANCELLED', reason: input.reason, lossReason: input.lossReason },
      ip: input.ip,
      userAgent: input.userAgent,
    });
  });
}
