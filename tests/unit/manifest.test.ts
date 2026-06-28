import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('PWA manifest', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../public/manifest.json'), 'utf8'),
  );

  it('tem campos obrigatórios', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
  });

  it('lista pelo menos um ícone 192 e 512', () => {
    const sizes = manifest.icons.flatMap((i: { sizes: string }) => i.sizes.split(' '));
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('lang é pt-BR', () => {
    expect(manifest.lang).toBe('pt-BR');
  });

  it('theme/background colors são strings válidas', () => {
    expect(/^#[0-9a-f]{6}$/i.test(manifest.theme_color)).toBe(true);
    expect(/^#[0-9a-f]{6}$/i.test(manifest.background_color)).toBe(true);
  });
});
