import { describe, it, expect } from 'vitest';
import { lookupCep } from '@/lib/cep/lookup';

const SAMPLE = {
  cep: '01310100',
  state: 'SP',
  city: 'São Paulo',
  neighborhood: 'Bela Vista',
  street: 'Avenida Paulista',
};

function makeFetch(impl: (url: string) => Promise<Response>): typeof fetch {
  return ((url: string) => impl(url)) as unknown as typeof fetch;
}

describe('lookupCep — Sprint 15C', () => {
  it('aceita CEP com máscara', async () => {
    const f = makeFetch(async () => new Response(JSON.stringify(SAMPLE), { status: 200 }));
    const r = await lookupCep('01310-100', { fetchImpl: f });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.data.state).toBe('SP');
      expect(r.data.city).toBe('São Paulo');
    }
  });

  it('rejeita CEP com tamanho inválido', async () => {
    const r = await lookupCep('123', { fetchImpl: makeFetch(async () => new Response()) });
    expect(r.status).toBe('error');
  });

  it('mapeia 404 → not-found', async () => {
    const f = makeFetch(async () => new Response('', { status: 404 }));
    const r = await lookupCep('99999999', { fetchImpl: f });
    expect(r.status).toBe('not-found');
  });

  it('mapeia 429 → rate-limited', async () => {
    const f = makeFetch(async () => new Response('', { status: 429 }));
    const r = await lookupCep('99999998', { fetchImpl: f });
    expect(r.status).toBe('rate-limited');
  });

  it('exceção de rede → error', async () => {
    const f = makeFetch(async () => {
      throw new Error('network down');
    });
    const r = await lookupCep('01310100', { fetchImpl: f });
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message).toContain('network');
  });

  it('extrai dados corretamente', async () => {
    const f = makeFetch(
      async () =>
        new Response(JSON.stringify(SAMPLE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const r = await lookupCep('01310100', { fetchImpl: f });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.data.cep).toBe('01310100');
      expect(r.data.neighborhood).toBe('Bela Vista');
      expect(r.data.street).toBe('Avenida Paulista');
    }
  });
});
