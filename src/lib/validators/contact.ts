import { z } from 'zod';
import {
  ContactSeniority,
  ContactRelationshipType,
  ContactFunction,
  WorkArea,
  ContactApprovalStatus,
} from '@prisma/client';
import { zEmail, zBrPhone, zUuid } from './index';

const importantDateInput = z.object({
  dateType: z.enum(['ANIVERSARIO', 'FUNDACAO', 'RENOVACAO', 'CUSTOM']),
  label: z.string().max(120).nullable().optional(),
  dateValue: z.coerce.date(),
  alertActive: z.boolean().default(true),
});

export const contactCreateInput = z.object({
  companyId: zUuid.optional().nullable(),
  fullName: z.string().min(2).max(160),
  email: zEmail,
  phone: zBrPhone.optional().nullable(),
  position: z.string().max(120).optional().nullable(),
  function: z.nativeEnum(ContactFunction).optional().nullable(),
  seniority: z.nativeEnum(ContactSeniority).optional().nullable(),
  workArea: z.nativeEnum(WorkArea).optional().nullable(),
  specialty: z.string().max(120).optional().nullable(),
  relationshipType: z.nativeEnum(ContactRelationshipType).default('CLIENTE'),
  notes: z.string().max(4000).optional().nullable(),
  importantDates: z.array(importantDateInput).max(20).optional(),
});

export const contactUpdateInput = contactCreateInput.partial().extend({
  id: zUuid,
  active: z.boolean().optional(),
});

export const contactListInput = z.object({
  companyId: zUuid.optional(),
  approvalStatus: z.nativeEnum(ContactApprovalStatus).optional(),
  search: z.string().max(80).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});

export const contactSelfRegisterInput = z.object({
  tenantSlug: z.string().min(2).max(60),
  fullName: z.string().min(2).max(160),
  email: zEmail,
  phone: zBrPhone.optional().nullable(),
  companyRazaoSocial: z.string().max(160).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export const contactApprovalInput = z.object({
  id: zUuid,
  decision: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().max(500).optional(),
});

export type ContactCreateInput = z.infer<typeof contactCreateInput>;
export type ContactUpdateInput = z.infer<typeof contactUpdateInput>;
export type ContactListInput = z.infer<typeof contactListInput>;
export type ContactSelfRegisterInput = z.infer<typeof contactSelfRegisterInput>;
