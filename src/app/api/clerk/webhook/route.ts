import { NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { env } from '@/lib/env';
import {
  syncUserFromClerk,
  deactivateUserFromClerk,
  type ClerkUserPayload,
} from '@/server/services/clerk-sync.service';
import { recordUserAccess } from '@/server/services/access-log.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface WebhookEvent {
  type: string;
  data: unknown;
}

export async function POST(req: NextRequest) {
  if (!env.CLERK_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: 'CLERK_WEBHOOK_SECRET não configurado' },
      { status: 500 },
    );
  }

  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'headers svix ausentes' }, { status: 400 });
  }

  const body = await req.text();
  let evt: WebhookEvent;
  try {
    const wh = new Webhook(env.CLERK_WEBHOOK_SECRET);
    evt = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as WebhookEvent;
  } catch (err) {
    console.error('[clerk-webhook] verify falhou', err);
    return NextResponse.json({ error: 'assinatura inválida' }, { status: 401 });
  }

  try {
    switch (evt.type) {
      case 'user.created':
      case 'user.updated':
        await syncUserFromClerk(evt.data as ClerkUserPayload);
        break;
      case 'user.deleted': {
        const data = evt.data as { id?: string; deleted?: boolean };
        if (data.id) await deactivateUserFromClerk(data.id);
        break;
      }
      case 'session.created': {
        const data = evt.data as {
          user_id?: string;
          client_id?: string;
          last_active_at?: number;
        };
        if (data.user_id) {
          const ip =
            req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
            req.headers.get('x-real-ip') ??
            null;
          const ua = req.headers.get('user-agent');
          await recordUserAccess({
            clerkUserId: data.user_id,
            ip,
            userAgent: ua,
            authMethod: null,
          });
        }
        break;
      }
      default:
        console.info(`[clerk-webhook] evento ignorado: ${evt.type}`);
    }
  } catch (err) {
    console.error('[clerk-webhook] erro processando evento', evt.type, err);
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
