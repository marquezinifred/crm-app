/**
 * BrasilAPI CNPJ lookup — busca dados públicos da Receita Federal por
 * CNPJ. Usado pelo CompanyForm para pré-preencher razão social,
 * nome fantasia, UF, cidade, telefone e CNAE.
 *
 * Endpoint: https://brasilapi.com.br/api/cnpj/v1/{14_digits}
 * Gratuita, sem auth. Rate limit ~30 req/min/IP.
 *
 * Tolerante a falhas: qualquer indisponibilidade (offline, rede,
 * 5xx) cai para `status: 'error'` para que a UI faça fallback
 * para cadastro manual.
 */

export const BRASILAPI_ENDPOINT = 'https://brasilapi.com.br/api/cnpj/v1';

export interface CnpjData {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  situacaoCadastral: string;
  cnaeCode: string;
  cnaeName: string;
  state: string;
  city: string;
  phone: string | null;
}

export type CnpjLookupResult =
  | { status: 'ok'; data: CnpjData }
  | { status: 'not-found' }
  | { status: 'inactive'; situacao: string; data: CnpjData }
  | { status: 'rate-limited' }
  | { status: 'error'; message: string };

export interface LookupOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

export async function lookupCnpj(
  cnpj: string,
  opts: LookupOptions = {},
): Promise<CnpjLookupResult> {
  const digits = cnpj.replace(/\D/g, '');
  if (digits.length !== 14) {
    return { status: 'error', message: 'CNPJ deve ter 14 dígitos' };
  }

  const f = opts.fetchImpl ?? fetch;
  const endpoint = opts.endpoint ?? BRASILAPI_ENDPOINT;

  let res: Response;
  try {
    res = await f(`${endpoint}/${digits}`, {
      headers: { Accept: 'application/json' },
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { status: 'error', message: 'aborted' };
    }
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }

  if (res.status === 404) return { status: 'not-found' };
  if (res.status === 429) return { status: 'rate-limited' };
  if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { status: 'error', message: 'Resposta inválida' };
  }

  if (!raw || typeof raw !== 'object') {
    return { status: 'error', message: 'Resposta inválida' };
  }

  const data = normalize(raw as Record<string, unknown>);
  const situacao = data.situacaoCadastral.toUpperCase();

  if (situacao && situacao !== 'ATIVA') {
    return { status: 'inactive', situacao, data };
  }
  return { status: 'ok', data };
}

function normalize(raw: Record<string, unknown>): CnpjData {
  const phoneRaw = raw['ddd_telefone_1'];
  const phone =
    typeof phoneRaw === 'string' && phoneRaw ? formatPhone(phoneRaw) : null;

  return {
    cnpj: str(raw['cnpj']),
    razaoSocial: str(raw['razao_social']).trim(),
    nomeFantasia: raw['nome_fantasia'] ? str(raw['nome_fantasia']).trim() : null,
    situacaoCadastral: str(raw['descricao_situacao_cadastral']),
    cnaeCode: raw['cnae_fiscal'] != null ? String(raw['cnae_fiscal']) : '',
    cnaeName: str(raw['cnae_fiscal_descricao']),
    state: str(raw['uf']).trim(),
    city: toTitleCase(str(raw['municipio']).trim()),
    phone,
  };
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

/**
 * Title Case PT-BR. Mantém preposições/artigos comuns em minúscula
 * exceto quando são a primeira palavra ('Rio Grande do Sul', mas
 * 'Do Carmo' fica 'Do Carmo' no início).
 */
export function toTitleCase(s: string): string {
  if (!s) return '';
  const minor = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) => {
      if (i > 0 && minor.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Formata DDD + número para padrão BR. 10 dígitos → fixo,
 * 11 dígitos → celular. Outros tamanhos retornam o original.
 */
export function formatPhone(input: string): string {
  const clean = input.replace(/\D/g, '');
  if (clean.length === 10) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
  }
  if (clean.length === 11) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`;
  }
  return input;
}
