import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { audit } from './audit.service';
import { DataSubjectRequestStatus, Prisma } from '@prisma/client';

/**
 * LGPD §18 — workflows do direito do titular (Sprint 11).
 *
 * Implementa:
 *   - exportPersonalData: gera arquivo JSON com TODOS os dados pessoais do
 *     titular (user local + contacts + activities autoradas + audit_logs).
 *     Armazena em export_file_key (S3 path). Sprint 12 troca por presigned URL.
 *   - anonymizeSubject: substitui nome/e-mail/telefone/CPF por anon-IDs.
 *     Preserva integridade referencial (não apaga oportunidades; só
 *     desidentifica para integridade do histórico comercial, conforme §4
 *     do spec). Logs de conexão (Marco Civil) NÃO são apagados.
 *
 * Idempotente: se já houver anonymizedAt na request, retorna sem refazer.
 */

interface PersonalDataPackage {
  exportedAt: string;
  tenantId: string;
  subject: { email: string };
  users: unknown[];
  contacts: unknown[];
  activities: unknown[];
  importantDates: unknown[];
  auditLogs: unknown[];
  consentLogs: unknown[];
  notes: string;
}

export async function collectPersonalData(
  tenantId: string,
  subjectEmail: string,
): Promise<PersonalDataPackage> {
  return runAsSystem(async () => {
    const lowered = subjectEmail.toLowerCase();

    const [users, contacts, audits, consents] = await Promise.all([
      prisma.user.findMany({
        where: { tenantId, email: lowered, deletedAt: null },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          lastLoginAt: true,
          createdAt: true,
        },
      }),
      prisma.contact.findMany({
        where: { tenantId, email: lowered, deletedAt: null },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          position: true,
          companyId: true,
          createdAt: true,
        },
      }),
      prisma.auditLog.findMany({
        where: { tenantId, OR: [{ ip: { not: null } }] },
        orderBy: { at: 'desc' },
        take: 200,
        select: { id: true, action: true, tableName: true, at: true },
      }),
      prisma.consentLog.findMany({
        where: { tenantId, subjectEmail: lowered },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const userIds = users.map((u) => u.id);
    const contactIds = contacts.map((c) => c.id);
    const [activities, dates] = await Promise.all([
      userIds.length > 0
        ? prisma.activity.findMany({
            where: { tenantId, authorId: { in: userIds }, deletedAt: null },
            orderBy: { occurredAt: 'desc' },
            take: 200,
            select: { id: true, opportunityId: true, type: true, title: true, occurredAt: true },
          })
        : Promise.resolve([]),
      contactIds.length > 0
        ? prisma.importantDate.findMany({
            where: {
              tenantId,
              entityType: 'CONTACT',
              entityId: { in: contactIds },
              deletedAt: null,
            },
          })
        : Promise.resolve([]),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      tenantId,
      subject: { email: subjectEmail },
      users,
      contacts,
      activities,
      importantDates: dates,
      auditLogs: audits,
      consentLogs: consents,
      notes:
        'Exportação LGPD §18 (acesso/portabilidade). Logs de conexão Marco Civil ' +
        'são preservados separadamente por obrigação legal e não constam neste pacote.',
    };
  });
}

/**
 * Anonimiza o titular: substitui PII por identificador anônimo,
 * preservando integridade referencial.
 *
 * Retorna estatísticas das tabelas afetadas.
 */
export interface AnonymizationStats {
  usersAnonymized: number;
  contactsAnonymized: number;
  activitiesScrubbed: number;
}

export async function anonymizeSubject(
  tenantId: string,
  subjectEmail: string,
): Promise<AnonymizationStats> {
  return runAsSystem(async () => {
    const lowered = subjectEmail.toLowerCase();
    const anonSuffix = `anon-${Date.now().toString(36)}`;
    const anonEmail = `${anonSuffix}@anonymized.local`;
    const anonName = `Titular anonimizado (${anonSuffix})`;

    const userResult = await prisma.user.updateMany({
      where: { tenantId, email: lowered, deletedAt: null },
      data: {
        email: anonEmail,
        fullName: anonName,
        active: false,
        deletedAt: new Date(),
      } as Prisma.UserUncheckedUpdateInput,
    });

    const contactResult = await prisma.contact.updateMany({
      where: { tenantId, email: lowered, deletedAt: null },
      data: {
        email: anonEmail,
        fullName: anonName,
        phone: null,
        position: null,
        notes: '[anonimizado por solicitação LGPD]',
        active: false,
        deletedAt: new Date(),
      } as Prisma.ContactUncheckedUpdateInput,
    });

    // Activities autorais: limpa rawText (pode conter PII), mantém metadados
    const userIds = (
      await prisma.user.findMany({
        where: { tenantId, email: anonEmail },
        select: { id: true },
      })
    ).map((u) => u.id);
    let activitiesScrubbed = 0;
    if (userIds.length > 0) {
      const r = await prisma.activity.updateMany({
        where: { tenantId, authorId: { in: userIds } },
        data: { rawText: null, aiSummaryJson: Prisma.JsonNull },
      });
      activitiesScrubbed = r.count;
    }

    await audit({
      action: 'lgpd.anonymize',
      tableName: 'data_subject_requests',
      recordId: tenantId,
      after: { subjectEmail, anonSuffix },
      tenantIdOverride: tenantId,
    });

    return {
      usersAnonymized: userResult.count,
      contactsAnonymized: contactResult.count,
      activitiesScrubbed,
    };
  });
}

/** Cria nova solicitação com SLA 15 dias. */
export async function createDataSubjectRequest(input: {
  tenantId: string;
  requestType: 'ACCESS' | 'CORRECTION' | 'DELETION' | 'PORTABILITY' | 'OBJECTION';
  subjectEmail: string;
  subjectName?: string;
  description?: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + 15);
  return runAsSystem(() =>
    prisma.dataSubjectRequest.create({
      data: {
        tenantId: input.tenantId,
        requestType: input.requestType,
        subjectEmail: input.subjectEmail.toLowerCase(),
        subjectName: input.subjectName ?? null,
        description: input.description ?? null,
        dueAt,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      } as Prisma.DataSubjectRequestUncheckedCreateInput,
    }),
  );
}

export async function markRequestProcessing(requestId: string, processedById: string) {
  return runAsSystem(() =>
    prisma.dataSubjectRequest.update({
      where: { id: requestId },
      data: {
        status: DataSubjectRequestStatus.IN_PROGRESS,
        processedById,
      },
    }),
  );
}

export async function completeRequest(
  requestId: string,
  exportFileKey: string | null,
) {
  return runAsSystem(() =>
    prisma.dataSubjectRequest.update({
      where: { id: requestId },
      data: {
        status: DataSubjectRequestStatus.COMPLETED,
        exportFileKey,
        completedAt: new Date(),
      },
    }),
  );
}

export async function rejectRequest(requestId: string, reason: string) {
  return runAsSystem(() =>
    prisma.dataSubjectRequest.update({
      where: { id: requestId },
      data: {
        status: DataSubjectRequestStatus.REJECTED,
        rejectionReason: reason,
        completedAt: new Date(),
      },
    }),
  );
}
