import { describe, it, expect } from 'vitest';
import { ESTADOS_BR, PAISES, fetchCidades } from '@/lib/data/brasil';

describe('Brasil data — Sprint 15C', () => {
  it('tem 27 UFs com sigla e nome', () => {
    expect(ESTADOS_BR).toHaveLength(27);
    for (const e of ESTADOS_BR) {
      expect(e.uf).toMatch(/^[A-Z]{2}$/);
      expect(e.nome.length).toBeGreaterThan(2);
    }
  });

  it('lista de países começa com Brasil', () => {
    expect(PAISES[0]?.code).toBe('BR');
    expect(PAISES.length).toBeGreaterThan(20);
  });

  it('fetchCidades rejeita UF inválida sem chamar API', async () => {
    const r = await fetchCidades('xx', (() => {
      throw new Error('não deveria chamar');
    }) as unknown as typeof fetch);
    expect(r).toEqual([]);
  });

  it('fetchCidades retorna ordenado alfabeticamente', async () => {
    const raw = [
      { id: 1, nome: 'Zacarias' },
      { id: 2, nome: 'Acre' },
      { id: 3, nome: 'Manaus' },
    ];
    const f = (async () => new Response(JSON.stringify(raw))) as unknown as typeof fetch;
    const r = await fetchCidades('SP', f);
    expect(r.map((c) => c.nome)).toEqual(['Acre', 'Manaus', 'Zacarias']);
  });

  it('fetchCidades retorna [] quando resposta não-ok', async () => {
    const f = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    const r = await fetchCidades('SP', f);
    expect(r).toEqual([]);
  });
});
