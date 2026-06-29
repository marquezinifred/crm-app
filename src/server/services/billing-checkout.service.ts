import { getStripe, priceIdForPlan } from '@/lib/billing/stripe-client';
import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { env } from '@/lib/env';
import type { TenantPlan } from '@prisma/client';

interface StartCheckoutInput {
  tenantId: string;
  customerEmail: string;
  plan: Exclude<TenantPlan, 'TRIAL'>;
  successPath?: string;
  cancelPath?: string;
}

/** Cria/recupera Stripe Customer atrelado ao tenant. */
async function ensureCustomer(tenantId: string, email: string): Promise<string> {
  const tenant = await runAsSystem(() =>
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { stripeCustomerId: true, name: true },
    }),
  );
  if (!tenant) throw new Error('Tenant não encontrado');
  if (tenant.stripeCustomerId) return tenant.stripeCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email,
    name: tenant.name,
    metadata: { tenantId },
  });
  await runAsSystem(() =>
    prisma.tenant.update({
      where: { id: tenantId },
      data: { stripeCustomerId: customer.id },
    }),
  );
  return customer.id;
}

export async function startCheckoutSession(input: StartCheckoutInput): Promise<string> {
  const priceId = priceIdForPlan(input.plan);
  if (!priceId) {
    throw new Error(`Price ID para plano ${input.plan} não configurado`);
  }
  const customerId = await ensureCustomer(input.tenantId, input.customerEmail);
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${env.NEXT_PUBLIC_APP_URL}${input.successPath ?? '/admin/billing?success=1'}`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}${input.cancelPath ?? '/admin/billing?canceled=1'}`,
    allow_promotion_codes: true,
    metadata: { tenantId: input.tenantId, plan: input.plan },
    subscription_data: { metadata: { tenantId: input.tenantId } },
  });
  if (!session.url) throw new Error('Stripe não retornou URL de checkout');
  return session.url;
}

export async function openCustomerPortal(input: {
  tenantId: string;
  returnPath?: string;
}): Promise<string> {
  const tenant = await runAsSystem(() =>
    prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { stripeCustomerId: true },
    }),
  );
  if (!tenant?.stripeCustomerId) {
    throw new Error('Tenant sem assinatura ativa — execute o Checkout primeiro');
  }
  const stripe = getStripe();
  const portal = await stripe.billingPortal.sessions.create({
    customer: tenant.stripeCustomerId,
    return_url: `${env.NEXT_PUBLIC_APP_URL}${input.returnPath ?? '/admin/billing'}`,
  });
  return portal.url;
}
