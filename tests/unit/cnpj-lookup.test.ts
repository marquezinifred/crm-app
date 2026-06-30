import { describe, it, expect, vi } from 'vitest';
import {
  lookupCnpj,
  formatPhone,
  toTitleCase,
  BRASILAPI_ENDPOINT,
} from '@/lib/cnpj/lookup';

/**
 * Cobertura de lookupCnpj (BrasilAPI) — todos os caminhos do tipo
 * união CnpjLookupResult + normalizadores.
 */

const VALID_DIGITS = '03007331000141';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(impl: typeof fetch) {
  return impl;
}

const BASE_PAYLOAD = {
  cnpj: VALID_DIGITS,
  razao_social: 'EBAZAR.COM.BR. LTDA',
  nome_fantasia: 'MERCADO LIVRE',
  descricao_situacao_cadastral: 'ATIVA',
  cnae_fiscal: 4791101,
  cnae_fiscal_descricao: 'Comércio varejista pela internet',
  uf: 'SP',
  municipio: 'SAO PAULO',
  ddd_telefone_1: '1142222222',
};

describe('lookupCnpj', () => {
  it('rejeita CNPJ com menos de 14 dígitos sem chamar a rede', async () => {
    const fetchSpy = vi.fn();
    const r = await lookupCnpj('123', { fetchImpl: mockFetch(fetchSpy as never) });
    expect(r.status).toBe('error');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('retorna ok com dados normalizados em situação ATIVA', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(BASE_PAYLOAD));
    const r = await lookupCnpj(VALID_DIGITS, { fetchImpl: fetchImpl as never });

    expect(fetchImpl).toHaveBeenCalledWith(
      `${BRASILAPI_ENDPOINT}/${VALID_DIGITS}`,
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.data.razaoSocial).toBe('EBAZAR.COM.BR. LTDA');
      expect(r.data.nomeFantasia).toBe('MERCADO LIVRE');
      expect(r.data.state).toBe('SP');
      expect(r.data.city).toBe('Sao Paulo');
      expect(r.data.cnaeCode).toBe('4791101');
      expect(r.data.cnaeName).toBe('Comércio varejista pela internet');
      expect(r.data.phone).toBe('(11) 4222-2222');
    }
  });

  it('mapeia 404 para not-found', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }));
    const r = await lookupCnpj(VALID_DIGITS, { fetchImpl: fetchImpl as never });
    expect(r.status).toBe('not-found');
  });

  it('flagra situação BAIXADA como inactive mas devolve os dados', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ...BASE_PAYLOAD, descricao_situacao_cadastral: 'BAIXADA' }),
    );
    const r = await lookupCnpj(VALID_DIGITS, { fetchImpl: fetchImpl as never });
    expect(r.status).toBe('inactive');
    if (r.status === 'inactive') {
      expect(r.situacao).toBe('BAIXADA');
      expect(r.data.razaoSocial).toBe('EBAZAR.COM.BR. LTDA');
    }
  });

  it('mapeia 429 para rate-limited', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 429 }));
    const r = await lookupCnpj(VALID_DIGITS, { fetchImpl: fetchImpl as never });
    expect(r.status).toBe('rate-limited');
  });

  it('trata 5xx como erro', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));
    const r = await lookupCnpj(VALID_DIGITS, { fetchImpl: fetchImpl as never });
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message).toContain('503');
  });

  it('trata JSON malformado como erro', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('<html>not json</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
    );
    const r = await lookupCnpj(VALID_DIGITS, { fetchImpl: fetchImpl as never });
    expect(r.status).toBe('error');
  });

  it('trata exceção de rede (fetch reject) como erro', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('Network unreachable');
    });
    const r = await lookupCnpj(VALID_DIGITS, { fetchImpl: fetchImpl as never });
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message).toBe('Network unreachable');
  });

  it('respeita o AbortSignal e devolve erro aborted', async () => {
    const ctrl = new AbortController();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const promise = lookupCnpj(VALID_DIGITS, {
      fetchImpl: fetchImpl as never,
      signal: ctrl.signal,
    });
    ctrl.abort();
    const r = await promise;
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message).toBe('aborted');
  });
});

describe('toTitleCase', () => {
  it('preserva preposições/artigos PT-BR em minúscula exceto na primeira posição', () => {
    expect(toTitleCase('RIO GRANDE DO SUL')).toBe('Rio Grande do Sul');
    expect(toTitleCase('SAO JOSE DOS CAMPOS')).toBe('Sao Jose dos Campos');
    expect(toTitleCase('SANTANA DE PARNAIBA')).toBe('Santana de Parnaiba');
    // primeira palavra é sempre capitalizada, mesmo sendo conjunção
    expect(toTitleCase('e teste')).toBe('E Teste');
    expect(toTitleCase('')).toBe('');
  });
});

describe('formatPhone', () => {
  it('formata 10 dígitos como fixo', () => {
    expect(formatPhone('1142222222')).toBe('(11) 4222-2222');
  });

  it('formata 11 dígitos como celular', () => {
    expect(formatPhone('11942222222')).toBe('(11) 94222-2222');
  });

  it('devolve original se tamanho não bate', () => {
    expect(formatPhone('123')).toBe('123');
  });

  it('ignora caracteres não-numéricos antes de formatar', () => {
    expect(formatPhone('(11) 4222-2222')).toBe('(11) 4222-2222');
  });
});
