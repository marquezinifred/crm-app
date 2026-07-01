import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { createInboundLead } from '@/server/services/inbound-lead-creator.service';
import { sendPushToUser } from '@/server/services/push-sender.service';
import { makeWorker, QUEUE_NAMES, type InboundLeadCreateJobData } from './queues';

/**
 * Sprint 15D — Worker que processa payloads inbound enfileirados pelos
 * endpoints públicos (/api/v1/inbound/email e /api/v1/inbound/lead).
 *
 *   1. createInboundLead (parser + dedup company/contact + cria opp)
 *   2. Se criou opp: notifica Gestores de Inbound do tenant via push
 *      (best-effort — falha silenciosa não bloqueia o job).
 *
 * Não faz retry além do padrão do BullMQ; falhas ficam em logs e
 * eventualmente aparecem em inbound_leads_rejected via saveRejected
 * dentro do service.
 */
export function startInboundLeadCreateWorker() {
  return makeWorker<InboundLeadCreateJobData>(
    QUEUE_NAMES.inboundLeadCreate,
    async ({ data }) => {
      const result = await createInboundLead({
        tenantId: data.tenantId,
        source: data.source,
        raw: data.raw,
        receivedAt: new Date(data.receivedAt),
        originIdentifier: data.originIdentifier,
      });

      if (result.kind !== 'created') return result;

      // Notifica gestores. Best-effort — se push falhar, opp fica na fila
      // e o Gestor pega pela UI quando abrir /inbox/prospects.
      await notifyInboundManagers(data.tenantId, result.opportunityId).catch((err) => {
        console.warn('[inbound-lead-create] notify falhou (ignorado):', err);
      });

      return result;
    },
  );
}

async function notifyInboundManagers(tenantId: string, opportunityId: string) {
  await runAsSystem(async () => {
    const config = await prisma.inboundCaptureConfig.findUnique({
      where: { tenantId },
    });
    if (config && !config.notifyOnArrival) return;

    const recipientIds: string[] = config?.notifyUserIds ?? [];
    let recipients: { id: string; email: string; fullName: string }[] = [];

    if (recipientIds.length > 0) {
      recipients = await prisma.user.findMany({
        where: {
          id: { in: recipientIds },
          tenantId,
          deletedAt: null,
          active: true,
        },
        select: { id: true, email: true, fullName: true },
      });
    } else {
      // Default: todos GESTOR_INBOUND ativos do tenant
      recipients = await prisma.user.findMany({
        where: {
          tenantId,
          role: 'GESTOR_INBOUND',
          active: true,
          deletedAt: null,
        },
        select: { id: true, email: true, fullName: true },
      });
    }

    if (recipients.length === 0) return;

    const opp = await prisma.opportunity.findFirst({
      where: { id: opportunityId, tenantId },
      select: {
        id: true,
        title: true,
        estimatedValue: true,
        clientCompany: { select: { razaoSocial: true } },
      },
    });
    if (!opp) return;

    const body = opp.estimatedValue
      ? `${opp.clientCompany.razaoSocial} — R$ ${Number(opp.estimatedValue).toLocaleString('pt-BR')}`
      : `${opp.clientCompany.razaoSocial} — valor não estimado`;

    for (const user of recipients) {
      try {
        await sendPushToUser(user.id, {
          title: 'Novo lead inbound',
          body,
          url: `/inbox/prospects?highlight=${opp.id}`,
        });
      } catch (err) {
        console.warn(`[inbound-lead-create] push ${user.id} falhou:`, err);
      }
    }
  });
}
