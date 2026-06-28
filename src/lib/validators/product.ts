import { z } from 'zod';
import { ProductType } from '@prisma/client';
import { zUuid, zPercent } from './index';

export const productCreateInput = z.object({
  name: z.string().min(2).max(120),
  type: z.nativeEnum(ProductType),
  sku: z.string().max(32).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  minMarginPct: zPercent.default(0),
  active: z.boolean().default(true),
});

export const productUpdateInput = productCreateInput.partial().extend({ id: zUuid });

export const productListInput = z.object({
  active: z.boolean().optional(),
  search: z.string().max(80).optional(),
});

export type ProductCreateInput = z.infer<typeof productCreateInput>;
export type ProductUpdateInput = z.infer<typeof productUpdateInput>;
