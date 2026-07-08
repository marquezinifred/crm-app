import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Sprint 15G Fase 4b — ScopeSwitcher (pipeline).
 *
 * O componente mostra Select só quando o `myScope` resolvido é TEAM ou
 * ALL. Persiste escolha em localStorage por userId. Callback `onChange`
 * é disparado no mount (com valor persistido ou default) e a cada troca.
 */

// Node 22+ / jsdom recentes podem entregar `window.localStorage` undefined
// sem `--localstorage-file`. Instalamos um shim Map-based por segurança —
// suficiente pra `getItem`/`setItem`/`clear` que o componente usa.
beforeAll(() => {
  if (typeof window !== 'undefined' && !window.localStorage) {
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => {
          store.set(k, String(v));
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
        clear: () => store.clear(),
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        get length() {
          return store.size;
        },
      },
    });
  }
});

type ScopePayload =
  | { type: 'OWN'; filter: unknown }
  | { type: 'PARTNER'; filter: unknown }
  | { type: 'NONE'; filter: unknown }
  | { type: 'TEAM'; filter: unknown; teamSize: number }
  | { type: 'ALL'; filter: unknown };

let scopeData: ScopePayload | undefined = undefined;
let meData: { id: string; fullName?: string; role?: string } | undefined = undefined;

vi.mock('@/lib/trpc/client', () => {
  const queryReturn = (data: unknown) => ({
    data,
    isLoading: false,
    isFetching: false,
    error: null,
  });
  return {
    trpc: {
      salesStructure: {
        myScope: {
          useQuery: () => queryReturn(scopeData),
        },
      },
      users: {
        me: {
          useQuery: () => queryReturn(meData),
        },
      },
    },
  };
});

import { ScopeSwitcher } from '@/components/pipeline/ScopeSwitcher';

function key(userId: string) {
  return `pipeline:scope-preference:${userId}`;
}

beforeEach(() => {
  scopeData = undefined;
  meData = undefined;
  window.localStorage.clear();
});

describe('<ScopeSwitcher /> Sprint 15G Fase 4b', () => {
  it('não renderiza quando scope.type = OWN', () => {
    meData = { id: 'me-1' };
    scopeData = { type: 'OWN', filter: {} };
    const onChange = vi.fn();
    const { container } = render(<ScopeSwitcher onChange={onChange} />);
    expect(container).toBeEmptyDOMElement();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('não renderiza quando scope.type = PARTNER', () => {
    meData = { id: 'me-1' };
    scopeData = { type: 'PARTNER', filter: {} };
    const onChange = vi.fn();
    const { container } = render(<ScopeSwitcher onChange={onChange} />);
    expect(container).toBeEmptyDOMElement();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('não renderiza quando scope.type = NONE (PARCEIRO órfão)', () => {
    meData = { id: 'me-1' };
    scopeData = { type: 'NONE', filter: {} };
    const { container } = render(<ScopeSwitcher onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('scope TEAM mostra Select com 2 opções (Minhas + Minha equipe com contagem)', () => {
    meData = { id: 'me-1' };
    scopeData = { type: 'TEAM', filter: {}, teamSize: 7 };
    render(<ScopeSwitcher onChange={vi.fn()} />);

    const select = screen.getByLabelText(
      /Escopo de visualização das oportunidades/i,
    ) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['MINE', 'TEAM']);

    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels[0]).toMatch(/Minhas oportunidades/);
    expect(labels[1]).toMatch(/Minha equipe \(7\)/);
  });

  it('scope ALL mostra Select com 2 opções (Minhas + Toda a empresa) — nunca inclui "Minha equipe"', () => {
    meData = { id: 'me-1' };
    scopeData = { type: 'ALL', filter: {} };
    render(<ScopeSwitcher onChange={vi.fn()} />);

    const select = screen.getByLabelText(
      /Escopo de visualização das oportunidades/i,
    ) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['MINE', 'ALL']);
    expect(values).not.toContain('TEAM');

    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels[0]).toMatch(/Minhas oportunidades/);
    expect(labels[1]).toMatch(/Toda a empresa/);
  });

  it('onChange dispara com valor persistido no localStorage no mount', () => {
    meData = { id: 'me-1' };
    scopeData = { type: 'TEAM', filter: {}, teamSize: 3 };
    window.localStorage.setItem(key('me-1'), 'MINE');
    const onChange = vi.fn();

    render(<ScopeSwitcher onChange={onChange} />);

    expect(onChange).toHaveBeenCalledWith('MINE');
    const select = screen.getByLabelText(
      /Escopo de visualização das oportunidades/i,
    ) as HTMLSelectElement;
    expect(select.value).toBe('MINE');
  });

  it('sem valor persistido, default é a opção mais ampla — TEAM em scope TEAM', () => {
    meData = { id: 'me-1' };
    scopeData = { type: 'TEAM', filter: {}, teamSize: 3 };
    const onChange = vi.fn();

    render(<ScopeSwitcher onChange={onChange} />);

    expect(onChange).toHaveBeenCalledWith('TEAM');
    const select = screen.getByLabelText(
      /Escopo de visualização das oportunidades/i,
    ) as HTMLSelectElement;
    expect(select.value).toBe('TEAM');
    expect(window.localStorage.getItem(key('me-1'))).toBeNull();
  });

  it('sem valor persistido, default é a opção mais ampla — ALL em scope ALL', () => {
    meData = { id: 'me-1' };
    scopeData = { type: 'ALL', filter: {} };
    const onChange = vi.fn();

    render(<ScopeSwitcher onChange={onChange} />);

    expect(onChange).toHaveBeenCalledWith('ALL');
    const select = screen.getByLabelText(
      /Escopo de visualização das oportunidades/i,
    ) as HTMLSelectElement;
    expect(select.value).toBe('ALL');
  });

  it('trocar de opção grava no localStorage e dispara onChange', async () => {
    meData = { id: 'me-42' };
    scopeData = { type: 'TEAM', filter: {}, teamSize: 5 };
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<ScopeSwitcher onChange={onChange} />);

    onChange.mockClear();

    const select = screen.getByLabelText(
      /Escopo de visualização das oportunidades/i,
    ) as HTMLSelectElement;
    await user.selectOptions(select, 'MINE');

    expect(onChange).toHaveBeenCalledWith('MINE');
    expect(window.localStorage.getItem(key('me-42'))).toBe('MINE');
  });

  it('valor stale no localStorage (TEAM quando scope agora é ALL) cai no default sem quebrar', () => {
    meData = { id: 'me-9' };
    scopeData = { type: 'ALL', filter: {} };
    window.localStorage.setItem(key('me-9'), 'TEAM');
    const onChange = vi.fn();

    render(<ScopeSwitcher onChange={onChange} />);

    expect(onChange).toHaveBeenCalledWith('ALL');
    const select = screen.getByLabelText(
      /Escopo de visualização das oportunidades/i,
    ) as HTMLSelectElement;
    expect(select.value).toBe('ALL');
  });
});
