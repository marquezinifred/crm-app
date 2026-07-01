import { dispatchChat } from '@/lib/ai/dispatch';
import { masking } from '@/lib/ai/masking';
import { MODELS } from '@/lib/ai/claude';
import {
  AiLimitExceededError,
  FeatureNotAvailableError,
} from '@/lib/ai/feature-gate';
import { logAiUsage } from './ai-usage.service';
import { AIProvider } from '@prisma/client';

/**
 * Sprint 15D — Parser híbrido de leads inbound.
 *
 * Estratégia (Opção D da spec §5): regex-first + IA fallback.
 *   1. Tenta 5 matchers determinísticos em ordem de especificidade
 *      (Typeform → RD Station → HTML table → plain key:value → webhook JSON).
 *   2. Se nenhum bate com confidence ≥ 0.7, chama Claude Haiku via
 *      dispatchChat (feature 'inbound-lead-parser').
 *   3. Aplica DataMaskingService antes de mandar pro modelo (regra
 *      crítica: PII nunca vai pro provider em texto claro).
 *
 * Retorna ParsedLead com `confidence` (0..1) + `parsed_by` pra rastreio.
 * Callers decidem o que fazer com confidence < 0.4 (rejected table).
 */

export type ParseSource = 'email' | 'webhook_custom';

export interface ParsedLeadContact {
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
}

export interface ParsedLeadCompany {
  name?: string;
  cnpj?: string;
  website?: string;
  segment?: string;
}

export interface ParsedLeadInterest {
  message?: string;
  estimatedValue?: number;
  expectedCloseAt?: Date;
}

export interface ParsedLead {
  contact: ParsedLeadContact;
  company: ParsedLeadCompany;
  interest: ParsedLeadInterest;
  tracking?: Record<string, string>;
  /** 0..1 — 1.0 quando JSON webhook estruturado, 0.4-0.7 quando IA */
  confidence: number;
  /** 'regex:typeform-v1' | 'ai:claude-haiku' | 'manual' */
  parsedBy: string;
}

const CNPJ_DIGITS_RE = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/;
const EMAIL_RE = /[\w.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// Utilitário compartilhado — pega o primeiro match de regex, ou undefined.
function firstMatch(input: string, re: RegExp): string | undefined {
  const m = input.match(re);
  return m ? m[0] : undefined;
}

function normalizeCnpj(raw: string): string {
  return raw.replace(/\D/g, '');
}

function normalizePhone(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function parseCurrencyBrl(raw: string): number | undefined {
  // Aceita "R$ 12.000", "12000", "12000.50", "12.000,50", "R$ 1.234.567"
  const clean = raw.replace(/R\$|\s/g, '').trim();
  if (!clean) return undefined;
  if (!/[\d]/.test(clean)) return undefined;

  const hasComma = clean.includes(',');
  const hasDot = clean.includes('.');
  const commaDec = /,\d{1,2}$/.test(clean);

  let normalized: string;
  if (commaDec) {
    // "12.000,50" → ponto é thousand sep, vírgula é decimal
    normalized = clean.replace(/\./g, '').replace(',', '.');
  } else if (hasComma && !hasDot) {
    // "12000,5" (BR sem thousands) — trata vírgula como decimal
    normalized = clean.replace(',', '.');
  } else if (hasDot) {
    // Ambíguo: "12.000" vs "12.50". Heurística: se dígitos após o único
    // ponto == 3 e não tem vírgula, é thousand sep BR. Senão é decimal.
    const parts = clean.split('.');
    const looksLikeThousands = parts.length > 1 && parts.slice(1).every((p) => p.length === 3);
    normalized = looksLikeThousands ? parts.join('') : clean;
  } else {
    normalized = clean;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

function parseIsoDate(raw: string): Date | undefined {
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

// ═════════════════════════════════════════════════════════════════
// Matchers regex
// ═════════════════════════════════════════════════════════════════

interface RegexMatcher {
  id: string;
  tryParse: (raw: string | Record<string, unknown>, source: ParseSource) => ParsedLead | null;
}

// 1. Webhook JSON estruturado — confidence máxima
const webhookJsonMatcher: RegexMatcher = {
  id: 'webhook-custom-json',
  tryParse(raw, source): ParsedLead | null {
    if (source !== 'webhook_custom' || typeof raw !== 'object' || raw === null) {
      return null;
    }
    const obj = raw as Record<string, unknown>;
    const contact = (obj.contact ?? {}) as Record<string, unknown>;
    const company = (obj.company ?? {}) as Record<string, unknown>;
    const interest = (obj.interest ?? {}) as Record<string, unknown>;
    const tracking = (obj.tracking ?? {}) as Record<string, string>;

    // Se veio JSON mas SEM email nem CNPJ, não confia
    const email = typeof contact.email === 'string' ? contact.email : undefined;
    const cnpj = typeof company.cnpj === 'string' ? normalizeCnpj(company.cnpj) : undefined;
    if (!email && !cnpj) return null;

    return {
      contact: {
        name: typeof contact.name === 'string' ? contact.name : undefined,
        email,
        phone: typeof contact.phone === 'string' ? normalizePhone(contact.phone) : undefined,
        role: typeof contact.role === 'string' ? contact.role : undefined,
      },
      company: {
        name: typeof company.name === 'string' ? company.name : undefined,
        cnpj,
        website: typeof company.website === 'string' ? company.website : undefined,
        segment: typeof company.segment === 'string' ? company.segment : undefined,
      },
      interest: {
        message: typeof interest.message === 'string' ? interest.message : undefined,
        estimatedValue:
          typeof interest.estimated_value === 'number'
            ? interest.estimated_value
            : typeof interest.estimatedValue === 'number'
              ? interest.estimatedValue
              : undefined,
        expectedCloseAt:
          typeof interest.expected_close_at === 'string'
            ? parseIsoDate(interest.expected_close_at)
            : typeof interest.expectedCloseAt === 'string'
              ? parseIsoDate(interest.expectedCloseAt)
              : undefined,
      },
      tracking: Object.keys(tracking).length > 0 ? tracking : undefined,
      confidence: 0.99,
      parsedBy: 'regex:webhook-custom-json',
    };
  },
};

// 2. Typeform email submission — detecta o header "Powered by Typeform"
//    ou "Typeform" no rodapé.
const typeformMatcher: RegexMatcher = {
  id: 'typeform-v1',
  tryParse(raw): ParsedLead | null {
    if (typeof raw !== 'string') return null;
    if (!/typeform/i.test(raw)) return null;

    // Typeform manda no formato "Pergunta: Resposta" separado por \n\n
    const pairs = extractKeyValuePairs(raw);
    if (Object.keys(pairs).length < 2) return null;

    const lead = buildFromKeyValueDict(pairs);
    if (!lead.contact.email && !lead.company.cnpj) return null;
    return { ...lead, confidence: 0.95, parsedBy: 'regex:typeform-v1' };
  },
};

// 3. RD Station — reconhece assunto/rodapé característicos.
const rdStationMatcher: RegexMatcher = {
  id: 'rd-station-v1',
  tryParse(raw): ParsedLead | null {
    if (typeof raw !== 'string') return null;
    if (!/rd\s?station|rdstation|resultados digitais/i.test(raw)) return null;
    const pairs = extractKeyValuePairs(raw);
    if (Object.keys(pairs).length < 2) return null;
    const lead = buildFromKeyValueDict(pairs);
    if (!lead.contact.email && !lead.company.cnpj) return null;
    return { ...lead, confidence: 0.9, parsedBy: 'regex:rd-station-v1' };
  },
};

// 4. HTML table submission (Contact Form 7, Cal.com, etc)
const htmlTableMatcher: RegexMatcher = {
  id: 'html-table-form',
  tryParse(raw): ParsedLead | null {
    if (typeof raw !== 'string') return null;
    if (!/<t(able|r|d)\b/i.test(raw)) return null;

    // Extrai pares de <td>Label</td><td>Value</td>
    const rowRe = /<tr[^>]*>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<\/tr>/gi;
    const pairs: Record<string, string> = {};
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(raw)) !== null) {
      const rawKey = m[1] ?? '';
      const rawVal = m[2] ?? '';
      const key = stripHtml(rawKey).trim();
      const val = stripHtml(rawVal).trim();
      if (key && val) pairs[normalizeKey(key)] = val;
    }
    if (Object.keys(pairs).length < 2) return null;
    const lead = buildFromKeyValueDict(pairs);
    if (!lead.contact.email && !lead.company.cnpj) return null;
    return { ...lead, confidence: 0.9, parsedBy: 'regex:html-table-form' };
  },
};

// 5. Plain "Campo: Valor" — genérico, menor confidence
const plainKeyValueMatcher: RegexMatcher = {
  id: 'plain-key-value',
  tryParse(raw): ParsedLead | null {
    if (typeof raw !== 'string') return null;
    const pairs = extractKeyValuePairs(raw);
    // Precisa de pelo menos 3 pares pra ter alguma estrutura reconhecível.
    if (Object.keys(pairs).length < 3) return null;
    const lead = buildFromKeyValueDict(pairs);
    if (!lead.contact.email && !lead.company.cnpj) return null;
    return { ...lead, confidence: 0.85, parsedBy: 'regex:plain-key-value' };
  },
};

const MATCHERS: RegexMatcher[] = [
  webhookJsonMatcher,
  typeformMatcher,
  rdStationMatcher,
  htmlTableMatcher,
  plainKeyValueMatcher,
];

// ═════════════════════════════════════════════════════════════════
// Utils
// ═════════════════════════════════════════════════════════════════

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    // Colapsa espaços/tabs mas preserva newlines pra split funcionar
    .replace(/[ \t]+/g, ' ');
}

function normalizeKey(k: string): string {
  return k
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Extrai pares "Chave: Valor" de texto plain. Suporta linha por linha ou
 * texto em bloco. Ignora linhas < 4 chars (não-informativas).
 */
export function extractKeyValuePairs(raw: string): Record<string, string> {
  const cleaned = stripHtml(raw);
  const pairs: Record<string, string> = {};
  const lines = cleaned.split(/\n+/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 4) continue;
    // Aceita "Nome: Fulano" mas NÃO "http://example.com" (URL não é pair)
    const m = trimmed.match(/^([\p{L}\p{N} _]+?)\s*[:\-–]\s+(.{1,600})$/u);
    if (!m || !m[1] || !m[2]) continue;
    const key = normalizeKey(m[1]);
    const value = m[2].trim();
    if (!key || !value) continue;
    // Se já existe, mantém o primeiro (typeform manda em ordem lógica).
    if (!(key in pairs)) pairs[key] = value;
  }
  return pairs;
}

const KEY_ALIASES: Record<string, keyof ParsedLeadContact | keyof ParsedLeadCompany | keyof ParsedLeadInterest | 'ignore'> = {
  // Contact
  nome: 'name', name: 'name', full_name: 'name', nome_completo: 'name',
  email: 'email', e_mail: 'email', mail: 'email', endereco_de_email: 'email',
  telefone: 'phone', celular: 'phone', phone: 'phone', whatsapp: 'phone', tel: 'phone',
  cargo: 'role', role: 'role', funcao: 'role', posicao: 'role', job_title: 'role',
  // Company
  empresa: 'name', company: 'name', organizacao: 'name', nome_empresa: 'name',
  cnpj: 'cnpj', cnpj_empresa: 'cnpj',
  website: 'website', site: 'website', url: 'website',
  segmento: 'segment', setor: 'segment', industry: 'segment',
  // Interest
  mensagem: 'message', message: 'message', comentario: 'message', comments: 'message',
  descricao: 'message', duvida: 'message', interesse: 'message',
  valor_estimado: 'estimatedValue', valor: 'estimatedValue', orcamento: 'estimatedValue',
  budget: 'estimatedValue', ticket: 'estimatedValue',
  fechamento: 'expectedCloseAt', data_fechamento: 'expectedCloseAt',
  expected_close: 'expectedCloseAt', close_date: 'expectedCloseAt',
};

const CONTACT_FIELDS: ReadonlySet<string> = new Set(['name', 'email', 'phone', 'role']);
const COMPANY_FIELDS: ReadonlySet<string> = new Set(['name', 'cnpj', 'website', 'segment']);
const INTEREST_FIELDS: ReadonlySet<string> = new Set(['message', 'estimatedValue', 'expectedCloseAt']);

/**
 * Interpreta um dicionário "Chave normalizada → valor" em ParsedLead.
 * Confidence + parsedBy são preenchidos pelo caller.
 */
export function buildFromKeyValueDict(
  dict: Record<string, string>,
): Omit<ParsedLead, 'confidence' | 'parsedBy'> {
  const contact: ParsedLeadContact = {};
  const company: ParsedLeadCompany = {};
  const interest: ParsedLeadInterest = {};
  const tracking: Record<string, string> = {};

  for (const [rawKey, rawVal] of Object.entries(dict)) {
    const alias = KEY_ALIASES[rawKey];
    const val = rawVal.trim();
    if (!val) continue;

    if (rawKey.startsWith('utm_') || rawKey === 'utm_source' || rawKey === 'utm_medium' || rawKey === 'utm_campaign') {
      tracking[rawKey] = val;
      continue;
    }

    if (!alias || alias === 'ignore') continue;

    // Empresa/nome pode colidir — heurística: se dict tem "empresa" E "nome",
    // então "nome" vai pra pessoa, "empresa" vai pra empresa. Se só um deles,
    // ambos os aliases 'name' apontam pra target correto pelo contexto do rawKey.
    const targetIsCompany =
      rawKey === 'empresa' || rawKey === 'company' || rawKey === 'organizacao' || rawKey === 'nome_empresa';
    const targetIsContact = rawKey === 'nome' || rawKey === 'name' || rawKey === 'full_name' || rawKey === 'nome_completo';

    if (alias === 'name') {
      if (targetIsCompany) company.name = val;
      else if (targetIsContact) contact.name = val;
      // Se ambíguo, prefere manter o que já não tem valor
      else if (!contact.name) contact.name = val;
      else if (!company.name) company.name = val;
      continue;
    }

    if (alias === 'estimatedValue') {
      interest.estimatedValue = parseCurrencyBrl(val);
      continue;
    }
    if (alias === 'expectedCloseAt') {
      interest.expectedCloseAt = parseIsoDate(val);
      continue;
    }

    if (CONTACT_FIELDS.has(alias)) {
      // TS não infere alias como keyof ParsedLeadContact — cast controlado.
      (contact as Record<string, string>)[alias] = val;
    } else if (COMPANY_FIELDS.has(alias)) {
      if (alias === 'cnpj') company.cnpj = normalizeCnpj(val);
      else (company as Record<string, string>)[alias] = val;
    } else if (INTEREST_FIELDS.has(alias)) {
      (interest as Record<string, string>)[alias] = val;
    }
  }

  // Fallback: se não achou email/cnpj pelos aliases, procura no corpo bruto.
  const allText = Object.values(dict).join('\n');
  if (!contact.email) {
    const found = firstMatch(allText, EMAIL_RE);
    if (found) contact.email = found;
  }
  if (!company.cnpj) {
    const found = firstMatch(allText, CNPJ_DIGITS_RE);
    if (found) company.cnpj = normalizeCnpj(found);
  }

  return {
    contact,
    company,
    interest,
    tracking: Object.keys(tracking).length > 0 ? tracking : undefined,
  };
}

// ═════════════════════════════════════════════════════════════════
// IA fallback — Claude Haiku via dispatchChat
// ═════════════════════════════════════════════════════════════════

const AI_SYSTEM_PROMPT = `Você é um extrator de leads B2B em português brasileiro.
Recebe um texto de email ou submissão de formulário e devolve JSON estruturado.

A entrada PODE conter tokens marcadores como [PESSOA_1], [EMPRESA_1], [EMAIL_1], [VALOR_1], [PHONE_1], [CNPJ_1]. PRESERVE esses tokens EXATAMENTE — serão substituídos depois.

Responda SOMENTE com JSON válido, sem markdown, sem prefácio. Schema:
{
  "contact": { "name": string|null, "email": string|null, "phone": string|null, "role": string|null },
  "company": { "name": string|null, "cnpj": string|null, "website": string|null, "segment": string|null },
  "interest": { "message": string|null, "estimated_value": number|null, "expected_close_at": "YYYY-MM-DD"|null }
}

Se algum campo não estiver no texto, use null. Não invente. estimated_value em BRL (sem R$). expected_close_at só se data explícita.`;

interface AiParsedRaw {
  contact?: { name?: string | null; email?: string | null; phone?: string | null; role?: string | null };
  company?: { name?: string | null; cnpj?: string | null; website?: string | null; segment?: string | null };
  interest?: { message?: string | null; estimated_value?: number | null; expected_close_at?: string | null };
}

function parseAiJson(rawText: string): AiParsedRaw {
  let text = rawText.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) text = fence[1].trim();
  try {
    return JSON.parse(text) as AiParsedRaw;
  } catch {
    return {};
  }
}

async function aiParseLead(
  rawText: string,
  tenantId: string,
): Promise<ParsedLead | null> {
  const { masked, map } = masking.mask(rawText);

  const t0 = Date.now();
  let usedProvider: AIProvider = AIProvider.ANTHROPIC;
  let configuredProvider: AIProvider = AIProvider.ANTHROPIC;
  let usedFallback = false;
  let effectiveModel = MODELS.HAIKU;
  let promptTokens = 0;
  let completionTokens = 0;
  let success = true;
  let errorCode: string | undefined;
  let rawResponse = '';

  try {
    const out = await dispatchChat({
      featureCode: 'inbound-lead-parser',
      tenantId,
      chat: {
        systemPrompt: AI_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: masked }],
        maxTokens: 512,
      },
    });
    promptTokens = out.inputTokens;
    completionTokens = out.outputTokens;
    rawResponse = out.text;
    usedProvider = out.usedProvider;
    configuredProvider = out.configuredProvider;
    usedFallback = out.usedFallback;
    effectiveModel = out.model || MODELS.HAIKU;
  } catch (err) {
    success = false;
    errorCode = err instanceof Error ? err.name : 'unknown';
    // Feature gate errors propagam. Provider errors (429/5xx) caem no null.
    if (
      err instanceof FeatureNotAvailableError ||
      err instanceof AiLimitExceededError
    ) {
      throw err;
    }
  } finally {
    await logAiUsage({
      tenantId,
      userId: null,
      provider: usedProvider,
      model: effectiveModel,
      promptTokens,
      completionTokens,
      requestType: 'inbound_lead_parse',
      latencyMs: Date.now() - t0,
      success,
      errorCode,
      usedFallback,
      configuredProvider,
    });
  }

  if (!success || !rawResponse) return null;

  const parsedMasked = parseAiJson(rawResponse);
  // Desmascara PII antes de devolver
  const unmask = (v: string | null | undefined) =>
    v ? masking.unmask(v, map) : undefined;

  const contact: ParsedLeadContact = {
    name: unmask(parsedMasked.contact?.name),
    email: unmask(parsedMasked.contact?.email),
    phone: unmask(parsedMasked.contact?.phone),
    role: unmask(parsedMasked.contact?.role),
  };
  const company: ParsedLeadCompany = {
    name: unmask(parsedMasked.company?.name),
    cnpj: parsedMasked.company?.cnpj ? normalizeCnpj(unmask(parsedMasked.company.cnpj) ?? '') : undefined,
    website: unmask(parsedMasked.company?.website),
    segment: unmask(parsedMasked.company?.segment),
  };
  const interest: ParsedLeadInterest = {
    message: unmask(parsedMasked.interest?.message),
    estimatedValue:
      typeof parsedMasked.interest?.estimated_value === 'number'
        ? parsedMasked.interest.estimated_value
        : undefined,
    expectedCloseAt: parsedMasked.interest?.expected_close_at
      ? parseIsoDate(parsedMasked.interest.expected_close_at)
      : undefined,
  };

  // Sem contact.email nem company.cnpj → IA não achou nada útil
  if (!contact.email && !company.cnpj) return null;

  return {
    contact,
    company,
    interest,
    confidence: 0.65,
    parsedBy: `ai:${effectiveModel}`,
  };
}

// ═════════════════════════════════════════════════════════════════
// Entry point
// ═════════════════════════════════════════════════════════════════

export interface ParseLeadOpts {
  tenantId: string;
  /** Aceita string bruta (email) ou objeto (webhook JSON). */
  raw: string | Record<string, unknown>;
  source: ParseSource;
}

/**
 * Parseia lead inbound aplicando cascata regex → IA. Devolve ParsedLead
 * mesmo em confidence baixa; caller decide se cria opp ou coloca em
 * inbound_leads_rejected.
 *
 * Retorna null apenas se nem IA nem regex conseguiram extrair email/CNPJ
 * mínimo (não vale a pena persistir opportunity sem contato).
 */
export async function parseLead(opts: ParseLeadOpts): Promise<ParsedLead | null> {
  const { raw, source, tenantId } = opts;

  // 1. Cascata de matchers regex — para no primeiro com confidence ≥ 0.85
  for (const matcher of MATCHERS) {
    const attempt = matcher.tryParse(raw, source);
    if (attempt && attempt.confidence >= 0.85) return attempt;
  }

  // 2. Fallback IA (só faz sentido se veio string).
  if (typeof raw !== 'string') {
    // Webhook JSON que não bateu o schema — devolve o que temos, confidence baixa.
    const dict: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string') dict[normalizeKey(k)] = v;
    }
    const lead = buildFromKeyValueDict(dict);
    if (!lead.contact.email && !lead.company.cnpj) return null;
    return { ...lead, confidence: 0.5, parsedBy: 'regex:webhook-fallback' };
  }

  return aiParseLead(raw, tenantId);
}

// Exports pra teste
export const _internal = {
  MATCHERS,
  extractKeyValuePairs,
  buildFromKeyValueDict,
  parseCurrencyBrl,
  parseIsoDate,
  normalizeCnpj,
  normalizeKey,
  parseAiJson,
};
