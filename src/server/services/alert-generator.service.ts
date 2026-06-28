import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import {
  AlertType,
  ImportantDateEntityType,
  OpportunityStage,
  AlertStatus,
  Prisma,
} from '@prisma/client';

/**
 * Gera os alertas devidos para HOJE em todos os tenants ativos.
 *
 * Estratégia:
 *   - Para cada tenant, consulta:
 *     a) ImportantDate com alertActive=true; calcula a próxima ocorrência
 *        (recorrente DD/MM ou única DD/MM/AAAA) e dispara se cair em
 *        (hoje + N) para cada N em tenant.alertLeadDays
 *     b) Opportunity ativa com meetingScheduledAt/expectedCloseDate/
 *        proposalPresentedAt/decisionExpectedAt em (hoje + N)
 *   - Cria entrada em alert_logs com status=PENDING — o worker de e-mail
 *     consome essas entradas, envia via Resend e atualiza para SENT/FAILED.
 *   - Deduplicação: chave (tenantId, type, entityId, scheduledFor) unique
 *     virtual via SELECT existente antes de inserir.
 *
 * Sentinela DD/MM (data recorrente sem ano): ano armazenado = 0001
 * (constante `RECURRING_YEAR_SENTINEL` em validators/dates.ts).
 */

const RECURRING_YEAR_SENTINEL = 1;

export interface AlertGenerationStats {
  tenantId: string;
  relationshipScanned: number;
  pipelineScanned: number;
  enqueued: number;
  skippedDuplicates: number;
}

export interface AlertGenerationOptions {
  /** Sobrescreve "hoje" — usado em testes. Default: new Date(). */
  today?: Date;
}

interface PendingAlert {
  type: AlertType;
  entityType: string;
  entityId: string;
  scheduledFor: Date;
  recipientEmail: string;
  payload: Record<string, unknown>;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysBetween(future: Date, today: Date): number {
  return Math.round((startOfDay(future).getTime() - startOfDay(today).getTime()) / 86_400_000);
}

/** Próxima ocorrência de uma data recorrente DD/MM no ano corrente ou seguinte. */
function nextOccurrence(stored: Date, today: Date): Date {
  if (stored.getFullYear() !== RECURRING_YEAR_SENTINEL) {
    // Data única — usa o ano armazenado
    const candidate = new Date(stored);
    candidate.setHours(0, 0, 0, 0);
    return candidate;
  }
  // Recorrente: aplica mês/dia no ano corrente; se já passou, vai para o próximo
  const candidate = new Date(today.getFullYear(), stored.getMonth(), stored.getDate());
  candidate.setHours(0, 0, 0, 0);
  if (candidate.getTime() < startOfDay(today).getTime()) {
    candidate.setFullYear(today.getFullYear() + 1);
  }
  return candidate;
}

async function alreadyEnqueued(
  tenantId: string,
  type: AlertType,
  entityId: string,
  scheduledFor: Date,
): Promise<boolean> {
  const start = startOfDay(scheduledFor);
  const end = new Date(start.getTime() + 86_400_000);
  const existing = await prisma.alertLog.findFirst({
    where: {
      tenantId,
      type,
      entityId,
      scheduledFor: { gte: start, lt: end },
      status: { in: [AlertStatus.PENDING, AlertStatus.SENT] },
    },
    select: { id: true },
  });
  return !!existing;
}

async function generateForTenant(
  tenantId: string,
  today: Date,
): Promise<AlertGenerationStats> {
  const stats: AlertGenerationStats = {
    tenantId,
    relationshipScanned: 0,
    pipelineScanned: 0,
    enqueued: 0,
    skippedDuplicates: 0,
  };

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      alertLeadDays: true,
      centralCrmEmail: true,
    },
  });
  if (!tenant) return stats;

  const leadDays = tenant.alertLeadDays.length > 0 ? tenant.alertLeadDays : [7, 1];
  const leadSet = new Set(leadDays);

  // Lookahead = maior leadDay; busca apenas datas que poderiam disparar
  const lookahead = Math.max(...leadDays, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + lookahead);
  horizon.setHours(23, 59, 59, 999);

  // ----- 1. Relacionamento (important_dates) -----
  // Filtro grosso: alertActive=true. O cálculo de "se a próxima ocorrência cai
  // em (hoje + N)" é feito em memória porque dependemos do ano corrente.
  const importantDates = await prisma.importantDate.findMany({
    where: { tenantId, alertActive: true, deletedAt: null },
    select: {
      id: true,
      entityType: true,
      entityId: true,
      dateType: true,
      dateValue: true,
      label: true,
    },
  });
  stats.relationshipScanned = importantDates.length;

  const pending: PendingAlert[] = [];

  for (const d of importantDates) {
    const next = nextOccurrence(d.dateValue, today);
    const diff = daysBetween(next, today);
    if (diff < 0 || !leadSet.has(diff)) continue;

    const recipient = await resolveRelationshipRecipient(
      tenantId,
      d.entityType,
      d.entityId,
    );
    if (!recipient) continue;

    pending.push({
      type: AlertType.RELATIONSHIP_DATE,
      entityType: d.entityType,
      entityId: d.entityId,
      scheduledFor: next,
      recipientEmail: recipient,
      payload: {
        importantDateId: d.id,
        dateType: d.dateType,
        label: d.label,
        leadDays: diff,
        centralCrmEmail: tenant.centralCrmEmail,
      },
    });
  }

  // ----- 2. Pipeline (Opportunity) -----
  const opps = await prisma.opportunity.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status: 'ACTIVE',
      OR: [
        { meetingScheduledAt: { gte: startOfDay(today), lte: horizon } },
        { expectedCloseDate: { gte: startOfDay(today), lte: horizon } },
        { proposalPresentedAt: { gte: startOfDay(today), lte: horizon } },
        { decisionExpectedAt: { gte: startOfDay(today), lte: horizon } },
      ],
    },
    select: {
      id: true,
      title: true,
      stage: true,
      meetingScheduledAt: true,
      expectedCloseDate: true,
      proposalPresentedAt: true,
      decisionExpectedAt: true,
      owner: { select: { email: true, fullName: true } },
    },
  });
  stats.pipelineScanned = opps.length;

  const checks: Array<{
    field: keyof typeof opps[number];
    label: string;
    stages: OpportunityStage[];
  }> = [
    { field: 'meetingScheduledAt', label: 'Reunião agendada', stages: ['LEAD'] },
    {
      field: 'expectedCloseDate',
      label: 'Fechamento previsto',
      stages: ['OPORTUNIDADE', 'PROPOSTA', 'NEGOCIACAO'],
    },
    {
      field: 'proposalPresentedAt',
      label: 'Apresentação da proposta',
      stages: ['PROPOSTA'],
    },
    {
      field: 'decisionExpectedAt',
      label: 'Decisão do cliente',
      stages: ['PROPOSTA', 'NEGOCIACAO'],
    },
  ];

  for (const opp of opps) {
    for (const c of checks) {
      const value = opp[c.field];
      if (!(value instanceof Date)) continue;
      if (!c.stages.includes(opp.stage)) continue;
      const target = startOfDay(value);
      const diff = daysBetween(target, today);
      if (diff < 0 || !leadSet.has(diff)) continue;

      pending.push({
        type: AlertType.PIPELINE_DATE,
        entityType: 'opportunity',
        entityId: opp.id,
        scheduledFor: target,
        recipientEmail: opp.owner.email,
        payload: {
          opportunityId: opp.id,
          opportunityTitle: opp.title,
          stage: opp.stage,
          marker: c.label,
          field: c.field,
          leadDays: diff,
          centralCrmEmail: tenant.centralCrmEmail,
        },
      });
    }
  }

  // ----- Persiste em alert_logs com dedup -----
  for (const a of pending) {
    if (await alreadyEnqueued(tenantId, a.type, a.entityId, a.scheduledFor)) {
      stats.skippedDuplicates += 1;
      continue;
    }
    await prisma.alertLog.create({
      data: {
        tenantId,
        type: a.type,
        entityType: a.entityType,
        entityId: a.entityId,
        scheduledFor: a.scheduledFor,
        recipientEmail: a.recipientEmail,
        status: AlertStatus.PENDING,
        payload: a.payload as Prisma.InputJsonValue,
      } as Prisma.AlertLogUncheckedCreateInput,
    });
    stats.enqueued += 1;
  }

  return stats;
}

async function resolveRelationshipRecipient(
  tenantId: string,
  entityType: string,
  entityId: string,
): Promise<string | null> {
  if (entityType === ImportantDateEntityType.COMPANY) {
    // Responsável = owner da Opportunity mais recente daquela company; se não
    // houver, cai no Admin do tenant
    const opp = await prisma.opportunity.findFirst({
      where: { tenantId, clientCompanyId: entityId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: { owner: { select: { email: true } } },
    });
    if (opp?.owner.email) return opp.owner.email;
  }
  if (entityType === ImportantDateEntityType.CONTACT) {
    const contact = await prisma.contact.findFirst({
      where: { tenantId, id: entityId, deletedAt: null },
      select: { companyId: true },
    });
    if (contact?.companyId) {
      const opp = await prisma.opportunity.findFirst({
        where: { tenantId, clientCompanyId: contact.companyId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        select: { owner: { select: { email: true } } },
      });
      if (opp?.owner.email) return opp.owner.email;
    }
  }
  // Fallback: primeiro ADMIN ativo do tenant
  const admin = await prisma.user.findFirst({
    where: { tenantId, role: 'ADMIN', active: true, deletedAt: null },
    select: { email: true },
  });
  return admin?.email ?? null;
}

/**
 * Entry point chamado pelo worker BullMQ.
 * Itera por todos os tenants ativos e gera alertas para cada um.
 */
export async function generateDailyAlerts(
  opts: AlertGenerationOptions = {},
): Promise<AlertGenerationStats[]> {
  const today = opts.today ?? new Date();
  return runAsSystem(async () => {
    const tenants = await prisma.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    const results: AlertGenerationStats[] = [];
    for (const t of tenants) {
      try {
        results.push(await generateForTenant(t.id, today));
      } catch (err) {
        console.error(`[alert-generator] tenant ${t.id} falhou:`, err);
      }
    }
    return results;
  });
}

// Exportadas para teste
export const __test = { nextOccurrence, daysBetween, startOfDay };
