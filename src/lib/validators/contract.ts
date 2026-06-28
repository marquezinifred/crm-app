import { z } from 'zod';
import { ContractStatus, InstallmentStatus } from '@prisma/client';
import { zUuid, zCnpj, zEmail } from './index';

const billingDataSchema = z.object({
  razaoSocial: z.string().min(2).max(160),
  cnpj: zCnpj,
  endereco: z.string().max(300).optional(),
  email: zEmail.optional(),
  observacoes: z.string().max(1000).optional(),
});

export const contractCreateInput = z.object({
  opportunityId: zUuid,
  number: z.string().max(40).optional().nullable(),
  totalValue: z.coerce.number().nonnegative().finite(),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  ndaKey: z.string().max(500).optional().nullable(),
  termsKey: z.string().max(500).optional().nullable(),
  contractKey: z.string().max(500).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

export const contractUpdateInput = contractCreateInput.partial().extend({
  id: zUuid,
  status: z.nativeEnum(ContractStatus).optional(),
  ndaSignedAt: z.coerce.date().optional().nullable(),
  termsSignedAt: z.coerce.date().optional().nullable(),
});

export const installmentCreateInput = z.object({
  contractId: zUuid,
  number: z.number().int().min(1).max(120),
  dueDate: z.coerce.date(),
  value: z.coerce.number().nonnegative().finite(),
  billingData: billingDataSchema,
  invoiceNumber: z.string().max(40).optional().nullable(),
});

export const installmentUpdateInput = installmentCreateInput.partial().extend({
  id: zUuid,
  status: z.nativeEnum(InstallmentStatus).optional(),
  paidAt: z.coerce.date().optional().nullable(),
});

export type ContractCreateInput = z.infer<typeof contractCreateInput>;
export type InstallmentCreateInput = z.infer<typeof installmentCreateInput>;
