import { describe, it, expect } from 'vitest';

/**
 * Sprint 15C — Listas configuráveis: validação de "em uso" antes do
 * soft delete. Lógica reproduzida como função pura para teste sem DB.
 */

function canDelete(inUseCount: number): { ok: boolean; reason?: string } {
  if (inUseCount > 0) {
    return {
      ok: false,
      reason: `está em uso em ${inUseCount} registro${inUseCount === 1 ? '' : 's'}. Desative em vez de excluir.`,
    };
  }
  return { ok: true };
}

describe('Configurable list — proteção de exclusão em uso', () => {
  it('permite excluir quando não está em uso', () => {
    const r = canDelete(0);
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('bloqueia com mensagem singular quando 1 referência', () => {
    const r = canDelete(1);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('1 registro');
    expect(r.reason).not.toContain('registros');
  });

  it('bloqueia com mensagem plural quando ≥2 referências', () => {
    const r = canDelete(7);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('7 registros');
  });

  it('mensagem sugere desativar em vez de excluir', () => {
    const r = canDelete(3);
    expect(r.reason).toContain('Desative em vez de excluir');
  });
});

describe('Configurable list — reorder helper', () => {
  // arrayMove polyfill local; mesmo algoritmo do @dnd-kit/sortable.
  function reorder(ids: string[], oldIdx: number, newIdx: number): string[] {
    const out = ids.slice();
    const [item] = out.splice(oldIdx, 1);
    if (item !== undefined) out.splice(newIdx, 0, item);
    return out;
  }

  it('move primeiro pra última posição', () => {
    expect(reorder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('move último pra primeira posição', () => {
    expect(reorder(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('move adjacente', () => {
    expect(reorder(['a', 'b', 'c'], 1, 2)).toEqual(['a', 'c', 'b']);
  });

  it('preserva quando origem == destino', () => {
    expect(reorder(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });
});
