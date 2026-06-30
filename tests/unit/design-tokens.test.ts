import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CSS = fs.readFileSync(
  path.resolve('src/app/globals.css'),
  'utf-8',
);
const TW = fs.readFileSync(
  path.resolve('tailwind.config.ts'),
  'utf-8',
);

describe('design tokens (P3) — canais HSL', () => {
  it('globals.css define canais brand-primary-h/s/l', () => {
    expect(CSS).toMatch(/--brand-primary-h:/);
    expect(CSS).toMatch(/--brand-primary-s:/);
    expect(CSS).toMatch(/--brand-primary-l:/);
  });

  it('globals.css tem variações dark e light de neutros', () => {
    expect(CSS).toMatch(/\[data-theme=['"]dark['"]\]/);
    expect(CSS).toMatch(/--bg-page-h:/);
    expect(CSS).toMatch(/--bg-card-h:/);
  });

  it('globals.css define semânticas success/danger/warning/info', () => {
    for (const k of ['success', 'danger', 'warning', 'info']) {
      expect(CSS).toMatch(new RegExp(`--${k}-h:`));
      expect(CSS).toMatch(new RegExp(`--${k}-bg-h:`));
      expect(CSS).toMatch(new RegExp(`--${k}-text-h:`));
    }
  });

  it('globals.css inclui prefers-reduced-motion', () => {
    expect(CSS).toMatch(/prefers-reduced-motion: reduce/);
  });

  it('globals.css define skip-link', () => {
    expect(CSS).toMatch(/\.skip-link/);
  });

  it('tailwind.config consome canais HSL com alpha', () => {
    expect(TW).toMatch(/hsl\(var\(--/);
    expect(TW).toMatch(/<alpha-value>/);
  });

  it('tailwind.config define breakpoints md=768 / lg=1024 / xl=1280', () => {
    expect(TW).toMatch(/md: ['"]768px['"]/);
    expect(TW).toMatch(/lg: ['"]1024px['"]/);
    expect(TW).toMatch(/xl: ['"]1280px['"]/);
  });

  it('tailwind.config tem darkMode via data-theme', () => {
    expect(TW).toMatch(/\[data-theme="dark"\]/);
  });

  it('tailwind.config expõe escala tipográfica Venzo', () => {
    for (const t of ['display', 'h1', 'h2', 'h3', 'body-lg', 'body', 'caption', 'label', 'mono']) {
      expect(TW).toContain(t);
    }
  });
});
