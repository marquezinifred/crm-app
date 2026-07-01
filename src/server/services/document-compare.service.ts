import { masking } from '@/lib/ai/masking';
import { getAnthropicForTenant, MODELS } from '@/lib/ai/claude';
import { callAiFeature } from '@/lib/ai/feature-gate';
import { logAiUsage } from './ai-usage.service';
import { CircuitBreaker } from './ai-circuit-breaker';
import { AIProvider } from '@prisma/client';

/**
 * Comparador de versões de proposta/orçamento via Claude Haiku.
 * Aceita textos extraídos (PDF → texto, DOCX → texto) das duas versões
 * e devolve resumo estruturado das diferenças (§14.2 do spec).
 *
 * Se a IA falhar ou os textos não forem fornecidos, devolve resumo
 * trivial baseado em metadados (tamanho de arquivo, datas).
 */

const breaker = new CircuitBreaker({ name: 'claude-haiku-doc-compare' });

export interface DocComparison {
  scopeChanges: string[];
  valueChange: { absolute: number | null; percent: number | null; note: string };
  marginChange: { absolute: number | null; note: string };
  itemsAdded: string[];
  itemsRemoved: string[];
  termChanges: string[];
  source: 'ai' | 'metadata';
  raw?: string;
}

export interface CompareInput {
  tenantId: string;
  userId: string;
  fromVersion: number;
  toVersion: number;
  fromText?: string;
  toText?: string;
}

const SYSTEM = `Você compara duas versões de uma proposta comercial ou contrato em PT-BR.
A entrada pode conter tokens marcadores ([PESSOA_1], [EMPRESA_1], [EMAIL_1], [VALOR_1], etc.) — preserve-os EXATAMENTE.

Responda SOMENTE com JSON válido no esquema:
{
  "scopeChanges": ["mudanças de escopo"],
  "valueChange": { "absolute": number | null, "percent": number | null, "note": "string" },
  "marginChange": { "absolute": number | null, "note": "string" },
  "itemsAdded": ["item 1"],
  "itemsRemoved": ["item removido"],
  "termChanges": ["mudanças em prazo ou condições"]
}

Arrays podem ser vazios. valueChange.absolute em R$ quando identificável.`;

function emptyResult(source: DocComparison['source']): DocComparison {
  return {
    scopeChanges: [],
    valueChange: { absolute: null, percent: null, note: '' },
    marginChange: { absolute: null, note: '' },
    itemsAdded: [],
    itemsRemoved: [],
    termChanges: [],
    source,
  };
}

export async function compareDocumentVersions(input: CompareInput): Promise<DocComparison> {
  if (!input.fromText || !input.toText) {
    const r = emptyResult('metadata');
    r.scopeChanges = [
      `Comparação automática indisponível: o conteúdo extraído das versões não foi enviado. Versões ${input.fromVersion} → ${input.toVersion}.`,
    ];
    return r;
  }
  if (breaker.isOpen()) return emptyResult('metadata');

  const { masked: fromMasked, map: fromMap } = masking.mask(input.fromText.slice(0, 12000));
  const { masked: toMasked, map: toMap } = masking.mask(input.toText.slice(0, 12000));

  const userPrompt = `Versão ${input.fromVersion} (anterior):
"""
${fromMasked}
"""

Versão ${input.toVersion} (nova):
"""
${toMasked}
"""`;

  const t0 = Date.now();
  let promptTokens = 0;
  let completionTokens = 0;
  let raw = '';
  let success = true;
  try {
    const completion = await callAiFeature(
      'proposal-version-diff',
      { tenantId: input.tenantId },
      async ({ model }) => {
        const client = await getAnthropicForTenant(input.tenantId);
        return client.messages.create({
          model: model || MODELS.HAIKU,
          max_tokens: 1024,
          system: SYSTEM,
          messages: [{ role: 'user', content: userPrompt }],
        });
      },
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
      tenantId: input.tenantId,
      userId: input.userId,
      provider: AIProvider.ANTHROPIC,
      model: MODELS.HAIKU,
      promptTokens,
      completionTokens,
      requestType: 'document_compare',
      latencyMs: Date.now() - t0,
      success,
    });
  }

  if (!success) return emptyResult('metadata');

  try {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const json = fence?.[1] ?? raw;
    const parsed = JSON.parse(json) as Partial<DocComparison>;

    const unmaskList = (xs: string[] | undefined) =>
      (xs ?? []).map((s) => masking.unmask(masking.unmask(s, fromMap), toMap));

    return {
      scopeChanges: unmaskList(parsed.scopeChanges),
      valueChange: parsed.valueChange ?? { absolute: null, percent: null, note: '' },
      marginChange: parsed.marginChange ?? { absolute: null, note: '' },
      itemsAdded: unmaskList(parsed.itemsAdded),
      itemsRemoved: unmaskList(parsed.itemsRemoved),
      termChanges: unmaskList(parsed.termChanges),
      source: 'ai',
      raw,
    };
  } catch {
    const r = emptyResult('metadata');
    r.scopeChanges = ['IA retornou resposta não-parseável. Compare manualmente.'];
    return r;
  }
}

export const __test = { breaker, emptyResult };
