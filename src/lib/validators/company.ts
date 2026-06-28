import { z } from 'zod';
import { CompanyType } from '@prisma/client';
import { zCnpj, zEmail, zBrPhone, zUuid, zPercent } from './index';

const importantDateInput = z.object({
  dateType: z.enum(['ANIVERSARIO', 'FUNDACAO', 'RENOVACAO', 'CUSTOM']),
  label: z.string().max(120).nullable().optional(),
  dateValue: z.coerce.date(),
  alertActive: z.boolean().default(true),
});

export const companyCreateInput = z.object({
  type: z.nativeEnum(CompanyType),
  razaoSocial: z.string().min(2).max(160),
  nomeFantasia: z.string().max(160).optional().nullable(),
  cnpj: zCnpj.optional().nullable(),
  cnaeCode: z.string().regex(/^\d{4}-?\d\/\d{2}$|^\d{7}$/).optional().nullable(),
  cnaeName: z.string().max(120).optional().nullable(),
  country: z.string().length(2).default('BR'),
  state: z.string().max(40).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  territoryId: zUuid.optional().nullable(),
  segmentId: zUuid.optional().nullable(),
  email: zEmail.optional().nullable(),
  phone: zBrPhone.optional().nullable(),
  website: z.string().url().max(200).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  commissionPct: zPercent.optional().nullable(),
  tcVersion: z.string().max(40).optional().nullable(),
  tcText: z.string().max(20000).optional().nullable(),
  importantDates: z.array(importantDateInput).max(20).optional(),
});

export const companyUpdateInput = companyCreateInput.partial().extend({
  id: zUuid,
});

export const companyListInput = z.object({
  type: z.nativeEnum(CompanyType).optional(),
  territoryId: zUuid.optional(),
  segmentId: zUuid.optional(),
  search: z.string().max(80).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});

export type CompanyCreateInput = z.infer<typeof companyCreateInput>;
export type CompanyUpdateInput = z.infer<typeof companyUpdateInput>;
export type CompanyListInput = z.infer<typeof companyListInput>;
