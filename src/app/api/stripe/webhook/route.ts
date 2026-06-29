import { NextRequest, NextResponse } from 'next/server';
import { getStripe, stripeEnabled } from '@/lib/billing/stripe-client';
import { processStripeEvent } from '@/server/services/billing-webhook.service';
import { env } from '@/lib/env';
import type Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!stripeEnabled() || !env.STRIPE_WEBHOOK_SECRET) {
    return new NextResponse('Stripe não configurado', { status: 503 });
  }
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new NextResponse('Sem assinatura', { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    return new NextResponse(
      `Assinatura inválida: ${err instanceof Error ? err.message : 'erro'}`,
      { status: 400 },
    );
  }

  try {
    await processStripeEvent(event);
    return NextResponse.json({ received: true });
  } catch (err) {
    // Stripe reenviará — retornamos 500 só se falha não recuperável
    return new NextResponse(
      `Erro processando: ${err instanceof Error ? err.message : 'erro'}`,
      { status: 500 },
    );
  }
}
