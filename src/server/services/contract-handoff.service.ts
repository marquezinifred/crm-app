import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { sendEmail } from './email-sender.service';
import { ActivityType, Prisma } from '@prisma/client';
import { env } from '@/lib/env';

/**
 * Handoff de contrato (§13.3 do spec):
 *   - Ao mudar Contract.status para ACTIVE, envia e-mail a tenant.handoffEmails
 *     com CNPJ + valor + parcelas + recursos.
 *   - Cria Activity SYSTEM_EVENT na oportunidade vinculada.
 *
 * Idempotente: usa Activity existente como flag.
 */

export async function dispatchHandoff(contractId: string): Promise<{
  emailsSent: number;
  alreadyDispatched: boolean;
}> {
  return runAsSystem(async () => {
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        opportunity: {
          select: {
            id: true,
            title: true,
            tenantId: true,
            clientCompany: { select: { razaoSocial: true, cnpj: true } },
          },
        },
        installments: {
          orderBy: { number: 'asc' },
          select: { number: true, dueDate: true, value: true },
        },
      },
    });
    if (!contract) return { emailsSent: 0, alreadyDispatched: false };

    // Idempotência
    const existing = await prisma.activity.findFirst({
      where: {
        tenantId: contract.tenantId,
        opportunityId: contract.opportunityId,
        type: ActivityType.SYSTEM_EVENT,
        title: 'Handoff disparado',
      },
      select: { id: true },
    });
    if (existing) return { emailsSent: 0, alreadyDispatched: true };

    const tenant = await prisma.tenant.findUnique({
      where: { id: contract.tenantId },
      select: { handoffEmails: true, centralCrmEmail: true, name: true },
    });
    const recipients = [...(tenant?.handoffEmails ?? [])];
    if (tenant?.centralCrmEmail && !recipients.includes(tenant.centralCrmEmail)) {
      recipients.push(tenant.centralCrmEmail);
    }

    if (recipients.length === 0) {
      // Sem destinatários — grava Activity para auditoria mas não envia
      await prisma.activity.create({
        data: {
          tenantId: contract.tenantId,
          opportunityId: contract.opportunityId,
          type: ActivityType.SYSTEM_EVENT,
          title: 'Handoff disparado',
          content: 'Sem e-mails de handoff configurados — nenhum envio realizado.',
        } as Prisma.ActivityUncheckedCreateInput,
      });
      return { emailsSent: 0, alreadyDispatched: false };
    }

    const installmentsHtml = contract.installments
      .map(
        (i) =>
          `<li>Parcela ${i.number} · ${new Date(i.dueDate).toLocaleDateString('pt-BR')} · R$ ${Number(i.value).toLocaleString('pt-BR')}</li>`,
      )
      .join('');
    const html = `
      <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #111;">Handoff: contrato ativado</h2>
        <p>Cliente: <strong>${contract.opportunity.clientCompany.razaoSocial}</strong></p>
        <p>CNPJ: <strong>${contract.opportunity.clientCompany.cnpj ?? '—'}</strong></p>
        <p>Oportunidade: ${contract.opportunity.title}</p>
        <p>Valor total: <strong>R$ ${Number(contract.totalValue).toLocaleString('pt-BR')}</strong></p>
        ${contract.startDate ? `<p>Início: ${new Date(contract.startDate).toLocaleDateString('pt-BR')}</p>` : ''}
        ${contract.endDate ? `<p>Fim: ${new Date(contract.endDate).toLocaleDateString('pt-BR')}</p>` : ''}
        <h3 style="color: #111; margin-top: 24px;">Parcelas</h3>
        <ul>${installmentsHtml || '<li>(sem parcelas registradas)</li>'}</ul>
        <p style="margin-top: 24px;">
          <a href="${env.NEXT_PUBLIC_APP_URL}/pipeline/${contract.opportunityId}"
             style="background: #111; color: #fff; padding: 10px 16px; border-radius: 6px; text-decoration: none;">
            Abrir no CRM
          </a>
        </p>
      </div>
    `;

    const result = await sendEmail({
      to: recipients,
      subject: `Handoff: ${contract.opportunity.clientCompany.razaoSocial} — R$ ${Number(contract.totalValue).toLocaleString('pt-BR')}`,
      html,
    });

    await prisma.activity.create({
      data: {
        tenantId: contract.tenantId,
        opportunityId: contract.opportunityId,
        type: ActivityType.SYSTEM_EVENT,
        title: 'Handoff disparado',
        content: result.ok
          ? `E-mail enviado para ${recipients.join(', ')}.`
          : `Falha ao enviar: ${result.error}.`,
      } as Prisma.ActivityUncheckedCreateInput,
    });

    return { emailsSent: result.ok ? recipients.length : 0, alreadyDispatched: false };
  });
}
