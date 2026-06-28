import { prisma } from '@/server/db/client';
import { ContractStatus, OpportunitySource, OpportunityStage, Prisma } from '@prisma/client';

/**
 * Renovação de contrato (§13.6 do spec):
 *   - Cria uma nova Opportunity em PROSPECT pré-preenchida com dados
 *     do contrato original.
 *   - Marca o contrato original como RENEWED.
 *   - Cria Activity de auditoria no novo opportunity referenciando o contrato.
 *
 * Idempotência: se já existe Opportunity criada como renewal deste contract
 * (linha de Activity), retorna a existente.
 */

export interface RenewContractInput {
  contractId: string;
  userId: string;
}

export async function renewContract(input: RenewContractInput) {
  return prisma.$transaction(async (tx) => {
    const contract = await tx.contract.findFirst({
      where: { id: input.contractId, deletedAt: null },
      include: {
        opportunity: {
          select: {
            id: true,
            title: true,
            tenantId: true,
            clientCompanyId: true,
            clientContactId: true,
            partnerCompanyId: true,
            ownerId: true,
            description: true,
            estimatedValue: true,
          },
        },
      },
    });
    if (!contract) throw new Error('Contrato não encontrado.');

    const orig = contract.opportunity;
    const newOpp = await tx.opportunity.create({
      data: {
        tenantId: orig.tenantId,
        title: `Renovação — ${orig.title}`,
        clientCompanyId: orig.clientCompanyId,
        clientContactId: orig.clientContactId,
        partnerCompanyId: orig.partnerCompanyId,
        ownerId: orig.ownerId,
        stage: OpportunityStage.PROSPECT,
        source: OpportunitySource.INDICACAO,
        sourceDetail: `Renovação do contrato ${contract.number ?? contract.id.slice(0, 8)}`,
        estimatedValue: contract.totalValue,
        description: orig.description,
        createdBy: input.userId,
      } as Prisma.OpportunityUncheckedCreateInput,
    });

    await tx.opportunityStageHistory.create({
      data: {
        tenantId: orig.tenantId,
        opportunityId: newOpp.id,
        fromStage: null,
        toStage: OpportunityStage.PROSPECT,
        movedById: input.userId,
        note: `Criada via renovação de contrato ${contract.id}`,
      } as Prisma.OpportunityStageHistoryUncheckedCreateInput,
    });

    await tx.activity.create({
      data: {
        tenantId: orig.tenantId,
        opportunityId: newOpp.id,
        type: 'SYSTEM_EVENT',
        title: 'Oportunidade criada por renovação',
        content: `Origem: contrato ${contract.id}, oportunidade ${orig.id}.`,
      } as Prisma.ActivityUncheckedCreateInput,
    });

    await tx.contract.update({
      where: { id: contract.id },
      data: { status: ContractStatus.RENEWED, updatedBy: input.userId },
    });

    return { newOpportunityId: newOpp.id };
  });
}
