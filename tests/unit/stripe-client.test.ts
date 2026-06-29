import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/env', () => ({
  env: {
    STRIPE_SECRET_KEY: undefined,
    STRIPE_PRICE_STARTER: 'price_starter_123',
    STRIPE_PRICE_PRO: 'price_pro_456',
    STRIPE_PRICE_ENTERPRISE: 'price_ent_789',
  },
}));

import { priceIdForPlan, planFromPriceId, stripeEnabled } from '@/lib/billing/stripe-client';

describe('stripe client helpers', () => {
  beforeEach(() => undefined);

  it('priceIdForPlan retorna ID configurado', () => {
    expect(priceIdForPlan('STARTER')).toBe('price_starter_123');
    expect(priceIdForPlan('PRO')).toBe('price_pro_456');
    expect(priceIdForPlan('ENTERPRISE')).toBe('price_ent_789');
  });

  it('planFromPriceId mapeia inverso', () => {
    expect(planFromPriceId('price_starter_123')).toBe('STARTER');
    expect(planFromPriceId('price_pro_456')).toBe('PRO');
    expect(planFromPriceId('price_ent_789')).toBe('ENTERPRISE');
  });

  it('planFromPriceId desconhecido retorna null', () => {
    expect(planFromPriceId('price_random_xyz')).toBe(null);
  });

  it('stripeEnabled segue STRIPE_SECRET_KEY', () => {
    expect(stripeEnabled()).toBe(false);
  });
});
