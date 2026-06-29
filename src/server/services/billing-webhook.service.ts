import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { audit } from '@/server/services/audit.service';
import { planFromPriceId } from '@/lib/billing/stripe-client';
import type Stripe from 'stripe';
import {
  BillingEventType,
  SubscriptionStatus,
  TenantPlan,
  Prisma,
} from '@prisma/client';

/**
 * Processa um Stripe.Event. Idempotente: se já existir `BillingEvent`
 * com o mesmo `stripeEventId`, retorna sem reprocessar.
 *
 * Mapeia status Stripe → SubscriptionStatus + atualiza Tenant.plan
 * quando aplicável.
 */

function mapStatus(s: Stripe.Subscription.Status): SubscriptionStatus {
  switch (s) {
    case 'trialing':
      return SubscriptionStatus.TRIALING;
    case 'active':
      return SubscriptionStatus.ACTIVE;
    case 'past_due':
    case 'unpaid':
      return SubscriptionStatus.PAST_DUE;
    case 'canceled':
      return SubscriptionStatus.CANCELED;
    default:
      return SubscriptionStatus.INCOMPLETE;
  }
}

async function recordEvent(
  event: Stripe.Event,
  type: BillingEventType,
  tenantId: string | null,
  error?: string,
) {
  await runAsSystem(() =>
    prisma.billingEvent.create({
      data: {
        tenantId,
        type,
        stripeEventId: event.id,
        payload: event as unknown as Prisma.JsonObject,
        error: error ?? null,
      },
    }),
  );
}

async function alreadyProcessed(eventId: string): Promise<boolean> {
  const existing = await runAsSystem(() =>
    prisma.billingEvent.findUnique({
      where: { stripeEventId: eventId },
      select: { id: true },
    }),
  );
  return existing !== null;
}

function tenantIdFromMetadata(meta: Stripe.Metadata | null | undefined): string | null {
  if (!meta) return null;
  return typeof meta.tenantId === 'string' && meta.tenantId.length > 0
    ? meta.tenantId
    : null;
}

async function tenantFromCustomerId(customerId: string): Promise<string | null> {
  const t = await runAsSystem(() =>
    prisma.tenant.findUnique({
      where: { stripeCustomerId: customerId },
      select: { id: true },
    }),
  );
  return t?.id ?? null;
}

async function applySubscription(
  tenantId: string,
  sub: Stripe.Subscription,
): Promise<TenantPlan | null> {
  const priceId = sub.items.data[0]?.price?.id;
  const plan = priceId ? planFromPriceId(priceId) : null;
  await runAsSystem(() =>
    prisma.tenant.update({
      where: { id: tenantId },
      data: {
        stripeSubscriptionId: sub.id,
        subscriptionStatus: mapStatus(sub.status),
        currentPeriodEnd: new Date(sub.current_period_end * 1000),
        plan: plan ?? undefined,
        trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      },
    }),
  );
  await audit({
    action: 'billing.subscription.update',
    tableName: 'tenants',
    recordId: tenantId,
    after: { status: sub.status, plan, currentPeriodEnd: sub.current_period_end },
    tenantIdOverride: tenantId,
  });
  return plan;
}

export async function processStripeEvent(event: Stripe.Event): Promise<void> {
  if (await alreadyProcessed(event.id)) return;

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId =
          tenantIdFromMetadata(session.metadata) ??
          (typeof session.customer === 'string'
            ? await tenantFromCustomerId(session.customer)
            : null);
        if (!tenantId) throw new Error('tenantId não encontrado no checkout');
        if (
          typeof session.subscription === 'string' &&
          process.env.NODE_ENV !== 'test'
        ) {
          const { getStripe } = await import('@/lib/billing/stripe-client');
          const sub = await getStripe().subscriptions.retrieve(session.subscription);
          await applySubscription(tenantId, sub);
        }
        await recordEvent(event, BillingEventType.CHECKOUT_COMPLETED, tenantId);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId =
          tenantIdFromMetadata(sub.metadata) ??
          (typeof sub.customer === 'string'
            ? await tenantFromCustomerId(sub.customer)
            : null);
        if (!tenantId) throw new Error('tenantId não encontrado na subscription');
        await applySubscription(tenantId, sub);
        await recordEvent(
          event,
          event.type === 'customer.subscription.created'
            ? BillingEventType.SUBSCRIPTION_CREATED
            : BillingEventType.SUBSCRIPTION_UPDATED,
          tenantId,
        );
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId =
          tenantIdFromMetadata(sub.metadata) ??
          (typeof sub.customer === 'string'
            ? await tenantFromCustomerId(sub.customer)
            : null);
        if (!tenantId) throw new Error('tenantId não encontrado em deleted');
        await runAsSystem(() =>
          prisma.tenant.update({
            where: { id: tenantId },
            data: {
              subscriptionStatus: SubscriptionStatus.CANCELED,
              plan: TenantPlan.TRIAL,
              trialEndsAt: new Date(),
            },
          }),
        );
        await recordEvent(event, BillingEventType.SUBSCRIPTION_CANCELED, tenantId);
        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const inv = event.data.object as Stripe.Invoice;
        const tenantId =
          typeof inv.customer === 'string'
            ? await tenantFromCustomerId(inv.customer)
            : null;
        await recordEvent(event, BillingEventType.INVOICE_PAID, tenantId);
        break;
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        const tenantId =
          typeof inv.customer === 'string'
            ? await tenantFromCustomerId(inv.customer)
            : null;
        await recordEvent(event, BillingEventType.INVOICE_FAILED, tenantId);
        break;
      }

      case 'customer.subscription.trial_will_end': {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId =
          typeof sub.customer === 'string'
            ? await tenantFromCustomerId(sub.customer)
            : null;
        await recordEvent(event, BillingEventType.TRIAL_WILL_END, tenantId);
        break;
      }

      default:
        // Demais eventos: registramos para auditoria mas não fazemos nada.
        await recordEvent(event, BillingEventType.SUBSCRIPTION_UPDATED, null);
    }
  } catch (err) {
    await recordEvent(
      event,
      BillingEventType.SUBSCRIPTION_UPDATED,
      null,
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}
