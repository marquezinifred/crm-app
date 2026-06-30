import { describe, it, expect } from 'vitest';
import { costUsd, priceBrl, lookupPrice, usdToBrlWithMargin } from '@/lib/ai/pricing';

describe('AI pricing — Sprint 15B', () => {
  it('lookupPrice retorna entry conhecido', () => {
    const p = lookupPrice('anthropic', 'claude-haiku-4-5-20251001');
    expect(p.inputUsdPerM).toBeGreaterThan(0);
    expect(p.outputUsdPerM).toBeGreaterThan(0);
  });

  it('lookupPrice cai pro fallback se desconhecido', () => {
    const p = lookupPrice('anthropic', 'modelo-fantasma');
    expect(p.inputUsdPerM).toBe(0);
    expect(p.outputUsdPerM).toBe(0);
  });

  it('costUsd calcula proporcional a tokens', () => {
    const cheap = costUsd('anthropic', 'claude-haiku-4-5-20251001', 1_000_000, 0);
    expect(cheap).toBeCloseTo(0.8, 5);
    const expensive = costUsd('anthropic', 'claude-haiku-4-5-20251001', 1_000_000, 1_000_000);
    expect(expensive).toBeGreaterThan(cheap);
  });

  it('priceBrl aplica margem e câmbio sobre USD', () => {
    // 0.80 USD × 5.10 × 1.20 = 4.896 BRL
    const v = priceBrl('anthropic', 'claude-haiku-4-5-20251001', 1_000_000, 0);
    expect(v).toBeCloseTo(0.80 * 5.10 * 1.20, 4);
  });

  it('usdToBrlWithMargin é monotônico', () => {
    expect(usdToBrlWithMargin(1)).toBeGreaterThan(usdToBrlWithMargin(0.5));
    expect(usdToBrlWithMargin(0)).toBe(0);
  });
});
