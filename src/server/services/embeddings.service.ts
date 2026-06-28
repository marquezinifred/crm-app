import OpenAI from 'openai';
import { env } from '@/lib/env';
import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { createHash } from 'node:crypto';

/**
 * Embedding via OpenAI text-embedding-3-small (1536d) — opcional.
 *   - Se OPENAI_API_KEY ausente: `isEnabled()` retorna false e o sistema
 *     cai para Postgres tsvector(portuguese) full-text search.
 *   - Cache por contentHash (SHA-256 do texto) evita reembedding do mesmo
 *     conteúdo.
 *
 * Custos: text-embedding-3-small ≈ $0.02 / 1M tokens. Volume típico
 * (atividade ~200 tokens) → praticamente gratuito.
 */

let _openai: OpenAI | null = null;
function client(): OpenAI | null {
  if (_openai) return _openai;
  if (!env.OPENAI_API_KEY) return null;
  _openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return _openai;
}

export function isEnabled(): boolean {
  return !!env.OPENAI_API_KEY;
}

export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  const c = client();
  if (!c) return null;
  const trimmed = text.slice(0, 8000); // hard cap (8k chars ~ 2k tokens)
  try {
    const resp = await c.embeddings.create({
      model: env.OPENAI_EMBEDDING_MODEL,
      input: trimmed,
    });
    return resp.data[0]?.embedding ?? null;
  } catch (err) {
    console.error('[embeddings] generate falhou:', err);
    return null;
  }
}

export interface IndexInput {
  tenantId: string;
  sourceType: 'activity' | 'incoming_email';
  sourceId: string;
  text: string;
}

/** Idempotente: se o hash já existir para esta source, pula. */
export async function indexContent(input: IndexInput): Promise<void> {
  if (!isEnabled()) return;
  await runAsSystem(async () => {
    const hash = contentHash(input.text);
    const existing = await prisma.embedding.findFirst({
      where: {
        tenantId: input.tenantId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        contentHash: hash,
      },
      select: { id: true },
    });
    if (existing) return;

    const vector = await generateEmbedding(input.text);
    if (!vector) return;

    // pgvector escrita raw — Prisma não tem suporte direto para o tipo
    await prisma.$executeRaw`
      INSERT INTO embeddings (
        id, tenant_id, source_type, source_id, content_hash, model, dims, vector, metadata, created_at
      ) VALUES (
        gen_random_uuid(),
        ${input.tenantId}::uuid,
        ${input.sourceType},
        ${input.sourceId}::uuid,
        ${hash},
        ${env.OPENAI_EMBEDDING_MODEL},
        ${vector.length},
        ${`[${vector.join(',')}]`}::vector,
        NULL,
        now()
      )
    `;
  });
}

export interface VectorHit {
  sourceType: string;
  sourceId: string;
  similarity: number;
}

/**
 * Busca top-N por cosine distance no pgvector.
 * Retorna [] se OPENAI desabilitado ou nenhum embedding encontrado.
 */
export async function searchByVector(
  tenantId: string,
  query: string,
  topN: number,
): Promise<VectorHit[]> {
  if (!isEnabled()) return [];
  const qvec = await generateEmbedding(query);
  if (!qvec) return [];

  const rows = await prisma.$queryRaw<
    Array<{ source_type: string; source_id: string; similarity: number }>
  >`
    SELECT source_type, source_id::text, 1 - (vector <=> ${`[${qvec.join(',')}]`}::vector) AS similarity
    FROM embeddings
    WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
    ORDER BY vector <=> ${`[${qvec.join(',')}]`}::vector
    LIMIT ${topN}
  `;
  return rows.map((r) => ({
    sourceType: r.source_type,
    sourceId: r.source_id,
    similarity: Number(r.similarity),
  }));
}
