/**
 * DataMaskingService — versão Sprint 4 (NER heurístico PT-BR).
 *
 * Tokeniza PII determinística antes de enviar texto a providers de IA, e
 * destokeniza na resposta. Implementação por regex + heurísticas — não usa
 * modelo ML. Cobre maioria dos casos de e-mails/CRMs em PT-BR; falsos
 * positivos são preferíveis a vazamentos (token visto na IA é seguro,
 * dado original que escapa é violação LGPD).
 *
 * Ordem de aplicação importa:
 *   1. CNPJ/CPF/PHONE/EMAIL — patterns determinísticos
 *   2. EMPRESA — antes de PESSOA pra não confundir "Acme Tec Ltda" → 3 nomes
 *   3. PESSOA — sequências de palavras capitalizadas
 *   4. VALOR — monetários
 *
 * Uso obrigatório (ver CLAUDE.md):
 *   const { masked, map } = masking.mask(userText);
 *   const aiResponse = await claude.complete(masked);
 *   const safe = masking.unmask(aiResponse, map);
 */

export interface MaskResult {
  masked: string;
  map: Record<string, string>;
}

type PiiKind = 'EMAIL' | 'PHONE' | 'CPF' | 'CNPJ' | 'EMPRESA' | 'PESSOA' | 'VALOR' | 'ENDERECO';

const EMAIL_RE = /[\w.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?:\+?55\s?)?(?:\(?\d{2}\)?[\s-]?)?9?\d{4}[-\s]?\d{4}/g;
const CPF_RE = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
const CNPJ_RE = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g;

// Empresa: 1-5 palavras capitalizadas seguidas de sufixo societário
const EMPRESA_RE =
  /\b(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ&.]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ&.]+){0,4})\s+(?:Ltda\.?|S\.?\/?A\.?|EIRELI|ME\b|S\.A\.?|Inc\.?|LLC|Corp\.?)/g;

// Valor monetário: R$ ou valor mil/milhões/bilhões
const VALOR_RE =
  /(?:R\$\s*[\d.]+(?:,\d{1,2})?(?:\s*(?:mil|milhões?|bilhões?|k|M|B|MM))?|\b\d+(?:[.,]\d+)?\s+(?:mil|milhões?|bilhões?)\s+(?:de\s+)?reais\b)/gi;

// Pessoa (heurística): 2-4 palavras consecutivas capitalizadas, opcionalmente
// com conectores ("da", "de", "do", "dos", "das", "e") entre elas.
// Restrições para reduzir falsos positivos:
//   - cada palavra "nome" deve ter ≥2 letras
//   - aceita acentuação PT-BR (À-Ý)
//   - rejeita palavras 100% maiúsculas (CNAE, CEP, BR — não são nomes)
const PESSOA_RE =
  /\b(?:[A-ZÀ-Ý][a-zà-ÿ]{1,})(?:\s+(?:d[aeo]s?|e|von|van|del|do)\s+[A-ZÀ-Ý][a-zà-ÿ]{1,}|\s+[A-ZÀ-Ý][a-zà-ÿ]{1,}){1,3}\b/g;

// Endereço: padrão simplificado "Rua/Av./Avenida Xxx, número"
// Aceita preposições (das, dos, da, de, do) em minúscula entre as palavras
const ENDERECO_RE =
  /\b(?:Rua|Av\.?|Avenida|Travessa|Alameda|Praça|Pça\.?|Rod\.?|Rodovia|Estrada)\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s.,'-]{2,80}?(?:,\s*\d+|\s+\d+)\b/g;

interface Rule {
  kind: PiiKind;
  regex: RegExp;
  /** Se retornar true, o match é descartado (não mascarado). */
  reject?: (match: string) => boolean;
}

// Lista de "nomes" que parecem pessoa mas são contextos comuns — descartar.
const PESSOA_BLACKLIST = new Set([
  'Brasil', 'São Paulo', 'Rio de Janeiro', 'Minas Gerais', 'Belo Horizonte',
  'Sul', 'Norte', 'Sudeste', 'Nordeste', 'Centro Oeste',
  'CNPJ', 'CPF', 'NDA', 'Termo', 'Anexo',
]);

const RULES: Rule[] = [
  { kind: 'CNPJ', regex: CNPJ_RE },
  { kind: 'CPF', regex: CPF_RE },
  { kind: 'EMAIL', regex: EMAIL_RE },
  { kind: 'PHONE', regex: PHONE_RE },
  { kind: 'ENDERECO', regex: ENDERECO_RE },
  { kind: 'EMPRESA', regex: EMPRESA_RE },
  {
    kind: 'PESSOA',
    regex: PESSOA_RE,
    reject: (m) => PESSOA_BLACKLIST.has(m.trim()),
  },
  { kind: 'VALOR', regex: VALOR_RE },
];

export class DataMaskingService {
  mask(text: string): MaskResult {
    const map: Record<string, string> = {};
    const counters: Record<PiiKind, number> = {
      EMAIL: 0, PHONE: 0, CPF: 0, CNPJ: 0,
      EMPRESA: 0, PESSOA: 0, VALOR: 0, ENDERECO: 0,
    };
    const reverse = new Map<string, string>();

    let masked = text;
    for (const rule of RULES) {
      masked = masked.replace(rule.regex, (match) => {
        if (rule.reject?.(match)) return match;
        const existing = reverse.get(match);
        if (existing) return existing;
        counters[rule.kind] += 1;
        const token = `[${rule.kind}_${counters[rule.kind]}]`;
        map[token] = match;
        reverse.set(match, token);
        return token;
      });
    }
    return { masked, map };
  }

  unmask(text: string, map: Record<string, string>): string {
    let result = text;
    // Iterar do token mais longo para o mais curto evita colisão tipo
    // [EMAIL_1] vs [EMAIL_10]
    const tokens = Object.keys(map).sort((a, b) => b.length - a.length);
    for (const token of tokens) {
      const value = map[token];
      if (value === undefined) continue;
      result = result.split(token).join(value);
    }
    return result;
  }

  /**
   * Conta quantos tokens de cada tipo seriam gerados, sem mutar nada.
   * Útil para métricas de "PII detectada por chamada".
   */
  audit(text: string): Record<PiiKind, number> {
    const { map } = this.mask(text);
    const counts: Record<PiiKind, number> = {
      EMAIL: 0, PHONE: 0, CPF: 0, CNPJ: 0,
      EMPRESA: 0, PESSOA: 0, VALOR: 0, ENDERECO: 0,
    };
    for (const token of Object.keys(map)) {
      const kind = token.slice(1).split('_')[0] as PiiKind;
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    return counts;
  }
}

export const masking = new DataMaskingService();
