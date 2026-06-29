import Stripe from 'stripe';
import { env } from '@/lib/env';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY não configurado');
  }
  _stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion,
    typescript: true,
  });
  return _stripe;
}

export function stripeEnabled(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

/** Mapeia TenantPlan → Price ID configurado no Stripe. */
export function priceIdForPlan(plan: 'STARTER' | 'PRO' | 'ENTERPRISE'): string | null {
  switch (plan) {
    case 'STARTER':
      return env.STRIPE_PRICE_STARTER ?? null;
    case 'PRO':
      return env.STRIPE_PRICE_PRO ?? null;
    case 'ENTERPRISE':
      return env.STRIPE_PRICE_ENTERPRISE ?? null;
  }
}

/** Resolve plano a partir de um price ID retornado pelo webhook. */
export function planFromPriceId(
  priceId: string,
): 'STARTER' | 'PRO' | 'ENTERPRISE' | null {
  if (priceId === env.STRIPE_PRICE_STARTER) return 'STARTER';
  if (priceId === env.STRIPE_PRICE_PRO) return 'PRO';
  if (priceId === env.STRIPE_PRICE_ENTERPRISE) return 'ENTERPRISE';
  return null;
}
