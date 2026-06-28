import webpush from 'web-push';
import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import { env } from '@/lib/env';

let configured = false;
function configure(): boolean {
  if (configured) return true;
  if (!env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export async function isEnabled(): Promise<boolean> {
  return !!env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && !!env.VAPID_PRIVATE_KEY;
}

/**
 * Envia push para todas as subscriptions ativas de um usuário.
 * Expira (410 Gone) → marca deletedAt na subscription.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  if (!configure()) return { sent: 0, failed: 0 };
  return runAsSystem(async () => {
    const subs = await prisma.pushSubscription.findMany({
      where: { userId, deletedAt: null },
    });
    if (subs.length === 0) return { sent: 0, failed: 0 };

    let sent = 0;
    let failed = 0;
    const serialized = JSON.stringify(payload);

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: s.endpoint,
              keys: { p256dh: s.p256dhKey, auth: s.authKey },
            },
            serialized,
            { TTL: 60 * 60 },
          );
          sent += 1;
        } catch (err) {
          failed += 1;
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await prisma.pushSubscription.update({
              where: { id: s.id },
              data: { deletedAt: new Date() },
            });
          } else {
            console.error('[push-sender] falha', err);
          }
        }
      }),
    );
    return { sent, failed };
  });
}

/**
 * Envia push para o destinatário de um AlertLog (resolve user pelo e-mail).
 * Chamado pelo email-send.worker.ts em paralelo ao envio do e-mail.
 */
export async function sendPushForAlertRecipient(
  recipientEmail: string,
  payload: PushPayload,
): Promise<void> {
  if (!(await isEnabled())) return;
  const user = await runAsSystem(() =>
    prisma.user.findFirst({
      where: { email: recipientEmail, active: true, deletedAt: null },
      select: { id: true },
    }),
  );
  if (!user) return;
  await sendPushToUser(user.id, payload);
}
