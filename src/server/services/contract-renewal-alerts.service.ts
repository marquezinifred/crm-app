import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { AlertStatus, AlertType, Prisma } from '@prisma/client';

/**
 * Scan diário (integrado ao worker existente) que enfileira AlertLog
 * para contratos com endDate caindo em (hoje + N) onde N ∈ tenant.contractRenewalLeadDays.
 * Tipo do alerta: PIPELINE_DATE com marker "Renovação contratual".
 *
 * Idempotente: dedup por (tenantId, type, entityId=contractId, scheduledFor=startOfDay)
 */

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export interface RenewalScanStats {
  tenantId: string;
  contractsScanned: number;
  enqueued: number;
}

export async function scanContractRenewals(today: Date = new Date()): Promise<RenewalScanStats[]> {
  return runAsSystem(async () => {
    const tenants = await prisma.tenant.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        contractRenewalLeadDays: true,
        centralCrmEmail: true,
        handoffEmails: true,
      },
    });

    const results: RenewalScanStats[] = [];
    for (const t of tenants) {
      const stats: RenewalScanStats = {
        tenantId: t.id,
        contractsScanned: 0,
        enqueued: 0,
      };
      const leadDays = t.contractRenewalLeadDays.length > 0 ? t.contractRenewalLeadDays : [90, 60, 30];
      const lookahead = Math.max(...leadDays);
      const horizon = new Date(today);
      horizon.setDate(horizon.getDate() + lookahead);
      horizon.setHours(23, 59, 59, 999);

      const contracts = await prisma.contract.findMany({
        where: {
          tenantId: t.id,
          deletedAt: null,
          status: 'ACTIVE',
          endDate: { gte: startOfDay(today), lte: horizon },
        },
        include: {
          opportunity: {
            select: {
              id: true,
              title: true,
              owner: { select: { email: true, fullName: true } },
              clientCompany: { select: { razaoSocial: true } },
            },
          },
        },
      });
      stats.contractsScanned = contracts.length;

      for (const c of contracts) {
        if (!c.endDate) continue;
        const target = startOfDay(c.endDate);
        const diff = Math.round((target.getTime() - startOfDay(today).getTime()) / 86_400_000);
        if (!leadDays.includes(diff)) continue;

        // Dedup do dia
        const start = startOfDay(today);
        const end = new Date(start.getTime() + 86_400_000);
        const existing = await prisma.alertLog.findFirst({
          where: {
            tenantId: t.id,
            type: AlertType.PIPELINE_DATE,
            entityId: c.id,
            scheduledFor: { gte: start, lt: end },
            status: { in: [AlertStatus.PENDING, AlertStatus.SENT] },
          },
          select: { id: true },
        });
        if (existing) continue;

        // Destinatário: owner da opportunity
        const recipient = c.opportunity?.owner?.email;
        if (!recipient) continue;

        await prisma.alertLog.create({
          data: {
            tenantId: t.id,
            type: AlertType.PIPELINE_DATE,
            entityType: 'contract',
            entityId: c.id,
            scheduledFor: target,
            recipientEmail: recipient,
            status: AlertStatus.PENDING,
            payload: {
              opportunityId: c.opportunityId,
              opportunityTitle: c.opportunity?.title ?? 'Contrato',
              stage: 'CONTRATO',
              marker: 'Renovação contratual',
              field: 'endDate',
              leadDays: diff,
              clientCompany: c.opportunity?.clientCompany?.razaoSocial,
              centralCrmEmail: t.centralCrmEmail,
            } as Prisma.InputJsonValue,
          } as Prisma.AlertLogUncheckedCreateInput,
        });
        stats.enqueued += 1;
      }

      results.push(stats);
    }
    return results;
  });
}
