import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TH, THead, Table } from '@/components/ui/table';

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
});

function renderTh(props: Partial<React.ComponentProps<typeof TH>>) {
  act(() => {
    root.render(
      <Table>
        <THead>
          <tr>
            <TH {...props}>Nome</TH>
          </tr>
        </THead>
        <tbody>
          <tr>
            <td>Test</td>
          </tr>
        </tbody>
      </Table>,
    );
  });
}

describe('TH sortable (P-17)', () => {
  it('sem sortable, é um <th> mudo sem role/aria-sort/tabIndex', () => {
    renderTh({});
    const th = container.querySelector('th')!;
    expect(th).toBeTruthy();
    expect(th.hasAttribute('aria-sort')).toBe(false);
    expect(th.hasAttribute('tabindex')).toBe(false);
    expect(th.textContent).toBe('Nome');
  });

  it('sortable com state=null renderiza chevron dupla e aria-sort="none"', () => {
    renderTh({ sortable: true, sortState: null });
    const th = container.querySelector('th')!;
    expect(th.getAttribute('aria-sort')).toBe('none');
    expect(th.getAttribute('role')).toBe('columnheader');
    expect(th.getAttribute('tabindex')).toBe('0');
    // chevron dupla = 2 <path>
    expect(th.querySelectorAll('svg path').length).toBe(2);
  });

  it('sortable com state="asc" → aria-sort="ascending" + chevron único (up)', () => {
    renderTh({ sortable: true, sortState: 'asc' });
    const th = container.querySelector('th')!;
    expect(th.getAttribute('aria-sort')).toBe('ascending');
    expect(th.querySelectorAll('svg path').length).toBe(1);
  });

  it('sortable com state="desc" → aria-sort="descending"', () => {
    renderTh({ sortable: true, sortState: 'desc' });
    const th = container.querySelector('th')!;
    expect(th.getAttribute('aria-sort')).toBe('descending');
    expect(th.querySelectorAll('svg path').length).toBe(1);
  });

  it('click dispara onSort', () => {
    const onSort = vi.fn();
    renderTh({ sortable: true, sortState: null, onSort });
    const th = container.querySelector('th')!;
    act(() => {
      th.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSort).toHaveBeenCalledTimes(1);
  });

  it('Enter no header dispara onSort', () => {
    const onSort = vi.fn();
    renderTh({ sortable: true, sortState: null, onSort });
    const th = container.querySelector('th')!;
    act(() => {
      th.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });
    expect(onSort).toHaveBeenCalledTimes(1);
  });

  it('Space no header dispara onSort (e previne scroll padrão)', () => {
    const onSort = vi.fn();
    renderTh({ sortable: true, sortState: null, onSort });
    const th = container.querySelector('th')!;
    const evt = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      th.dispatchEvent(evt);
    });
    expect(onSort).toHaveBeenCalledTimes(1);
    expect(evt.defaultPrevented).toBe(true);
  });

  it('outras teclas NÃO disparam onSort', () => {
    const onSort = vi.fn();
    renderTh({ sortable: true, sortState: null, onSort });
    const th = container.querySelector('th')!;
    act(() => {
      th.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
      );
    });
    expect(onSort).not.toHaveBeenCalled();
  });
});
