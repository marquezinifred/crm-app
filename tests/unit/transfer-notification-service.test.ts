// @vitest-environment node
//
// Sprint 15G.5 Fase 2 — P-99: cobertura dedicada do
// `transfer-notification.service.ts`.
//
// O router (`opportunity-transfers-router.test.ts`) MOCKA este service, então
// a orquestração real (resolver destinatários, dedup, escolha de template,
// carga de usuários, best-effort) nunca era exercitada — 0% de cobertura.
//
// Aqui exercitamos `notifyTransferEvent` DE VERDADE. Mockamos só as bordas de
// I/O — `prisma.user.findMany`, `sendPushToUser`, `sendEmail`, `runAsSystem`,
// `env` — e usamos os TEMPLATES REAIS de `@/lib/email/templates` (módulo puro,
// sem imports), pra que o caso de PII no push (P-31) valide o payload real
// entregue ao usuário.
//
// Cobre (spec §9.1):
//   1. Destinatários por evento (REQUESTED/APPROVED±newOwner/REJECTED/
//      CANCELLED/TIMED_OUT)
//   2. Dedup por userId (primeiro papel vence)
//   3. pickTemplate: evento × papel → template certo
//   4. Best-effort T5 (push/e-mail/findMany falham → NUNCA propaga)
//   5. Filtro tenant + active no findMany (T6)
//   6. PII: push não carrega reason/decisionReason (só e-mail)

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??=
  'pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { findManyMock, pushMock, emailMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  pushMock: vi.fn(),
  emailMock: vi.fn(),
}));

vi.mock('@/server/db/client', () => ({
  prisma: { user: { findMany: findManyMock } },
}));
vi.mock('@/server/db/tenant-context', () => ({
  runAsSystem: <T,>(fn: () => Promise<T>) => fn(),
}));
vi.mock('@/server/services/push-sender.service', () => ({
  sendPushToUser: pushMock,
}));
vi.mock('@/server/services/email-sender.service', () => ({
  sendEmail: emailMock,
}));
vi.mock('@/lib/env', () => ({
  env: { NEXT_PUBLIC_APP_URL: 'https://app.venzo.test' },
}));

import {
  notifyTransferEvent,
  type TransferEvent,
  type TransferNotificationContext,
} from '@/server/services/transfer-notification.service';
import type { TransferPushPayload } from '@/lib/email/templates';

type UserRow = { id: string; email: string; fullName: string | null };

const BASE_USERS: readonly UserRow[] = [
  { id: 'u-requester', email: 'ana@t.com', fullName: 'Ana Diretora' },
  { id: 'u-owner', email: 'bruno@t.com', fullName: 'Bruno Dono' },
  { id: 'u-manager', email: 'carla@t.com', fullName: 'Carla Gestora' },
  { id: 'u-newowner', email: 'diego@t.com', fullName: 'Diego Novo' },
];

const SECRET_REASON = 'MOTIVO_DISPARADOR_CONFIDENCIAL';
const SECRET_DECISION = 'MOTIVO_DECISOR_CONFIDENCIAL';

let activeUsers: Map<string, UserRow>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  activeUsers = new Map(BASE_USERS.map((u) => [u.id, u]));
  // Respeita o filtro `id.in` (o que o service pede); ignora tenant/active no
  // retorno — o `where` completo é asserido à parte no caso T6.
  findManyMock.mockImplementation(
    async (args: { where: { id: { in: string[] } } }) => {
      return args.where.id.in
        .map((id) => activeUsers.get(id))
        .filter((u): u is UserRow => u !== undefined);
    },
  );
  pushMock.mockResolvedValue({ sent: 1, failed: 0 });
  emailMock.mockResolvedValue({ ok: true, providerId: 'p1' });
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

function makeCtx(
  overrides: Partial<TransferNotificationContext> = {},
): TransferNotificationContext {
  return {
    tenantId: 'tenant-A',
    transferId: 'tr-1',
    opportunityId: 'opp-1',
    opportunityTitle: 'Contrato Acme',
    companyName: 'Acme Ltda',
    requestedById: 'u-requester',
    originalOwnerId: 'u-owner',
    targetManagerId: 'u-manager',
    newOwnerId: 'u-newowner',
    reason: SECRET_REASON,
    decisionReason: SECRET_DECISION,
    ...overrides,
  };
}

function pushCalls(): Array<[string, TransferPushPayload]> {
  return pushMock.mock.calls.map((c) => [c[0] as string, c[1] as TransferPushPayload]);
}
function pushRecipientIds(): string[] {
  return pushMock.mock.calls.map((c) => c[0] as string);
}
function emailRecipients(): string[] {
  return emailMock.mock.calls.map((c) => (c[0] as { to: string }).to);
}
function pushFor(userId: string): TransferPushPayload | undefined {
  const call = pushMock.mock.calls.find((c) => c[0] === userId);
  return call ? (call[1] as TransferPushPayload) : undefined;
}
function emailFor(
  to: string,
): { to: string; subject: string; html: string } | undefined {
  const call = emailMock.mock.calls.find((c) => (c[0] as { to: string }).to === to);
  return call ? (call[0] as { to: string; subject: string; html: string }) : undefined;
}

describe('transfer-notification.service — notifyTransferEvent (P-99)', () => {
  describe('destinatários por evento', () => {
    it('REQUESTED → notifica destinatário (gestor) + dono original', async () => {
      await notifyTransferEvent('REQUESTED', makeCtx({ newOwnerId: null }));
      expect([...pushRecipientIds()].sort()).toEqual(['u-manager', 'u-owner']);
      expect([...emailRecipients()].sort()).toEqual(['bruno@t.com', 'carla@t.com']);
    });

    it('APPROVED (com novo owner) → notifica disparador + novo owner + dono original', async () => {
      await notifyTransferEvent('APPROVED', makeCtx());
      expect([...pushRecipientIds()].sort()).toEqual([
        'u-newowner',
        'u-owner',
        'u-requester',
      ]);
      expect(pushRecipientIds()).toHaveLength(3);
    });

    it('APPROVED (sem novo owner) → notifica disparador + dono original apenas', async () => {
      await notifyTransferEvent('APPROVED', makeCtx({ newOwnerId: null }));
      expect([...pushRecipientIds()].sort()).toEqual(['u-owner', 'u-requester']);
      expect(pushFor('u-newowner')).toBeUndefined();
    });

    it('REJECTED → notifica disparador + dono original com template de recusa', async () => {
      await notifyTransferEvent('REJECTED', makeCtx({ newOwnerId: null }));
      expect([...pushRecipientIds()].sort()).toEqual(['u-owner', 'u-requester']);
      expect(pushFor('u-requester')?.title).toBe('Transferência recusada');
    });

    it('CANCELLED → notifica disparador + dono original; label sem empresa quando companyName ausente', async () => {
      await notifyTransferEvent(
        'CANCELLED',
        makeCtx({ newOwnerId: null, companyName: null }),
      );
      expect([...pushRecipientIds()].sort()).toEqual(['u-owner', 'u-requester']);
      const p = pushFor('u-owner');
      expect(p?.title).toBe('Transferência cancelada');
      expect(p?.body).toBe('Contrato Acme'); // sem "(Acme Ltda)"
    });

    it('TIMED_OUT → notifica disparador + dono original com template de expiração', async () => {
      await notifyTransferEvent('TIMED_OUT', makeCtx({ newOwnerId: null }));
      expect([...pushRecipientIds()].sort()).toEqual(['u-owner', 'u-requester']);
      expect(pushFor('u-owner')?.title).toBe('Transferência expirada');
    });
  });

  describe('dedup por userId (primeiro papel vence)', () => {
    it('mesmo usuário como gestor destino e dono original recebe 1 notificação (papel gestor vence)', async () => {
      await notifyTransferEvent(
        'REQUESTED',
        makeCtx({
          newOwnerId: null,
          targetManagerId: 'u-manager',
          originalOwnerId: 'u-manager',
        }),
      );
      expect(pushRecipientIds()).toEqual(['u-manager']);
      expect(emailRecipients()).toEqual(['carla@t.com']);
      // primeiro papel resolvido (targetManager) → template do gestor
      expect(pushFor('u-manager')?.title).toBe('Nova transferência para análise');
    });

    it('disparador que também é dono original recebe 1 notificação (papel disparador vence)', async () => {
      await notifyTransferEvent(
        'APPROVED',
        makeCtx({ requestedById: 'u-requester', originalOwnerId: 'u-requester' }),
      );
      expect([...pushRecipientIds()].sort()).toEqual(['u-newowner', 'u-requester']);
      expect(pushRecipientIds()).toHaveLength(2);
      expect(pushFor('u-requester')?.title).toBe('Transferência aprovada');
    });
  });

  describe('pickTemplate: evento × papel → template', () => {
    it('REQUESTED usa template de gestor para o destinatário e de dono para o dono original', async () => {
      await notifyTransferEvent('REQUESTED', makeCtx({ newOwnerId: null }));

      expect(pushFor('u-manager')?.title).toBe('Nova transferência para análise');
      expect(emailFor('carla@t.com')?.subject).toContain(
        'Transferência recebida para análise',
      );
      // url do gestor aponta pra fila (inboxUrl) — cobre env + inboxUrl()
      expect(pushFor('u-manager')?.url).toBe(
        'https://app.venzo.test/inbox/transferencias-recebidas',
      );

      expect(pushFor('u-owner')?.title).toBe('Oportunidade em transferência');
      expect(emailFor('bruno@t.com')?.subject).toContain(
        'Sua oportunidade está em transferência',
      );
      // url do dono aponta pra opp (opportunityUrl) — cobre env + opportunityUrl()
      expect(pushFor('u-owner')?.url).toBe('https://app.venzo.test/pipeline/opp-1');
    });

    it('APPROVED usa template de novo owner para o novo dono e template padrão para disparador/dono', async () => {
      await notifyTransferEvent('APPROVED', makeCtx());

      expect(pushFor('u-newowner')?.title).toBe('Você recebeu uma oportunidade');
      expect(emailFor('diego@t.com')?.subject).toContain(
        'Você recebeu uma oportunidade',
      );

      expect(pushFor('u-requester')?.title).toBe('Transferência aprovada');
      expect(pushFor('u-owner')?.title).toBe('Transferência aprovada');
    });
  });

  describe('best-effort T5 (nunca propaga rejection)', () => {
    it('falha no push NÃO propaga — resolve mesmo assim e o e-mail ainda é tentado', async () => {
      pushMock.mockRejectedValue(new Error('push boom'));
      await expect(
        notifyTransferEvent('REQUESTED', makeCtx({ newOwnerId: null })),
      ).resolves.toBeUndefined();
      expect(emailMock).toHaveBeenCalledTimes(2); // gestor + dono
      expect(warnSpy).toHaveBeenCalled();
    });

    it('falha no e-mail NÃO propaga — resolve e o push ainda é tentado', async () => {
      emailMock.mockRejectedValue(new Error('email boom'));
      await expect(
        notifyTransferEvent('REJECTED', makeCtx({ newOwnerId: null })),
      ).resolves.toBeUndefined();
      expect(pushMock).toHaveBeenCalledTimes(2);
    });

    it('falha ao carregar usuários NÃO propaga — resolve sem disparar push/e-mail', async () => {
      findManyMock.mockRejectedValue(new Error('db down'));
      await expect(
        notifyTransferEvent('APPROVED', makeCtx()),
      ).resolves.toBeUndefined();
      expect(pushMock).not.toHaveBeenCalled();
      expect(emailMock).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('falha isolada em 1 destinatário não impede os demais', async () => {
      pushMock.mockImplementation(async (userId: string) => {
        if (userId === 'u-manager') throw new Error('push boom');
        return { sent: 1, failed: 0 };
      });
      emailMock.mockImplementation(async (input: { to: string }) => {
        if (input.to === 'carla@t.com') throw new Error('email boom');
        return { ok: true, providerId: 'p' };
      });
      await expect(
        notifyTransferEvent('REQUESTED', makeCtx({ newOwnerId: null })),
      ).resolves.toBeUndefined();
      // dono original ainda recebe push + e-mail
      expect(pushRecipientIds()).toContain('u-owner');
      expect(emailRecipients()).toContain('bruno@t.com');
      // gestor foi tentado nos dois canais (mesmo tendo falhado)
      expect(pushRecipientIds()).toContain('u-manager');
      expect(emailRecipients()).toContain('carla@t.com');
    });
  });

  describe('filtro tenant + active (T6)', () => {
    it('carrega usuários filtrando tenantId + deletedAt null + active true', async () => {
      await notifyTransferEvent('REQUESTED', makeCtx({ newOwnerId: null }));
      expect(findManyMock).toHaveBeenCalledTimes(1);
      const where = (
        findManyMock.mock.calls[0]![0] as {
          where: {
            id: { in: string[] };
            tenantId: string;
            deletedAt: null;
            active: boolean;
          };
        }
      ).where;
      expect(where.tenantId).toBe('tenant-A');
      expect(where.deletedAt).toBeNull();
      expect(where.active).toBe(true);
      expect(where.id.in).toEqual(
        expect.arrayContaining(['u-manager', 'u-owner', 'u-requester']),
      );
      // newOwnerId null → não entra na carga
      expect(where.id.in).not.toContain('u-newowner');
    });

    it('destinatário inativo/de outro tenant (ausente do findMany) é ignorado silenciosamente', async () => {
      activeUsers.delete('u-owner'); // dono original inativo
      await notifyTransferEvent('REQUESTED', makeCtx({ newOwnerId: null }));
      expect(pushRecipientIds()).toEqual(['u-manager']);
      expect(emailRecipients()).toEqual(['carla@t.com']);
      expect(pushFor('u-owner')).toBeUndefined();
    });
  });

  describe('PII: motivo só no e-mail, nunca no push (P-31)', () => {
    it('REQUESTED: motivo do disparador vai só no e-mail; push não carrega reason', async () => {
      await notifyTransferEvent('REQUESTED', makeCtx({ newOwnerId: null }));
      // controle positivo: e-mail do gestor contém o motivo
      expect(emailFor('carla@t.com')?.html).toContain(SECRET_REASON);
      // nenhum push carrega o motivo (nem valor, nem chave)
      for (const [, payload] of pushCalls()) {
        expect(JSON.stringify(payload)).not.toContain(SECRET_REASON);
        expect(payload).not.toHaveProperty('reason');
        expect(payload).not.toHaveProperty('decisionReason');
      }
    });

    it('APPROVED: justificativa do decisor vai só no e-mail; push não carrega decisionReason', async () => {
      await notifyTransferEvent('APPROVED', makeCtx());
      expect(emailFor('ana@t.com')?.html).toContain(SECRET_DECISION);
      for (const [, payload] of pushCalls()) {
        expect(JSON.stringify(payload)).not.toContain(SECRET_DECISION);
      }
    });
  });

  describe('guarda', () => {
    it('evento desconhecido é no-op (sem carregar usuários, sem push/e-mail) e não lança', async () => {
      await expect(
        notifyTransferEvent('BOGUS' as unknown as TransferEvent, makeCtx()),
      ).resolves.toBeUndefined();
      expect(findManyMock).not.toHaveBeenCalled();
      expect(pushMock).not.toHaveBeenCalled();
      expect(emailMock).not.toHaveBeenCalled();
    });
  });
});
