import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { audit } from '@/server/services/audit.service';
import {
  checkRate,
  SENDER_INBOUND_LIMIT,
  senderInboundKey,
} from '@/server/services/rate-limiter.service';
import { parseLead, type ParsedLead, type ParseSource } from './inbound-parser.service';
import type { Company, Contact, Opportunity } from '@prisma/client';

/**
 * Sprint 15D — Criação automática de oportunidade a partir de lead inbound.
 *
 * Fluxo:
 *   1. parseLead(raw, source) — regex ou IA
 *   2. Anti-spam: blacklist domain / confidence baixa → rejected
 *   3. findOrCreateCompany (dedup por CNPJ ou nome)
 *   4. findOrCreateContact (dedup por email dentro da company)
 *   5. Cria Opportunity is_inbound=true, owner_id=NULL, stage=PROSPECT
 *   6. audit com tenantIdOverride
 *   7. (worker) notifica gestores de inbound
 *
 * Todas as operações rodam em runAsSystem (não temos userId autenticado
 * — o webhook é público). Ainda assim, tenantId é sempre passado
 * explicitamente pra Prisma extension enforçar.
 */

export type CreateResult =
  | { kind: 'created'; opportunityId: string; parsed: ParsedLead }
  | { kind: 'rejected'; rejectedId: string; reason: string };

export interface CreateInboundLeadInput {
  tenantId: string;
  source: ParseSource;
  raw: string | Record<string, unknown>;
  receivedAt?: Date;
  /** Origem do parser: quando webhook, o secret usado; quando email, o endereço. */
  originIdentifier?: string;
}

const MIN_CONFIDENCE = 0.4;

/**
 * Retorna true se o email/domínio bate em algum padrão da blacklist do
 * tenant. Match case-insensitive; suporta "example.com" (domínio inteiro)
 * ou "spam@" (prefixo de user).
 */
export function isBlacklisted(
  email: string | undefined,
  blacklist: readonly string[],
): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  for (const raw of blacklist) {
    const pattern = raw.toLowerCase().trim();
    if (!pattern) continue;
    if (pattern.startsWith('@') && e.endsWith(pattern)) return true;
    if (pattern.includes('@') && e === pattern) return true;
    if (!pattern.includes('@') && e.endsWith(`@${pattern}`)) return true;
  }
  return false;
}

/**
 * Resolve Company existente por CNPJ (case-sensitive já normalizado) ou
 * nome exato (razaoSocial/nomeFantasia). Cria uma nova em CLIENT type
 * quando não encontra.
 *
 * A companhia criada é do tipo CLIENT (leads inbound são futuros clientes).
 */
export async function findOrCreateCompany(
  tenantId: string,
  parsedCompany: ParsedLead['company'],
): Promise<Company> {
  const { cnpj, name, website, segment } = parsedCompany;

  // 1. Lookup por CNPJ (dedup forte). Prisma extension injeta tenantId.
  if (cnpj) {
    const existing = await prisma.company.findFirst({
      where: { tenantId, cnpj, deletedAt: null },
    });
    if (existing) return existing;
  }

  // 2. Lookup por razaoSocial ou nomeFantasia case-insensitive (nome exato)
  if (name && !cnpj) {
    const existing = await prisma.company.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          { razaoSocial: { equals: name, mode: 'insensitive' } },
          { nomeFantasia: { equals: name, mode: 'insensitive' } },
        ],
      },
    });
    if (existing) return existing;
  }

  // 3. Não achou — cria. Se não tem name, usa placeholder derivado.
  const razaoSocial = name?.trim() || `Lead inbound (${cnpj ?? 'sem CNPJ'})`;
  return prisma.company.create({
    data: {
      tenantId,
      type: 'CLIENT',
      razaoSocial,
      cnpj: cnpj ?? null,
      website: website ?? null,
      // segment textual do parser não vira industryId — só admin/UI liga isso.
      // Guardamos como notes pra revisão.
      notes: segment ? `Segmento sugerido pelo lead: ${segment}` : null,
    },
  });
}

/**
 * Resolve Contact existente por email (dedup) dentro da company; cria se
 * não achar. Se email ausente, cria Contact sem email (raro; parser exige
 * email OU cnpj mínimo).
 */
export async function findOrCreateContact(
  tenantId: string,
  companyId: string,
  parsedContact: ParsedLead['contact'],
): Promise<Contact> {
  const { email, name, phone, role } = parsedContact;

  if (email) {
    const existing = await prisma.contact.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        email: { equals: email, mode: 'insensitive' },
      },
    });
    if (existing) {
      // Vincula à company se ainda não tem
      if (!existing.companyId) {
        return prisma.contact.update({
          where: { id: existing.id },
          data: { companyId },
        });
      }
      return existing;
    }
  }

  const fullName = name?.trim() || (email ? email.split('@')[0]! : 'Lead sem nome');
  return prisma.contact.create({
    data: {
      tenantId,
      companyId,
      fullName,
      // Contact.email é @db.Citext NOT NULL — fallback pra placeholder
      // legível em casos raros de webhook sem email.
      email: email ?? `sem-email+${Date.now()}@lead-inbound.local`,
      phone: phone ?? null,
      position: role ?? null,
      relationshipType: 'CLIENTE',
      selfRegistered: false,
      approvalStatus: 'APPROVED',
    },
  });
}

async function saveRejected(
  tenantId: string,
  input: CreateInboundLeadInput,
  parsed: ParsedLead | null,
  reason: string,
): Promise<string> {
  const rej = await prisma.inboundLeadRejected.create({
    data: {
      tenantId,
      source: input.source,
      rawPayload:
        typeof input.raw === 'string'
          ? { text: input.raw }
          : (input.raw as object),
      parsedJson: parsed
        ? ({ ...parsed, confidence: parsed.confidence.toString() } as object)
        : undefined,
      confidence: parsed?.confidence ?? null,
      reason,
    },
  });
  return rej.id;
}

/**
 * Cria opportunity inbound OU registra como rejected. Não notifica ninguém
 * — worker é responsável por isso (permite testar service sem push/email).
 */
export async function createInboundLead(
  input: CreateInboundLeadInput,
): Promise<CreateResult> {
  return runAsSystem(async () => {
    // 1. Carrega config anti-spam
    const config = await prisma.inboundCaptureConfig.findUnique({
      where: { tenantId: input.tenantId },
    });
    const blacklist = config?.blacklistDomains ?? [];

    // 2. Parser
    let parsed: ParsedLead | null;
    try {
      parsed = await parseLead({
        tenantId: input.tenantId,
        raw: input.raw,
        source: input.source,
      });
    } catch (err) {
      // Feature gate error ou IA falhou irrecuperavelmente
      const rejectedId = await saveRejected(
        input.tenantId,
        input,
        null,
        `parse_error:${err instanceof Error ? err.name : 'unknown'}`,
      );
      return { kind: 'rejected', rejectedId, reason: 'parse_error' };
    }

    if (!parsed) {
      const rejectedId = await saveRejected(input.tenantId, input, null, 'no_signal');
      return { kind: 'rejected', rejectedId, reason: 'no_signal' };
    }

    // 3. Blacklist
    if (isBlacklisted(parsed.contact.email, blacklist)) {
      const rejectedId = await saveRejected(
        input.tenantId,
        input,
        parsed,
        'blacklisted_domain',
      );
      return { kind: 'rejected', rejectedId, reason: 'blacklisted_domain' };
    }

    // 4. Confidence baixa
    if (parsed.confidence < MIN_CONFIDENCE) {
      const rejectedId = await saveRejected(
        input.tenantId,
        input,
        parsed,
        'low_confidence',
      );
      return { kind: 'rejected', rejectedId, reason: 'low_confidence' };
    }

    // 4.1. P-29 — rate limit por sender email. PUBLIC_FORM_LIMIT do endpoint
    // trava por IP, mas integradores como Zapier rotacionam IP. Aqui capamos
    // 10 leads/hora por email dentro do mesmo tenant. Lead sem email pula
    // esse gate (parser exige email OU cnpj mínimo — CNPJ segue passando).
    if (parsed.contact.email) {
      const rl = await checkRate(
        senderInboundKey(input.tenantId, parsed.contact.email),
        SENDER_INBOUND_LIMIT.limit,
        SENDER_INBOUND_LIMIT.windowSeconds,
      );
      if (!rl.allowed) {
        const rejectedId = await saveRejected(
          input.tenantId,
          input,
          parsed,
          'rate_limited_per_sender',
        );
        return {
          kind: 'rejected',
          rejectedId,
          reason: 'rate_limited_per_sender',
        };
      }
    }

    // 5. Resolve company + contact
    const company = await findOrCreateCompany(input.tenantId, parsed.company);
    const contact = await findOrCreateContact(input.tenantId, company.id, parsed.contact);

    // 6. Lead source INBOUND — default pra rastreio em relatórios
    const leadSource = await getOrCreateLeadSourceInbound(input.tenantId);

    // 7. Cria opportunity — owner NULL até Gestor de Inbound alocar
    const title = deriveOpportunityTitle(parsed, company.razaoSocial);
    const opp: Opportunity = await prisma.opportunity.create({
      data: {
        tenantId: input.tenantId,
        title,
        clientCompanyId: company.id,
        clientContactId: contact.id,
        ownerId: null,
        stage: 'PROSPECT',
        status: 'ACTIVE',
        source: 'INBOUND',
        leadSourceId: leadSource.id,
        estimatedValue: parsed.interest.estimatedValue ?? null,
        expectedCloseDate: parsed.interest.expectedCloseAt ?? null,
        description: parsed.interest.message ?? null,
        // Rastreio inbound
        isInbound: true,
        inboundSource: input.source,
        inboundFormId: parsed.tracking?.utm_campaign ?? null,
        inboundPayload:
          typeof input.raw === 'string'
            ? { text: input.raw, tracking: parsed.tracking ?? {} }
            : (input.raw as object),
        inboundReceivedAt: input.receivedAt ?? new Date(),
        inboundParsedBy: parsed.parsedBy,
        inboundConfidence: parsed.confidence,
      },
    });

    // 8. Audit — tenantIdOverride é OBRIGATÓRIO (worker fora do fetchRequestHandler
    //    do tRPC não tem AsyncLocalStorage do tRPC pra puxar tenantId).
    await audit({
      action: 'opportunity.inbound_created',
      tableName: 'opportunities',
      recordId: opp.id,
      tenantIdOverride: input.tenantId,
      after: {
        confidence: parsed.confidence,
        parsed_by: parsed.parsedBy,
        source: input.source,
        origin: input.originIdentifier ?? null,
      },
    });

    return { kind: 'created', opportunityId: opp.id, parsed };
  });
}

async function getOrCreateLeadSourceInbound(tenantId: string) {
  const existing = await prisma.leadSource.findFirst({
    where: {
      tenantId,
      deletedAt: null,
      name: { equals: 'Inbound', mode: 'insensitive' },
    },
  });
  if (existing) return existing;
  return prisma.leadSource.create({
    data: { tenantId, name: 'Inbound', position: 0, isActive: true },
  });
}

function deriveOpportunityTitle(parsed: ParsedLead, companyName: string): string {
  const contactName = parsed.contact.name?.trim();
  const message = parsed.interest.message?.trim();
  if (message) {
    const short = message.slice(0, 60);
    return `${companyName} — ${short}${message.length > 60 ? '…' : ''}`;
  }
  if (contactName) return `${companyName} — ${contactName}`;
  return `${companyName} (inbound)`;
}

// Exports para testes puros
export const _internal = {
  isBlacklisted,
  deriveOpportunityTitle,
  MIN_CONFIDENCE,
};
