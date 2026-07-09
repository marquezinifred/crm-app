import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Modal } from '@/components/ui/modal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.documentElement.style.overflow = '';
});

function flush() {
  // useEffect commit
  return act(async () => {
    await Promise.resolve();
  });
}

describe('Modal (P-12)', () => {
  it('re-render do parent com onClose inline NÃO rouba foco do input ativo', async () => {
    function Harness() {
      const [, setTick] = React.useState(0);
      return (
        <Modal open onClose={() => setTick((n) => n + 1)} title="Novo tenant">
          <input data-testid="a" />
          <input data-testid="b" />
          <input data-testid="c" />
        </Modal>
      );
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await flush();

    const inputs = container.ownerDocument.querySelectorAll<HTMLInputElement>(
      'input[data-testid]',
    );
    expect(inputs.length).toBe(3);

    const second = inputs[1]!;
    second.focus();
    expect(document.activeElement).toBe(second);

    // Simula re-render do parent (cada keystroke do form chama setForm e
    // gera nova closure pra onClose). Sem o fix, isso refocava o input[0].
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        root.render(<Harness />);
      });
      await flush();
    }

    expect(document.activeElement).toBe(second);
  });

  it('ESC fecha o modal (chama onCloseRef.current)', async () => {
    const onClose = vi.fn();
    function Harness({ open }: { open: boolean }) {
      return (
        <Modal open={open} onClose={onClose} title="Test">
          <input data-testid="a" />
        </Modal>
      );
    }

    await act(async () => {
      root.render(<Harness open />);
    });
    await flush();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Sprint 15G — Modal migrou pra Radix Dialog. Tab trap agora é responsabilidade
  // do Radix Focus Scope (biblioteca amplamente testada). Este teste simulava
  // keydown manualmente contra o Modal custom antigo; não bate mais com o
  // fluxo de focus events do Radix. Cobertura funcional preservada via
  // tests/component/admin-commercial-structure.test.tsx que exercita o Modal
  // real com Testing Library (Tab funciona no browser real).
  it.skip('Tab trap continua ciclando dentro do modal (skip — delegado ao Radix)', async () => {
    function Harness() {
      return (
        <Modal open onClose={() => {}} title="Test">
          <input data-testid="first" />
          <input data-testid="middle" />
          <input data-testid="last" />
        </Modal>
      );
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await flush();

    // Focáveis incluem o botão "Fechar" do header — é o ÚLTIMO focável
    // (renderizado depois do close button no header — não, na verdade
    // close button vem ANTES dos children no DOM). Vamos pegar o real
    // primeiro e último via querySelectorAll igual o componente.
    const focusables = container.querySelectorAll<HTMLElement>(
      'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;

    // Shift+Tab no primeiro → vai pro último
    first.focus();
    expect(document.activeElement).toBe(first);
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(document.activeElement).toBe(last);

    // Tab no último → vai pro primeiro
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(first);
  });
});
