import { describe, it, expect } from 'vitest';
import { suggestContrastFix } from '@/server/services/contrast-suggester.service';
import { computeContrast } from '@/server/services/wcag-validator.service';

describe('suggestContrastFix', () => {
  it('amarelo dourado: sugere versão mais escura que passa', () => {
    const r = suggestContrastFix('#FFD700', 4.5);
    expect(r.darker).not.toBeNull();
    if (r.darker) {
      expect(computeContrast(r.darker, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('preto: nada a sugerir para mais escuro, mas pode ter clara', () => {
    const r = suggestContrastFix('#000000', 4.5);
    // Preto já passa contra branco — sugestão de escurecer é null
    expect(r.darker).toBeNull();
    // Preto também passa contra texto principal — sugestão clara também null
    expect(r.lighter).toBeNull();
  });

  it('Venzo violeta tem sugestões viáveis quando elevamos ratio', () => {
    // Cor já passa contra branco em 4.5:1; pedimos 7:1 (AAA)
    const r = suggestContrastFix('#7C3AED', 7);
    // Deve achar pelo menos uma versão viável
    expect(r.unsupported).toBe(false);
  });

  it('inválido marca unsupported', () => {
    const r = suggestContrastFix('not-hex', 4.5);
    expect(r.unsupported).toBe(true);
    expect(r.darker).toBeNull();
    expect(r.lighter).toBeNull();
  });

  it('preserva formato HEX maiúsculo', () => {
    const r = suggestContrastFix('#ffd700', 4.5);
    if (r.darker) expect(r.darker).toMatch(/^#[0-9A-F]{6}$/);
    if (r.lighter) expect(r.lighter).toMatch(/^#[0-9A-F]{6}$/);
  });
});
