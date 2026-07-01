import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  FileDropzone,
  computeSha256Hex,
  mimeMatchesAccept,
  formatBytes,
} from '@/components/ui/file-dropzone';

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

function flush() {
  return act(async () => {
    await Promise.resolve();
  });
}

describe('mimeMatchesAccept (P-19)', () => {
  it('aceita qualquer arquivo quando accept vazio ou undefined', () => {
    const file = new File(['x'], 'x.bin', { type: 'application/octet-stream' });
    expect(mimeMatchesAccept(file, undefined)).toBe(true);
    expect(mimeMatchesAccept(file, '')).toBe(true);
  });

  it('casa por extensão (.pdf)', () => {
    const pdf = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    const png = new File(['x'], 'img.png', { type: 'image/png' });
    expect(mimeMatchesAccept(pdf, '.pdf,.docx')).toBe(true);
    expect(mimeMatchesAccept(png, '.pdf,.docx')).toBe(false);
  });

  it('casa por wildcard (image/*)', () => {
    const jpg = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const pdf = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    expect(mimeMatchesAccept(jpg, 'image/*')).toBe(true);
    expect(mimeMatchesAccept(pdf, 'image/*')).toBe(false);
  });

  it('casa por mime exato', () => {
    const pdf = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    expect(mimeMatchesAccept(pdf, 'application/pdf')).toBe(true);
    expect(mimeMatchesAccept(pdf, 'application/msword')).toBe(false);
  });
});

describe('computeSha256Hex (P-19)', () => {
  it('produz 64 hex chars pra bytes conhecidos', async () => {
    const bytes = new TextEncoder().encode('hello world');
    const hex = await computeSha256Hex(bytes.buffer);
    // SHA-256("hello world") =
    // b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
    expect(hex).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
    expect(hex).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('formatBytes (P-19)', () => {
  it('formata bytes/KB/MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1_500_000)).toBe('1.4 MB');
  });
});

describe('FileDropzone (P-19)', () => {
  it('renderiza hint e é focável via Tab', async () => {
    await act(async () => {
      root.render(
        <FileDropzone
          onFileSelected={() => {}}
          accept=".pdf"
          hint="PDF até 20 MB"
        />,
      );
    });
    await flush();

    expect(container.textContent).toContain('Clique ou arraste um arquivo aqui');
    expect(container.textContent).toContain('PDF até 20 MB');

    const zone = container.querySelector<HTMLDivElement>('[role="button"]')!;
    expect(zone).toBeTruthy();
    expect(zone.getAttribute('tabindex')).toBe('0');
    expect(zone.getAttribute('aria-label')).toBe('Selecionar arquivo');
  });

  it('seleção via change do input chama onFileSelected com metadata + sha256', async () => {
    const onFileSelected = vi.fn();
    await act(async () => {
      root.render(
        <FileDropzone
          onFileSelected={onFileSelected}
          accept=".pdf,application/pdf"
        />,
      );
    });
    await flush();

    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="file-dropzone-input"]',
    )!;
    const file = new File(['hello world'], 'doc.pdf', {
      type: 'application/pdf',
    });

    await act(async () => {
      Object.defineProperty(input, 'files', {
        value: [file],
        configurable: true,
      });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      // wait for arrayBuffer + digest inside act to silence warning
      await new Promise((r) => setTimeout(r, 30));
    });
    await flush();

    expect(onFileSelected).toHaveBeenCalledTimes(1);
    const arg = onFileSelected.mock.calls[0]![0];
    expect(arg.filename).toBe('doc.pdf');
    expect(arg.mimeType).toBe('application/pdf');
    expect(arg.sizeBytes).toBe(11); // 'hello world'
    expect(arg.sha256).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });

  it('arquivo com mime inválido → mensagem inline, não chama callback', async () => {
    const onFileSelected = vi.fn();
    await act(async () => {
      root.render(
        <FileDropzone onFileSelected={onFileSelected} accept=".pdf" />,
      );
    });
    await flush();

    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="file-dropzone-input"]',
    )!;
    const badFile = new File(['x'], 'photo.png', { type: 'image/png' });

    await act(async () => {
      Object.defineProperty(input, 'files', {
        value: [badFile],
        configurable: true,
      });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();

    expect(onFileSelected).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Formato não suportado');
  });

  it('arquivo maior que maxSizeBytes → mensagem inline', async () => {
    const onFileSelected = vi.fn();
    await act(async () => {
      root.render(
        <FileDropzone
          onFileSelected={onFileSelected}
          maxSizeBytes={5}
          accept=".pdf"
        />,
      );
    });
    await flush();

    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="file-dropzone-input"]',
    )!;
    const big = new File(['1234567890'], 'big.pdf', {
      type: 'application/pdf',
    });

    await act(async () => {
      Object.defineProperty(input, 'files', {
        value: [big],
        configurable: true,
      });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();

    expect(onFileSelected).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Arquivo muito grande');
  });

  it('click no container dispara input.click()', async () => {
    await act(async () => {
      root.render(<FileDropzone onFileSelected={() => {}} accept=".pdf" />);
    });
    await flush();

    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="file-dropzone-input"]',
    )!;
    const spy = vi.spyOn(input, 'click');

    const zone = container.querySelector<HTMLDivElement>('[role="button"]')!;
    zone.click();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('Enter no container dispara input.click() (a11y)', async () => {
    await act(async () => {
      root.render(<FileDropzone onFileSelected={() => {}} accept=".pdf" />);
    });
    await flush();

    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="file-dropzone-input"]',
    )!;
    const spy = vi.spyOn(input, 'click');

    const zone = container.querySelector<HTMLDivElement>('[role="button"]')!;
    zone.focus();
    zone.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('disabled bloqueia click, drop e tab focus', async () => {
    const onFileSelected = vi.fn();
    await act(async () => {
      root.render(
        <FileDropzone
          onFileSelected={onFileSelected}
          disabled
          accept=".pdf"
        />,
      );
    });
    await flush();

    const zone = container.querySelector<HTMLDivElement>('[role="button"]')!;
    expect(zone.getAttribute('tabindex')).toBe('-1');
    expect(zone.getAttribute('aria-disabled')).toBe('true');

    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="file-dropzone-input"]',
    )!;
    const spy = vi.spyOn(input, 'click');
    zone.click();
    expect(spy).not.toHaveBeenCalled();
  });
});
