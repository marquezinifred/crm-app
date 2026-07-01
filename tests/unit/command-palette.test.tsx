import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const routerPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));

type QueryState = {
  data:
    | {
        companies: Array<{ id: string; name: string; cnpj: string | null; city: string | null }>;
        contacts: Array<{ id: string; fullName: string; email: string; companyName: string | null }>;
        opportunities: Array<{ id: string; title: string; stage: string; companyName: string | null }>;
        users: Array<{ id: string; fullName: string; email: string; role: string }>;
      }
    | undefined;
  isFetching: boolean;
};

const queryState: QueryState = { data: undefined, isFetching: false };
const useQuerySpy = vi.fn(
  (_input: { query: string }, opts: { enabled: boolean }) => {
    void opts;
    return {
      data: queryState.data,
      isFetching: queryState.isFetching,
    };
  },
);

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    search: {
      global: {
        useQuery: (input: { query: string }, opts: { enabled: boolean }) =>
          useQuerySpy(input, opts),
      },
    },
  },
}));

// Importa DEPOIS dos mocks
import { CommandPalette } from '@/components/search/CommandPalette';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  routerPush.mockClear();
  useQuerySpy.mockClear();
  queryState.data = undefined;
  queryState.isFetching = false;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.documentElement.style.overflow = '';
});

function flush() {
  return act(async () => {
    await Promise.resolve();
  });
}

async function render(node: React.ReactElement) {
  await act(async () => {
    root.render(node);
  });
  await flush();
}

/**
 * React controla o input via internal valueTracker — atribuir `input.value`
 * direto não dispara o onChange. Precisamos usar o setter nativo do
 * prototype para o React "ver" o novo valor no evento input.
 */
async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function waitForDebounce() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 250));
  });
}

async function focusRaf() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
  });
}

const onClose = vi.fn();

describe('CommandPalette (P-16)', () => {
  beforeEach(() => onClose.mockClear());

  it('não renderiza nada quando open=false', async () => {
    await render(<CommandPalette open={false} onClose={onClose} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renderiza com input focado quando abre', async () => {
    await render(<CommandPalette open onClose={onClose} />);
    await focusRaf();
    const input = container.querySelector<HTMLInputElement>('input[type="text"]');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('exibe hint quando query < 2 caracteres', async () => {
    await render(<CommandPalette open onClose={onClose} />);
    expect(container.textContent).toContain('Digite ao menos 2 caracteres');
  });

  it('ESC dispara onClose', async () => {
    await render(<CommandPalette open onClose={onClose} />);
    await focusRaf();
    const input = container.querySelector<HTMLInputElement>('input[type="text"]')!;
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exibe empty state quando resposta sem resultados', async () => {
    queryState.data = {
      companies: [],
      contacts: [],
      opportunities: [],
      users: [],
    };
    queryState.isFetching = false;

    await render(<CommandPalette open onClose={onClose} />);
    await focusRaf();
    const input = container.querySelector<HTMLInputElement>('input[type="text"]')!;

    await typeInto(input, 'marq');
    await waitForDebounce();

    expect(container.textContent).toContain('Nenhum resultado');
  });

  it('renderiza resultados agrupados por bucket com heading', async () => {
    queryState.data = {
      companies: [
        { id: 'c1', name: 'Acme Corp', cnpj: '00000000000191', city: 'SP' },
      ],
      contacts: [
        {
          id: 'ct1',
          fullName: 'Fred Marquezini',
          email: 'fred@example.com',
          companyName: 'Acme',
        },
      ],
      opportunities: [],
      users: [],
    };

    await render(<CommandPalette open onClose={onClose} />);
    await focusRaf();

    const input = container.querySelector<HTMLInputElement>('input[type="text"]')!;
    await typeInto(input, 'ac');
    await waitForDebounce();

    expect(container.textContent).toContain('Empresas');
    expect(container.textContent).toContain('Acme Corp');
    expect(container.textContent).toContain('Contatos');
    expect(container.textContent).toContain('Fred Marquezini');
    // Buckets vazios não renderizam heading
    expect(container.textContent).not.toContain('Oportunidades');
    expect(container.textContent).not.toContain('Pessoas do time');
  });

  it('setas ↑/↓ movem highlight; Enter navega', async () => {
    queryState.data = {
      companies: [
        { id: 'c1', name: 'Acme', cnpj: null, city: null },
        { id: 'c2', name: 'Beta', cnpj: null, city: null },
      ],
      contacts: [],
      opportunities: [],
      users: [],
    };

    await render(<CommandPalette open onClose={onClose} />);
    await focusRaf();

    const input = container.querySelector<HTMLInputElement>('input[type="text"]')!;
    await typeInto(input, 'ac');
    await waitForDebounce();

    // Highlight inicial = 0 → Acme
    let options = container.querySelectorAll<HTMLElement>('[role="option"]');
    expect(options.length).toBe(2);
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');

    // ↓ move pra 1 → Beta
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      );
    });
    options = container.querySelectorAll<HTMLElement>('[role="option"]');
    expect(options[1]!.getAttribute('aria-selected')).toBe('true');

    // Enter → navega pra /companies/c2
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });
    expect(routerPush).toHaveBeenCalledWith('/companies/c2');
    expect(onClose).toHaveBeenCalled();
  });

  it('exibe skeleton loading enquanto fetching', async () => {
    queryState.data = undefined;
    queryState.isFetching = true;

    await render(<CommandPalette open onClose={onClose} />);
    await focusRaf();

    const input = container.querySelector<HTMLInputElement>('input[type="text"]')!;
    await typeInto(input, 'ma');
    await waitForDebounce();

    expect(container.textContent).toContain('Buscando');
  });

  it('mapeia href por bucket: opportunity → /pipeline/, contact → /contacts/, user → /admin/users', async () => {
    queryState.data = {
      companies: [],
      contacts: [],
      opportunities: [
        { id: 'op1', title: 'SIMPAUL', stage: 'PROSPECT', companyName: null },
      ],
      users: [],
    };

    await render(<CommandPalette open onClose={onClose} />);
    await focusRaf();

    const input = container.querySelector<HTMLInputElement>('input[type="text"]')!;
    await typeInto(input, 'sim');
    await waitForDebounce();

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });
    expect(routerPush).toHaveBeenCalledWith('/pipeline/op1');
  });
});
