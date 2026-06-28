import { describe, it, expect } from 'vitest';
import { parseFile } from '@/lib/import/parser';

function csv(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('parseFile CSV', () => {
  it('parseia CSV simples', async () => {
    const r = await parseFile(
      'companies.csv',
      csv('razao,cnpj\nAcme Ltda,11222333000181\nBeta SA,'),
    );
    expect(r.headers).toEqual(['razao', 'cnpj']);
    expect(r.totalRows).toBe(2);
    expect(r.rows[0]).toEqual(['Acme Ltda', '11222333000181']);
    expect(r.rows[1]).toEqual(['Beta SA', '']);
  });

  it('skipEmptyLines descarta linhas vazias', async () => {
    const r = await parseFile('x.csv', csv('a,b\n1,2\n\n3,4\n'));
    expect(r.totalRows).toBe(2);
  });

  it('previewOnly limita rows mas totalRows reflete amostra', async () => {
    const lines = ['a,b'];
    for (let i = 0; i < 50; i++) lines.push(`${i},${i * 2}`);
    const r = await parseFile('x.csv', csv(lines.join('\n')), {
      previewOnly: true,
      previewLimit: 5,
    });
    expect(r.rows).toHaveLength(5);
  });

  it('detecta separador TAB', async () => {
    const r = await parseFile('x.tsv', csv('a\tb\n1\t2'));
    expect(r.headers).toEqual(['a', 'b']);
    expect(r.rows[0]).toEqual(['1', '2']);
  });

  it('rejeita extensão desconhecida', async () => {
    await expect(parseFile('arquivo.pdf', csv('x,y'))).rejects.toThrow(/não suportado/i);
  });
});
