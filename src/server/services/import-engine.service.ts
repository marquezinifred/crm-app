import { prisma } from '@/server/db/client';
import { isValidCnpj, stripCnpj } from '@/lib/validators/cnpj';
import { isValidEmail, normalizeEmail } from '@/lib/validators/email';
import {
  CompanyType,
  ContactRelationshipType,
  ImportDedupStrategy,
  ImportEntity,
  Prisma,
} from '@prisma/client';

/**
 * Engine de importação: dado um mapeamento (column → field) e linhas brutas,
 * valida e persiste cada linha. Retorna estatísticas por tipo de resultado.
 *
 * Idempotência:
 *   - COMPANY: dedup por CNPJ (quando presente)
 *   - CONTACT: dedup por e-mail (sempre)
 *
 * Estratégia de dedup:
 *   - IGNORE_DUPLICATES: linha duplicada vai para skipped
 *   - UPDATE_EXISTING: linha duplicada atualiza o registro existente
 *   - CREATE_NEW: cria novo registro (pode violar unique se CNPJ/email único — entra em error)
 */

export interface ImportError {
  rowNumber: number;
  field: string | null;
  message: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: ImportError[];
}

export interface RunImportInput {
  tenantId: string;
  entity: ImportEntity;
  createdBy: string;
  /** mapping[fieldName] = columnIndex (0-based). */
  mapping: Record<string, number>;
  headers: string[];
  rows: string[][];
  strategy: ImportDedupStrategy;
  /** Callback opcional para progresso (chamado a cada 50 linhas). */
  onProgress?: (processed: number) => Promise<void>;
}

// ----- Helpers de leitura por campo -----

function cell(row: string[], mapping: Record<string, number>, field: string): string {
  const idx = mapping[field];
  if (idx === undefined || idx < 0) return '';
  return (row[idx] ?? '').trim();
}

// ============================================================
// COMPANIES
// ============================================================

export async function importCompanies(input: RunImportInput): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (let i = 0; i < input.rows.length; i++) {
    const rowNumber = i + 2; // +1 cabeçalho, +1 base 1
    const row = input.rows[i]!;

    const razaoSocial = cell(row, input.mapping, 'razaoSocial');
    if (!razaoSocial) {
      result.errors.push({
        rowNumber,
        field: 'razaoSocial',
        message: 'Razão social é obrigatória.',
      });
      continue;
    }

    const cnpjRaw = cell(row, input.mapping, 'cnpj');
    const cnpj = cnpjRaw ? stripCnpj(cnpjRaw) : '';
    if (cnpjRaw && !isValidCnpj(cnpjRaw)) {
      result.errors.push({
        rowNumber,
        field: 'cnpj',
        message: `CNPJ inválido: ${cnpjRaw}`,
      });
      continue;
    }

    const email = cell(row, input.mapping, 'email');
    if (email && !isValidEmail(email)) {
      result.errors.push({ rowNumber, field: 'email', message: `E-mail inválido: ${email}` });
      continue;
    }

    const data: Prisma.CompanyUncheckedCreateInput = {
      tenantId: input.tenantId,
      type: parseCompanyType(cell(row, input.mapping, 'type')),
      razaoSocial,
      nomeFantasia: cell(row, input.mapping, 'nomeFantasia') || null,
      cnpj: cnpj || null,
      country: cell(row, input.mapping, 'country') || 'BR',
      state: cell(row, input.mapping, 'state') || null,
      city: cell(row, input.mapping, 'city') || null,
      email: email ? normalizeEmail(email) : null,
      phone: cell(row, input.mapping, 'phone') || null,
      website: cell(row, input.mapping, 'website') || null,
      createdBy: input.createdBy,
    };

    // Dedup por CNPJ
    const existing = cnpj
      ? await prisma.company.findFirst({
          where: { tenantId: input.tenantId, cnpj, deletedAt: null },
        })
      : null;

    if (existing) {
      if (input.strategy === ImportDedupStrategy.IGNORE_DUPLICATES) {
        result.skipped += 1;
      } else if (input.strategy === ImportDedupStrategy.UPDATE_EXISTING) {
        await prisma.company.update({
          where: { id: existing.id },
          data: { ...data, updatedBy: input.createdBy } as Prisma.CompanyUncheckedUpdateInput,
        });
        result.updated += 1;
      } else {
        result.errors.push({
          rowNumber,
          field: 'cnpj',
          message: 'CNPJ já existe (CREATE_NEW não pode duplicar).',
        });
      }
    } else {
      try {
        await prisma.company.create({ data });
        result.created += 1;
      } catch (err) {
        result.errors.push({
          rowNumber,
          field: null,
          message: err instanceof Error ? err.message : 'erro desconhecido',
        });
      }
    }

    if (input.onProgress && (i + 1) % 50 === 0) {
      await input.onProgress(i + 1);
    }
  }

  if (input.onProgress) await input.onProgress(input.rows.length);
  return result;
}

function parseCompanyType(raw: string): CompanyType {
  const up = raw.toUpperCase();
  if (['CLIENT', 'PARTNER', 'SUPPLIER', 'OWN'].includes(up)) return up as CompanyType;
  if (up === 'CLIENTE') return CompanyType.CLIENT;
  if (up === 'PARCEIRO') return CompanyType.PARTNER;
  if (up === 'FORNECEDOR') return CompanyType.SUPPLIER;
  return CompanyType.CLIENT;
}

// ============================================================
// CONTACTS
// ============================================================

export async function importContacts(input: RunImportInput): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (let i = 0; i < input.rows.length; i++) {
    const rowNumber = i + 2;
    const row = input.rows[i]!;

    const fullName = cell(row, input.mapping, 'fullName');
    const emailRaw = cell(row, input.mapping, 'email');
    if (!fullName) {
      result.errors.push({ rowNumber, field: 'fullName', message: 'Nome obrigatório.' });
      continue;
    }
    if (!emailRaw) {
      result.errors.push({ rowNumber, field: 'email', message: 'E-mail obrigatório.' });
      continue;
    }
    if (!isValidEmail(emailRaw)) {
      result.errors.push({ rowNumber, field: 'email', message: `E-mail inválido: ${emailRaw}` });
      continue;
    }
    const email = normalizeEmail(emailRaw);

    // Resolve company por CNPJ ou razão social, se mapeado
    let companyId: string | null = null;
    const companyCnpjRaw = cell(row, input.mapping, 'companyCnpj');
    const companyRazao = cell(row, input.mapping, 'companyRazaoSocial');
    if (companyCnpjRaw) {
      const c = await prisma.company.findFirst({
        where: {
          tenantId: input.tenantId,
          cnpj: stripCnpj(companyCnpjRaw),
          deletedAt: null,
        },
        select: { id: true },
      });
      if (c) companyId = c.id;
    }
    if (!companyId && companyRazao) {
      const c = await prisma.company.findFirst({
        where: {
          tenantId: input.tenantId,
          razaoSocial: { equals: companyRazao, mode: 'insensitive' },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (c) companyId = c.id;
    }

    const data: Prisma.ContactUncheckedCreateInput = {
      tenantId: input.tenantId,
      companyId,
      fullName,
      email,
      phone: cell(row, input.mapping, 'phone') || null,
      position: cell(row, input.mapping, 'position') || null,
      relationshipType: ContactRelationshipType.CLIENTE,
      createdBy: input.createdBy,
    };

    const existing = await prisma.contact.findFirst({
      where: { tenantId: input.tenantId, email, deletedAt: null },
    });

    if (existing) {
      if (input.strategy === ImportDedupStrategy.IGNORE_DUPLICATES) {
        result.skipped += 1;
      } else if (input.strategy === ImportDedupStrategy.UPDATE_EXISTING) {
        await prisma.contact.update({
          where: { id: existing.id },
          data: { ...data, updatedBy: input.createdBy } as Prisma.ContactUncheckedUpdateInput,
        });
        result.updated += 1;
      } else {
        result.errors.push({
          rowNumber,
          field: 'email',
          message: 'E-mail já existe (CREATE_NEW não pode duplicar).',
        });
      }
    } else {
      try {
        await prisma.contact.create({ data });
        result.created += 1;
      } catch (err) {
        result.errors.push({
          rowNumber,
          field: null,
          message: err instanceof Error ? err.message : 'erro desconhecido',
        });
      }
    }

    if (input.onProgress && (i + 1) % 50 === 0) {
      await input.onProgress(i + 1);
    }
  }

  if (input.onProgress) await input.onProgress(input.rows.length);
  return result;
}

// ============================================================
// Entry-point chamado pelo worker
// ============================================================

export async function runImport(input: RunImportInput): Promise<ImportResult> {
  if (input.entity === ImportEntity.COMPANY) return importCompanies(input);
  if (input.entity === ImportEntity.CONTACT) return importContacts(input);
  throw new Error(`Importação de ${input.entity} não implementada (Sprint 9 cobre COMPANY e CONTACT).`);
}

/**
 * Campos disponíveis por entidade — usado pela UI de mapeamento.
 */
export const IMPORT_FIELDS: Record<ImportEntity, Array<{ name: string; label: string; required?: boolean }>> = {
  COMPANY: [
    { name: 'razaoSocial', label: 'Razão social', required: true },
    { name: 'nomeFantasia', label: 'Nome fantasia' },
    { name: 'cnpj', label: 'CNPJ' },
    { name: 'type', label: 'Tipo (CLIENT/PARTNER/SUPPLIER/OWN)' },
    { name: 'country', label: 'País' },
    { name: 'state', label: 'Estado/UF' },
    { name: 'city', label: 'Cidade' },
    { name: 'email', label: 'E-mail corporativo' },
    { name: 'phone', label: 'Telefone' },
    { name: 'website', label: 'Website' },
  ],
  CONTACT: [
    { name: 'fullName', label: 'Nome completo', required: true },
    { name: 'email', label: 'E-mail', required: true },
    { name: 'phone', label: 'Telefone' },
    { name: 'position', label: 'Cargo' },
    { name: 'companyCnpj', label: 'CNPJ da empresa (para vincular)' },
    { name: 'companyRazaoSocial', label: 'Razão social da empresa (para vincular)' },
  ],
  OPPORTUNITY: [],
  USER: [],
};
