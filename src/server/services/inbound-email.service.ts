import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { Prisma } from '@prisma/client';

/**
 * Persistência de e-mails recebidos via webhook inbound.
 *
 * O endereço-destino do CRM tem formato `crm-<slug>@inbound.<domínio>`.
 * Aqui extraímos o slug, resolvemos o tenant e gravamos o registro em
 * `incoming_emails` com status PENDING.
 *
 * A tentativa de vinculação (#ID > contato > IA) acontece em seguida via
 * `tryAutoLink`.
 */

const ADDR_REGEX = /(?:^|<)\s*crm-([a-z0-9-]+)@/i;

export function extractSlugFromAddresses(addresses: string[]): string | null {
  for (const addr of addresses) {
    const m = ADDR_REGEX.exec(addr);
    if (m?.[1]) return m[1].toLowerCase();
  }
  return null;
}

export interface InboundPayload {
  /** Endereço de quem enviou */
  from: string;
  /** Endereços no campo To */
  to: string[];
  /** Endereços no campo Cc */
  cc?: string[];
  subject?: string | null;
  textBody?: string | null;
  htmlBody?: string | null;
  receivedAt?: Date;
  /** Payload bruto preservado para auditoria/retry */
  rawPayload: unknown;
}

export interface IngestResult {
  ok: boolean;
  reason?: string;
  incomingEmailId?: string;
  tenantId?: string;
}

export async function ingestInboundEmail(payload: InboundPayload): Promise<IngestResult> {
  const allAddrs = [...payload.to, ...(payload.cc ?? [])];
  const slug = extractSlugFromAddresses(allAddrs);
  if (!slug) {
    return { ok: false, reason: 'Nenhum endereço crm-<slug>@inbound.* encontrado' };
  }

  return runAsSystem(async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { inboundEmailSlug: slug },
      select: { id: true },
    });
    if (!tenant) {
      return { ok: false, reason: `Slug "${slug}" não pertence a nenhum tenant` };
    }

    const created = await prisma.incomingEmail.create({
      data: {
        tenantId: tenant.id,
        fromEmail: payload.from,
        toAddresses: payload.to,
        ccAddresses: payload.cc ?? [],
        subject: payload.subject ?? null,
        bodyText: payload.textBody ?? null,
        bodyHtml: payload.htmlBody ?? null,
        receivedAt: payload.receivedAt ?? new Date(),
        rawPayload: payload.rawPayload as Prisma.InputJsonValue,
      } as Prisma.IncomingEmailUncheckedCreateInput,
    });

    return { ok: true, incomingEmailId: created.id, tenantId: tenant.id };
  });
}

/**
 * Normaliza payload do Postmark Inbound.
 * Referência: https://postmarkapp.com/developer/user-guide/inbound/parse-an-email
 */
export function fromPostmark(payload: Record<string, unknown>): InboundPayload {
  return {
    from: String(payload.FromFull && (payload.FromFull as { Email?: string }).Email
      ? (payload.FromFull as { Email: string }).Email
      : payload.From ?? ''),
    to: ((payload.ToFull as Array<{ Email: string }>) ?? [])
      .map((x) => x.Email)
      .filter(Boolean),
    cc: ((payload.CcFull as Array<{ Email: string }>) ?? [])
      .map((x) => x.Email)
      .filter(Boolean),
    subject: (payload.Subject as string) ?? null,
    textBody: (payload.TextBody as string) ?? null,
    htmlBody: (payload.HtmlBody as string) ?? null,
    receivedAt: payload.Date ? new Date(payload.Date as string) : new Date(),
    rawPayload: payload,
  };
}

/**
 * Normaliza payload do Resend Inbound. (Schema simplificado/projetado.)
 */
export function fromResend(payload: Record<string, unknown>): InboundPayload {
  return {
    from: String((payload.from as { email?: string })?.email ?? payload.from ?? ''),
    to: Array.isArray(payload.to)
      ? (payload.to as Array<string | { email: string }>).map((x) =>
          typeof x === 'string' ? x : x.email,
        )
      : [],
    cc: Array.isArray(payload.cc)
      ? (payload.cc as Array<string | { email: string }>).map((x) =>
          typeof x === 'string' ? x : x.email,
        )
      : [],
    subject: (payload.subject as string) ?? null,
    textBody: (payload.text as string) ?? null,
    htmlBody: (payload.html as string) ?? null,
    receivedAt: payload.created_at ? new Date(payload.created_at as string) : new Date(),
    rawPayload: payload,
  };
}
