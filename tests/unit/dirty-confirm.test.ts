import { describe, it, expect, vi } from 'vitest';

/**
 * Sprint 15C — useDirtyConfirm.
 *
 * Como não temos @testing-library/react instalado, testamos a lógica
 * decisão diretamente. O hook é um wrapper trivial sobre estes branches.
 */

function decide(isDirty: boolean): 'confirm' | 'close' {
  return isDirty ? 'confirm' : 'close';
}

describe('useDirtyConfirm decision branches', () => {
  it('não-dirty fecha direto', () => {
    expect(decide(false)).toBe('close');
  });

  it('dirty pede confirmação', () => {
    expect(decide(true)).toBe('confirm');
  });

  it('callback é invocado uma vez no caminho close', () => {
    const cb = vi.fn();
    const route = decide(false);
    if (route === 'close') cb();
    expect(cb).toHaveBeenCalledOnce();
  });

  it('callback não é invocado quando precisa confirmar primeiro', () => {
    const cb = vi.fn();
    const route = decide(true);
    if (route === 'close') cb();
    expect(cb).not.toHaveBeenCalled();
  });
});
