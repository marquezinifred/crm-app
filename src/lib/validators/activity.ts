import { z } from 'zod';
import { ActivityType, TaskStatus, TaskPriority } from '@prisma/client';
import { zUuid } from './index';

export const activityCreateInput = z.object({
  opportunityId: zUuid,
  type: z.nativeEnum(ActivityType).default('MANUAL_NOTE'),
  title: z.string().max(160).optional().nullable(),
  content: z.string().min(1).max(20000),
  rawText: z.string().max(40000).optional().nullable(),
  aiSummaryJson: z.unknown().optional().nullable(),
  occurredAt: z.coerce.date().optional(),
});

export const communicationSummaryInput = z.object({
  opportunityId: zUuid,
  text: z.string().min(10).max(20000),
});

export const taskCreateInput = z.object({
  opportunityId: zUuid.optional().nullable(),
  assigneeId: zUuid.optional().nullable(),
  title: z.string().min(2).max(200),
  description: z.string().max(4000).optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  priority: z.nativeEnum(TaskPriority).default('MEDIUM'),
});

export const taskUpdateInput = z.object({
  id: zUuid,
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(4000).optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  assigneeId: zUuid.optional().nullable(),
});

export const taskListInput = z.object({
  opportunityId: zUuid.optional(),
  assigneeId: zUuid.optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  overdueOnly: z.boolean().optional(),
});

export const tasksFromSummaryInput = z.object({
  opportunityId: zUuid,
  activityId: zUuid,
  tasks: z.array(
    z.object({
      title: z.string().min(2).max(200),
      dueDate: z.coerce.date().nullable().optional(),
      assigneeId: zUuid.nullable().optional(),
      priority: z.nativeEnum(TaskPriority).default('MEDIUM'),
    }),
  ).min(1).max(20),
});

export type ActivityCreateInput = z.infer<typeof activityCreateInput>;
export type TaskCreateInput = z.infer<typeof taskCreateInput>;
export type TaskUpdateInput = z.infer<typeof taskUpdateInput>;
