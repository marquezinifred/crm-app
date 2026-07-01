import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '@/server/trpc/trpc';
import { withCapability } from '@/server/trpc/middlewares';
import { prisma } from '@/server/db/client';
import { audit } from '@/server/services/audit.service';
import { summarizeCommunication } from '@/server/services/communication-summary.service';
import {
  AiLimitExceededError,
  FeatureNotAvailableError,
} from '@/lib/ai/feature-gate';
import {
  activityCreateInput,
  communicationSummaryInput,
} from '@/lib/validators/activity';
import { zUuid } from '@/lib/validators';
import { ActivityType, Prisma } from '@prisma/client';

const canRead = withCapability('opportunity', 'read');
const canWrite = withCapability('opportunity', 'update');
const canUseAI = withCapability('ai', 'use_summary');

export const activitiesRouter = router({
  list: canRead
    .input(z.object({ opportunityId: zUuid }))
    .query(({ input }) =>
      prisma.activity.findMany({
        where: { opportunityId: input.opportunityId, deletedAt: null },
        orderBy: { occurredAt: 'desc' },
        take: 200,
        include: { author: { select: { id: true, fullName: true } } },
      }),
    ),

  create: canWrite.input(activityCreateInput).mutation(async ({ input, ctx }) => {
    const created = await prisma.activity.create({
      data: {
        tenantId: ctx.tenantId,
        opportunityId: input.opportunityId,
        authorId: ctx.user.id,
        type: input.type,
        title: input.title ?? null,
        content: input.content,
        rawText: input.rawText ?? null,
        aiSummaryJson: input.aiSummaryJson as Prisma.InputJsonValue | undefined,
        occurredAt: input.occurredAt ?? new Date(),
        createdBy: ctx.user.id,
      } as Prisma.ActivityUncheckedCreateInput,
    });
    await audit({
      action: 'activity.create',
      tableName: 'activities',
      recordId: created.id,
      after: { type: created.type, opportunityId: created.opportunityId },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      tenantIdOverride: ctx.tenantId,
    });
    return created;
  }),

  /**
   * Receptor de comunicações: gestor cola texto → IA processa → preview com 4 blocos.
   * NÃO grava a activity ainda — o gestor revisa e chama confirmCommunicationSummary
   * para persistir + criar tarefas.
   *
   * Erros separados:
   *   - NOT_FOUND: oportunidade não existe (ou foi removida)
   *   - PRECONDITION_FAILED: oportunidade encerrada OU feature de IA não está
   *     liberada no plano do tenant (mensagem clara em vez de "IA indisponível")
   *   - TOO_MANY_REQUESTS: limite de tokens/requests do tenant atingido
   *   - aiGenerated:false no payload: provider real (Anthropic) falhou —
   *     UI cai pro modo manual e mostra "IA indisponível"
   */
  summarize: canUseAI.input(communicationSummaryInput).mutation(async ({ input, ctx }) => {
    const opp = await prisma.opportunity.findFirst({
      where: { id: input.opportunityId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!opp) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Oportunidade não encontrada.',
      });
    }
    if (opp.status !== 'ACTIVE') {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Oportunidade encerrada não aceita novos resumos.',
      });
    }
    try {
      return await summarizeCommunication({
        text: input.text,
        tenantId: ctx.tenantId,
        userId: ctx.user.id,
        opportunityId: input.opportunityId,
      });
    } catch (err) {
      if (err instanceof FeatureNotAvailableError) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message });
      }
      if (err instanceof AiLimitExceededError) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: err.message });
      }
      throw err;
    }
  }),

  /**
   * Confirma o resumo gerado pela IA:
   *   - grava activity com aiSummaryJson + rawText original
   *   - cria as tarefas confirmadas pelo gestor
   */
  confirmSummary: canWrite
    .input(
      z.object({
        opportunityId: zUuid,
        rawText: z.string().min(1).max(40000),
        summary: z.object({
          themes: z.array(z.string()),
          adjustments: z.array(z.string()),
          decisions: z.array(z.string()),
        }),
        confirmedTasks: z.array(
          z.object({
            title: z.string().min(2).max(200),
            dueDate: z.coerce.date().nullable().optional(),
            assigneeId: zUuid.nullable().optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const activity = await prisma.$transaction(async (tx) => {
        const a = await tx.activity.create({
          data: {
            tenantId: ctx.tenantId,
            opportunityId: input.opportunityId,
            authorId: ctx.user.id,
            type: ActivityType.AI_SUMMARY,
            title: 'Resumo de comunicação (IA)',
            content: [
              ...input.summary.themes.map((t) => `• Tema: ${t}`),
              ...input.summary.adjustments.map((t) => `• Ajuste: ${t}`),
              ...input.summary.decisions.map((t) => `• Decisão: ${t}`),
            ].join('\n'),
            rawText: input.rawText,
            aiSummaryJson: input.summary as Prisma.InputJsonValue,
            createdBy: ctx.user.id,
          } as Prisma.ActivityUncheckedCreateInput,
        });

        for (const t of input.confirmedTasks) {
          await tx.task.create({
            data: {
              tenantId: ctx.tenantId,
              opportunityId: input.opportunityId,
              assigneeId: t.assigneeId ?? ctx.user.id,
              title: t.title,
              dueDate: t.dueDate ?? null,
              createdBy: ctx.user.id,
            } as Prisma.TaskUncheckedCreateInput,
          });
        }

        return a;
      });

      await audit({
        action: 'activity.confirm_summary',
        tableName: 'activities',
        recordId: activity.id,
        after: { tasksCreated: input.confirmedTasks.length },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });

      return { activityId: activity.id, tasksCreated: input.confirmedTasks.length };
    }),
});

export const tasksRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          opportunityId: zUuid.optional(),
          assigneeId: zUuid.optional(),
          status: z.enum(['TODO', 'DOING', 'DONE', 'CANCELLED']).optional(),
          overdueOnly: z.boolean().optional(),
        })
        .default({}),
    )
    .query(({ input }) =>
      prisma.task.findMany({
        where: {
          deletedAt: null,
          ...(input.opportunityId ? { opportunityId: input.opportunityId } : {}),
          ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.overdueOnly
            ? { dueDate: { lt: new Date() }, status: { in: ['TODO', 'DOING'] } }
            : {}),
        },
        orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }],
        take: 200,
        include: {
          assignee: { select: { id: true, fullName: true } },
          opportunity: { select: { id: true, title: true } },
        },
      }),
    ),

  myOpen: protectedProcedure.query(({ ctx }) =>
    prisma.task.findMany({
      where: {
        assigneeId: ctx.user.id,
        status: { in: ['TODO', 'DOING'] },
        deletedAt: null,
      },
      orderBy: { dueDate: 'asc' },
      take: 50,
      include: { opportunity: { select: { id: true, title: true } } },
    }),
  ),

  create: canWrite
    .input(
      z.object({
        opportunityId: zUuid.optional().nullable(),
        title: z.string().min(2).max(200),
        description: z.string().max(4000).optional().nullable(),
        dueDate: z.coerce.date().optional().nullable(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
        assigneeId: zUuid.optional().nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const t = await prisma.task.create({
        data: {
          tenantId: ctx.tenantId,
          opportunityId: input.opportunityId ?? null,
          assigneeId: input.assigneeId ?? ctx.user.id,
          title: input.title,
          description: input.description ?? null,
          dueDate: input.dueDate ?? null,
          priority: input.priority,
          createdBy: ctx.user.id,
        } as Prisma.TaskUncheckedCreateInput,
      });
      await audit({
        action: 'task.create',
        tableName: 'tasks',
        recordId: t.id,
        after: t,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return t;
    }),

  updateStatus: canWrite
    .input(
      z.object({
        id: zUuid,
        status: z.enum(['TODO', 'DOING', 'DONE', 'CANCELLED']),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const before = await prisma.task.findFirst({ where: { id: input.id, deletedAt: null } });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
      const updated = await prisma.task.update({
        where: { id: input.id },
        data: {
          status: input.status,
          completedAt: input.status === 'DONE' ? new Date() : null,
          updatedBy: ctx.user.id,
        } as Prisma.TaskUncheckedUpdateInput,
      });
      await audit({
        action: 'task.update_status',
        tableName: 'tasks',
        recordId: updated.id,
        before: { status: before.status },
        after: { status: updated.status },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        tenantIdOverride: ctx.tenantId,
      });
      return updated;
    }),
});
