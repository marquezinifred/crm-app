/**
 * Schemas Zod compartilhados entre frontend e backend.
 * Toda entrada de usuário deve passar por aqui antes de chegar ao banco.
 */

import { z } from 'zod';
import { isValidCnpj, stripCnpj, formatCnpj } from './cnpj';
import { isValidCpf, stripCpf } from './cpf';
import { isValidBrPhone, normalizeBrPhone } from './phone';
import { isValidEmail, normalizeEmail } from './email';
import { parseBrDate } from './dates';

export const zCnpj = z
  .string()
  .min(14)
  .max(18)
  .transform((v) => stripCnpj(v))
  .refine(isValidCnpj, { message: 'CNPJ inválido' });

export const zCnpjFormatted = zCnpj.transform((v) => formatCnpj(v));

export const zCpf = z
  .string()
  .transform((v) => stripCpf(v))
  .refine(isValidCpf, { message: 'CPF inválido' });

export const zEmail = z
  .string()
  .min(3)
  .max(254)
  .transform(normalizeEmail)
  .refine(isValidEmail, { message: 'E-mail inválido' });

export const zBrPhone = z
  .string()
  .transform((v) => normalizeBrPhone(v))
  .refine(isValidBrPhone, { message: 'Telefone inválido' });

export const zBrDate = z
  .string()
  .transform((v, ctx) => {
    const date = parseBrDate(v);
    if (!date) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Data inválida' });
      return z.NEVER;
    }
    return date;
  });

export const zSlug = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9-]+$/, 'Slug deve ter apenas letras minúsculas, números e hífens');

export const zUuid = z.string().uuid();

export const zPositiveDecimal = z.coerce.number().nonnegative().finite();

export const zPercent = z.coerce.number().min(0).max(100).finite();

export * from './cnpj';
export * from './cpf';
export * from './phone';
export * from './email';
export * from './dates';
