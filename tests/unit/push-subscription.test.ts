import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Replica o schema de validação do router (não exporta para evitar circular)
const subscriptionInput = z.object({
  endpoint: z.string().url().max(500),
  p256dh: z.string().min(10).max(500),
  auth: z.string().min(10).max(200),
  userAgent: z.string().max(500).optional(),
});

describe('push subscribe validation', () => {
  const valid = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abcdef123',
    p256dh: 'BNc0123456789xxxxxxxxxx',
    auth: 'auth12345abc',
    userAgent: 'Mozilla/5.0',
  };

  it('aceita payload válido', () => {
    expect(subscriptionInput.safeParse(valid).success).toBe(true);
  });

  it('rejeita endpoint não URL', () => {
    expect(subscriptionInput.safeParse({ ...valid, endpoint: 'not-url' }).success).toBe(false);
  });

  it('rejeita p256dh muito curto', () => {
    expect(subscriptionInput.safeParse({ ...valid, p256dh: 'abc' }).success).toBe(false);
  });

  it('rejeita auth muito curto', () => {
    expect(subscriptionInput.safeParse({ ...valid, auth: 'xx' }).success).toBe(false);
  });

  it('userAgent é opcional', () => {
    const { userAgent: _ignored, ...rest } = valid;
    void _ignored;
    expect(subscriptionInput.safeParse(rest).success).toBe(true);
  });
});
