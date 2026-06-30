import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { masking } from '@/lib/ai/masking';
import { getAnthropic, MODELS } from '@/lib/ai/claude';
import { callAiFeature } from '@/lib/ai/feature-gate';
import { logAiUsage } from './ai-usage.service';
import { CircuitBreaker } from './ai-circuit-breaker';
import { ActivityType, AIProvider, IncomingEmailStatus, Prisma } from '@prisma/client';

/**
 * Vinculação de e-mail recebido a uma oportunidade.
 *
 * 3 heurísticas em ordem de confiança:
 *   1. `#<oppId>` no subject — vínculo direto, confiança 1.0
 *   2. Match exato de e-mail (from/to/cc) com contato cadastrado —
 *      se aquele contato tem 1 oportunidade ACTIVE, vincula (conf 0.85);
 *      se tem múltiplas, fica PENDING com sugestões
 *   3. Fallback IA — Claude Haiku ranqueia top oportunidades ACTIVE
 *      contra o corpo mascarado do e-mail (conf 0.5–0.7)
 *
 * Quando vincula com confiança >= 0.85, cria Activity tipo EMAIL automática.
 * Caso contrário, fica PENDING para revisão manual em `/inbox`.
 */

const breaker = new CircuitBreaker({ name: 'claude-haiku-email-link' });

const SUBJECT_ID_RE = /#([0-9a-f-]{8,36})/i;

export interface LinkSuggestion {
  opportunityId: string;
  opportunityTitle: string;
  confidence: number;
  reason: string;
}

export interface LinkResult {
  status: 'LINKED' | 'PENDING';
  opportunityId?: string;
  confidence?: number;
  method: 'subject_id' | 'contact_exact' | 'ai_rank' | 'no_match';
  suggestions: LinkSuggestion[];
}

export function extractCodigoFromSubject(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const m = SUBJECT_ID_RE.exec(subject);
  return m?.[1] ?? null;
}

async function rankWithAI(
  tenantId: string,
  body: string,
  candidates: Array<{ id: string; title: string; clientCompany: string }>,
): Promise<Array<{ id: string; score: number }>> {
  if (candidates.length === 0 || breaker.isOpen()) return [];
  const { masked, map: _map } = masking.mask(body);
  void _map;
  const list = candidates
    .map((c, i) => `${i + 1}. [${c.id}] ${c.title} — cliente: ${c.clientCompany}`)
    .join('\n');

  const prompt = `Você é assistente de CRM B2B. Receba um e-mail e ranqueie quais das oportunidades abaixo é mais provável que ele se refere.

Oportunidades ativas:
${list}

Texto do e-mail (PII mascarada):
"""
${masked.slice(0, 3000)}
"""

Responda SOMENTE com JSON: { "ranking": [{ "id": "uuid", "score": 0-1 }] } no máximo 3 itens, ordenado por score desc. Use 0 quando claramente não corresponde.`;

  const t0 = Date.now();
  let promptTokens = 0;
  let completionTokens = 0;
  let raw = '';
  let success = true;
  try {
    const completion = await callAiFeature(
      'email-routing',
      { tenantId },
      async ({ model }) =>
        getAnthropic().messages.create({
          model: model || MODELS.HAIKU,
          max_tokens: 256,
          messages: [{ role: 'user', content: prompt }],
        }),
    );
    promptTokens = completion.usage.input_tokens;
    completionTokens = completion.usage.output_tokens;
    raw = completion.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    breaker.recordSuccess();
  } catch {
    success = false;
    breaker.recordFailure();
  } finally {
    await logAiUsage({
      tenantId,
      userId: null,
      provider: AIProvider.ANTHROPIC,
      model: MODELS.HAIKU,
      promptTokens,
      completionTokens,
      requestType: 'email_link_rank',
      latencyMs: Date.now() - t0,
      success,
    });
  }

  if (!success) return [];
  try {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const json = fence?.[1] ?? raw;
    const parsed = JSON.parse(json) as { ranking?: Array<{ id?: string; score?: number }> };
    return (parsed.ranking ?? [])
      .map((r) => ({ id: String(r.id ?? ''), score: Number(r.score ?? 0) }))
      .filter((r) => r.id.length > 0 && r.score > 0);
  } catch {
    return [];
  }
}

export async function tryAutoLink(incomingEmailId: string, tenantId: string): Promise<LinkResult> {
  return runAsSystem(async () => {
    const email = await prisma.incomingEmail.findUnique({
      where: { id: incomingEmailId },
    });
    if (!email || email.status !== IncomingEmailStatus.PENDING) {
      return { status: 'PENDING', method: 'no_match', suggestions: [] };
    }

    // 1. #<id> no subject
    const codigo = extractCodigoFromSubject(email.subject);
    if (codigo) {
      const found = await prisma.opportunity.findFirst({
        where: { tenantId, id: codigo, deletedAt: null },
        select: { id: true, title: true, clientCompany: { select: { razaoSocial: true } } },
      });
      if (found) {
        await linkAndCreateActivity(email.id, tenantId, found.id, 1.0, 'subject_id');
        return {
          status: 'LINKED',
          opportunityId: found.id,
          confidence: 1.0,
          method: 'subject_id',
          suggestions: [],
        };
      }
    }

    // 2. Match por contato
    const allAddrs = [email.fromEmail, ...email.toAddresses, ...email.ccAddresses]
      .map((a) => a.toLowerCase());
    const contacts = await prisma.contact.findMany({
      where: { tenantId, email: { in: allAddrs }, deletedAt: null },
      select: { id: true },
    });
    if (contacts.length > 0) {
      const opps = await prisma.opportunity.findMany({
        where: {
          tenantId,
          deletedAt: null,
          status: 'ACTIVE',
          clientContactId: { in: contacts.map((c) => c.id) },
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          title: true,
          clientCompany: { select: { razaoSocial: true } },
        },
      });
      if (opps.length === 1) {
        await linkAndCreateActivity(email.id, tenantId, opps[0]!.id, 0.85, 'contact_exact');
        return {
          status: 'LINKED',
          opportunityId: opps[0]!.id,
          confidence: 0.85,
          method: 'contact_exact',
          suggestions: [],
        };
      }
      if (opps.length > 1) {
        const suggestions: LinkSuggestion[] = opps.map((o) => ({
          opportunityId: o.id,
          opportunityTitle: o.title,
          confidence: 0.6,
          reason: 'Contato cadastrado em múltiplas oportunidades',
        }));
        await persistSuggestions(email.id, suggestions);
        return { status: 'PENDING', method: 'contact_exact', suggestions };
      }
    }

    // 3. Fallback IA — pega top oportunidades ACTIVE e pede ranking
    const candidates = await prisma.opportunity.findMany({
      where: { tenantId, deletedAt: null, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
      take: 12,
      select: {
        id: true,
        title: true,
        clientCompany: { select: { razaoSocial: true } },
      },
    });
    const body = `${email.subject ?? ''}\n\n${email.bodyText ?? ''}`;
    const ranking = await rankWithAI(
      tenantId,
      body,
      candidates.map((c) => ({
        id: c.id,
        title: c.title,
        clientCompany: c.clientCompany?.razaoSocial ?? '—',
      })),
    );

    if (ranking.length > 0 && (ranking[0]?.score ?? 0) >= 0.8 && candidates.find((c) => c.id === ranking[0]?.id)) {
      await linkAndCreateActivity(email.id, tenantId, ranking[0]!.id, ranking[0]!.score, 'ai_rank');
      return {
        status: 'LINKED',
        opportunityId: ranking[0]!.id,
        confidence: ranking[0]!.score,
        method: 'ai_rank',
        suggestions: [],
      };
    }

    const suggestions: LinkSuggestion[] = ranking
      .slice(0, 3)
      .map((r) => {
        const cand = candidates.find((c) => c.id === r.id);
        return cand
          ? {
              opportunityId: cand.id,
              opportunityTitle: cand.title,
              confidence: r.score,
              reason: 'Ranking IA',
            }
          : null;
      })
      .filter((x): x is LinkSuggestion => x !== null);
    if (suggestions.length > 0) await persistSuggestions(email.id, suggestions);
    return {
      status: 'PENDING',
      method: ranking.length > 0 ? 'ai_rank' : 'no_match',
      suggestions,
    };
  });
}

async function linkAndCreateActivity(
  incomingEmailId: string,
  tenantId: string,
  opportunityId: string,
  confidence: number,
  method: LinkResult['method'],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const email = await tx.incomingEmail.findUnique({ where: { id: incomingEmailId } });
    if (!email) return;
    const activity = await tx.activity.create({
      data: {
        tenantId,
        opportunityId,
        type: ActivityType.EMAIL,
        title: email.subject ?? '(sem assunto)',
        content: email.bodyText ?? email.bodyHtml ?? '(corpo vazio)',
        rawText: email.bodyText ?? null,
        occurredAt: email.receivedAt,
      } as Prisma.ActivityUncheckedCreateInput,
    });
    await tx.incomingEmail.update({
      where: { id: incomingEmailId },
      data: {
        status: IncomingEmailStatus.LINKED,
        linkedActivityId: activity.id,
        linkedOpportunityId: opportunityId,
        linkConfidence: confidence,
        linkMethod: method,
        linkedAt: new Date(),
      },
    });
  });
}

async function persistSuggestions(
  incomingEmailId: string,
  suggestions: LinkSuggestion[],
): Promise<void> {
  const current = await prisma.incomingEmail.findUnique({
    where: { id: incomingEmailId },
  });
  const merged = {
    ...((current?.rawPayload as Record<string, unknown>) ?? {}),
    _suggestions: suggestions,
  };
  await prisma.incomingEmail.update({
    where: { id: incomingEmailId },
    data: {
      rawPayload: merged as unknown as Prisma.InputJsonValue,
    },
  });
}
