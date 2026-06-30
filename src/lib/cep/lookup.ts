/**
 * BrasilAPI CEP v2 — auto-fill de endereço a partir do CEP.
 *
 * Endpoint: https://brasilapi.com.br/api/cep/v2/{cep}
 * Gratuito, sem auth. Mesma tolerância a falha do CNPJ lookup.
 *
 * O preenchimento NÃO sobrescreve campos preenchidos manualmente —
 * a responsabilidade da UI é mesclar somente onde está vazio.
 */

export const BRASILAPI_CEP_ENDPOINT = 'https://brasilapi.com.br/api/cep/v2';

export interface CepData {
  cep: string;
  state: string;
  city: string;
  neighborhood: string;
  street: string;
}

export type CepLookupResult =
  | { status: 'ok'; data: CepData }
  | { status: 'not-found' }
  | { status: 'rate-limited' }
  | { status: 'error'; message: string };

export interface CepLookupOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

export async function lookupCep(
  cep: string,
  opts: CepLookupOptions = {},
): Promise<CepLookupResult> {
  const digits = cep.replace(/\D/g, '');
  if (digits.length !== 8) {
    return { status: 'error', message: 'CEP deve ter 8 dígitos' };
  }

  const f = opts.fetchImpl ?? fetch;
  const endpoint = opts.endpoint ?? BRASILAPI_CEP_ENDPOINT;

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
    return {
      status: 'error',
      message: e instanceof Error ? e.message : String(e),
    };
  }

  if (res.status === 404) return { status: 'not-found' };
  if (res.status === 429) return { status: 'rate-limited' };
  if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };

  let raw: Record<string, unknown>;
  try {
    raw = (await res.json()) as Record<string, unknown>;
  } catch {
    return { status: 'error', message: 'Resposta inválida' };
  }

  return {
    status: 'ok',
    data: {
      cep: digits,
      state: str(raw['state']).trim(),
      city: str(raw['city']).trim(),
      neighborhood: str(raw['neighborhood']).trim(),
      street: str(raw['street']).trim(),
    },
  };
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}
