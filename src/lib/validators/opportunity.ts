import { z } from 'zod';
import {
  OpportunityStage,
  OpportunityStatus,
  OpportunitySource,
  OpportunityLossReason,
} from '@prisma/client';
import { zUuid, zPercent } from './index';

export const opportunityCreateInput = z.object({
  title: z.string().min(2).max(160),
  clientCompanyId: zUuid,
  clientContactId: zUuid.optional().nullable(),
  partnerCompanyId: zUuid.optional().nullable(),
  partnerContactId: zUuid.optional().nullable(),
  ownerId: zUuid,
  source: z.nativeEnum(OpportunitySource),
  sourceDetail: z.string().max(200).optional().nullable(),
  estimatedValue: z.coerce.number().nonnegative().finite().optional().nullable(),
  expectedCloseDate: z.coerce.date().optional().nullable(),
  description: z.string().max(4000).optional().nullable(),
  commissionPctOverride: zPercent.optional().nullable(),
});

export const opportunityUpdateInput = opportunityCreateInput.partial().extend({
  id: zUuid,
  // Campos por estágio
  meetingScheduledAt: z.coerce.date().optional().nullable(),
  meetingHappened: z.boolean().optional().nullable(),
  briefing: z.string().max(8000).optional().nullable(),
  proposalPresentedAt: z.coerce.date().optional().nullable(),
  decisionExpectedAt: z.coerce.date().optional().nullable(),
  estimatedTeamNotes: z.string().max(4000).optional().nullable(),
  acceptedAt: z.coerce.date().optional().nullable(),
});

export const opportunityListInput = z.object({
  stage: z.nativeEnum(OpportunityStage).optional(),
  status: z.nativeEnum(OpportunityStatus).optional(),
  ownerId: zUuid.optional(),
  clientCompanyId: zUuid.optional(),
  partnerCompanyId: zUuid.optional(),
  search: z.string().max(80).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});

export const opportunityKanbanInput = z.object({
  ownerId: zUuid.optional(),
  segmentId: zUuid.optional(),
  territoryId: zUuid.optional(),
});

export const opportunityAdvanceInput = z.object({
  id: zUuid,
  fromStage: z.nativeEnum(OpportunityStage),
  toStage: z.nativeEnum(OpportunityStage),
  note: z.string().max(500).optional(),
});

export const opportunityCancelInput = z.object({
  id: zUuid,
  reason: z.string().min(3).max(500),
  lossReason: z.nativeEnum(OpportunityLossReason).optional(),
});

export const opportunityTeamMemberInput = z.object({
  opportunityId: zUuid,
  userId: zUuid,
  roleInTeam: z.string().max(80).optional(),
});

export type OpportunityCreateInput = z.infer<typeof opportunityCreateInput>;
export type OpportunityUpdateInput = z.infer<typeof opportunityUpdateInput>;
export type OpportunityListInput = z.infer<typeof opportunityListInput>;
