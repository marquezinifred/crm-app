import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

/**
 * Voice & tone — guarda no CI contra microcopy robótico.
 *
 * Os critérios refletem o brand guide:
 *  - "Nenhum encontrado" / "Nenhuma encontrada" → não permitido
 *  - "criado com sucesso", "atualizado com sucesso" → trocar por voz Venzo
 *  - "Erro 500", "Internal server error" no UI → não permitido
 */

function grep(pattern: string): string[] {
  try {
    const out = execSync(
      `grep -rnE ${JSON.stringify(pattern)} src/app src/components 2>/dev/null | grep -v 'empty-state.tsx' || true`,
      { encoding: 'utf-8' },
    );
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

describe('voice & tone Venzo', () => {
  it('sem "Nenhum/Nenhuma encontrado/encontrada" em src', () => {
    const hits = grep('Nenhum[a]? .*(encontrad[oa])');
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('sem "criado com sucesso" / "atualizado com sucesso"', () => {
    const hits = grep('(criado|atualizado|removido|salvo) com sucesso');
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('sem mensagens HTTP cruas no UI ("Internal server error", "Erro 5\\d\\d")', () => {
    const hits = grep('(Internal server error|Erro [45][0-9][0-9])');
    expect(hits, hits.join('\n')).toEqual([]);
  });
});
