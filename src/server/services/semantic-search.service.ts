import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { isEnabled, searchByVector } from './embeddings.service';
import { masking } from '@/lib/ai/masking';
import { MODELS } from '@/lib/ai/claude';
import { dispatchChat } from '@/lib/ai/dispatch';
import { logAiUsage } from './ai-usage.service';
import { CircuitBreaker } from './ai-circuit-breaker';
import { AIProvider } from '@prisma/client';

/**
 * Busca em linguagem natural sobre activities + incoming_emails.
 *
 * Pipeline:
 *   1. Recupera top-N candidatos via pgvector (se OPENAI ativo) OU
 *      via Postgres tsvector(portuguese) (fallback) — em ambos os casos
 *      filtra por tenant
 *   2. Hidrata os candidatos com conteúdo de activity/incoming_email
 *   3. Rerank com Claude Haiku (top-K final, com explicação)
 *
 * Reduz tokens enviados à IA: só rerank, não toda a base. Spec §9.2.
 */

const breaker = new CircuitBreaker({ name: 'claude-haiku-search-rerank' });

export interface SearchHit {
  sourceType: 'activity' | 'incoming_email';
  sourceId: string;
  opportunityId: string | null;
  title: string;
  snippet: string;
  occurredAt: Date;
  baseScore: number;
  rerankScore?: number;
}

export interface SearchOptions {
  topN?: number;
  topK?: number;
  rerank?: boolean;
}

export interface SearchResult {
  hits: SearchHit[];
  mode: 'vector' | 'tsvector';
  reranked: boolean;
}

export async function naturalQuery(
  tenantId: string,
  userId: string,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResult> {
  const topN = opts.topN ?? 20;
  const topK = opts.topK ?? 10;
  const rerank = opts.rerank ?? true;

  return runAsSystem(async () => {
    // 1. Candidate retrieval
    let baseHits: Array<{ sourceType: 'activity' | 'incoming_email'; sourceId: string; baseScore: number }> = [];
    let mode: 'vector' | 'tsvector' = 'tsvector';

    if (isEnabled()) {
      const vec = await searchByVector(tenantId, query, topN);
      if (vec.length > 0) {
        mode = 'vector';
        baseHits = vec.map((v) => ({
          sourceType: v.sourceType as 'activity' | 'incoming_email',
          sourceId: v.sourceId,
          baseScore: v.similarity,
        }));
      }
    }

    if (baseHits.length === 0) {
      // Fallback tsvector PT-BR
      const rows = await prisma.$queryRaw<
        Array<{ source_type: string; source_id: string; rank: number }>
      >`
        SELECT 'activity' AS source_type, id::text AS source_id,
               ts_rank(to_tsvector('portuguese', coalesce(title,'') || ' ' || content),
                       plainto_tsquery('portuguese', ${query})) AS rank
        FROM activities
        WHERE tenant_id = ${tenantId}::uuid
          AND deleted_at IS NULL
          AND to_tsvector('portuguese', coalesce(title,'') || ' ' || content)
              @@ plainto_tsquery('portuguese', ${query})
        UNION ALL
        SELECT 'incoming_email' AS source_type, id::text AS source_id,
               ts_rank(to_tsvector('portuguese', coalesce(subject,'') || ' ' || coalesce(body_text,'')),
                       plainto_tsquery('portuguese', ${query})) AS rank
        FROM incoming_emails
        WHERE tenant_id = ${tenantId}::uuid
          AND deleted_at IS NULL
          AND to_tsvector('portuguese', coalesce(subject,'') || ' ' || coalesce(body_text,''))
              @@ plainto_tsquery('portuguese', ${query})
        ORDER BY rank DESC
        LIMIT ${topN}
      `;
      mode = 'tsvector';
      baseHits = rows.map((r) => ({
        sourceType: r.source_type as 'activity' | 'incoming_email',
        sourceId: r.source_id,
        baseScore: Number(r.rank),
      }));
    }

    if (baseHits.length === 0) {
      return { hits: [], mode, reranked: false };
    }

    // 2. Hydrate
    const actIds = baseHits.filter((h) => h.sourceType === 'activity').map((h) => h.sourceId);
    const emailIds = baseHits
      .filter((h) => h.sourceType === 'incoming_email')
      .map((h) => h.sourceId);

    const [activities, emails] = await Promise.all([
      actIds.length
        ? prisma.activity.findMany({
            where: { id: { in: actIds } },
            select: {
              id: true,
              title: true,
              content: true,
              occurredAt: true,
              opportunityId: true,
            },
          })
        : Promise.resolve([]),
      emailIds.length
        ? prisma.incomingEmail.findMany({
            where: { id: { in: emailIds } },
            select: {
              id: true,
              subject: true,
              bodyText: true,
              receivedAt: true,
              linkedOpportunityId: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const aMap = new Map(activities.map((a) => [a.id, a]));
    const eMap = new Map(emails.map((e) => [e.id, e]));

    const hits: SearchHit[] = baseHits.flatMap((h): SearchHit[] => {
      if (h.sourceType === 'activity') {
        const a = aMap.get(h.sourceId);
        if (!a) return [];
        return [
          {
            sourceType: 'activity',
            sourceId: a.id,
            opportunityId: a.opportunityId,
            title: a.title ?? '(sem título)',
            snippet: a.content.slice(0, 240),
            occurredAt: a.occurredAt,
            baseScore: h.baseScore,
          },
        ];
      }
      const e = eMap.get(h.sourceId);
      if (!e) return [];
      return [
        {
          sourceType: 'incoming_email',
          sourceId: e.id,
          opportunityId: e.linkedOpportunityId,
          title: e.subject ?? '(sem assunto)',
          snippet: (e.bodyText ?? '').slice(0, 240),
          occurredAt: e.receivedAt,
          baseScore: h.baseScore,
        },
      ];
    });

    // 3. Rerank
    if (!rerank || breaker.isOpen() || hits.length === 0) {
      return { hits: hits.slice(0, topK), mode, reranked: false };
    }

    const numbered = hits
      .map(
        (h, i) =>
          `${i + 1}. [${h.sourceType}] ${h.title}\n   ${masking.mask(h.snippet).masked}`,
      )
      .join('\n\n');

    const prompt = `Você reranqueia resultados de busca em CRM B2B em PT-BR.

Consulta do usuário: "${query}"

Resultados candidatos:
${numbered}

Devolva SOMENTE JSON: { "order": [1,3,2,...] } — índices dos resultados em ordem decrescente de relevância para a consulta. Inclua no máximo ${topK} índices.`;

    const t0 = Date.now();
    let promptTokens = 0;
    let completionTokens = 0;
    let raw = '';
    let success = true;
    let usedProvider: AIProvider = AIProvider.ANTHROPIC;
    let configuredProvider: AIProvider = AIProvider.ANTHROPIC;
    let usedFallback = false;
    let effectiveModel = MODELS.HAIKU;
    try {
      // Sprint 15F — `prompt` foi construído com hits já mascarados
      // (masking.mask aplicado em conteúdo de activity/incoming_email).
      const out = await dispatchChat({
        featureCode: 'semantic-search',
        tenantId,
        chat: {
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 200,
        },
      });
      promptTokens = out.inputTokens;
      completionTokens = out.outputTokens;
      raw = out.text;
      usedProvider = out.usedProvider;
      configuredProvider = out.configuredProvider;
      usedFallback = out.usedFallback;
      effectiveModel = out.model || MODELS.HAIKU;
      breaker.recordSuccess();
    } catch {
      success = false;
      breaker.recordFailure();
    } finally {
      await logAiUsage({
        tenantId,
        userId,
        provider: usedProvider,
        model: effectiveModel,
        promptTokens,
        completionTokens,
        requestType: 'search_rerank',
        latencyMs: Date.now() - t0,
        success,
        usedFallback,
        configuredProvider,
      });
    }

    if (!success) return { hits: hits.slice(0, topK), mode, reranked: false };

    try {
      const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      const json = fence?.[1] ?? raw;
      const parsed = JSON.parse(json) as { order?: number[] };
      const order = Array.isArray(parsed.order) ? parsed.order : [];
      const reranked = order
        .map((idx) => hits[idx - 1])
        .filter((x): x is SearchHit => x !== undefined)
        .slice(0, topK)
        .map((h, i) => ({ ...h, rerankScore: 1 - i / topK }));
      if (reranked.length === 0) return { hits: hits.slice(0, topK), mode, reranked: false };
      return { hits: reranked, mode, reranked: true };
    } catch {
      return { hits: hits.slice(0, topK), mode, reranked: false };
    }
  });
}
