import { Redis } from 'ioredis';
import { env } from '@/lib/env';

/**
 * Rate limiter sliding window — Sprint 11.
 *
 * Implementa o algoritmo INCR + EXPIRE: cada chamada incrementa um contador
 * cuja chave inclui a janela atual (timestamp arredondado). Quando excede
 * o limite, retorna { allowed: false }.
 *
 * Fallback quando Redis indisponível: sempre allowed (open). Em produção,
 * o WAF (Cloudflare) também aplica rate limit como segunda linha.
 */

let _redis: Redis | null = null;
function redis(): Redis | null {
  if (_redis) return _redis;
  try {
    _redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    _redis.on('error', () => undefined);
    return _redis;
  } catch {
    return null;
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/**
 * @param key Identificador único (ex: "login:ip:1.2.3.4")
 * @param limit Tentativas permitidas dentro da janela
 * @param windowSeconds Tamanho da janela
 */
export async function checkRate(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const resetAt = new Date((windowStart + windowSeconds) * 1000);
  const composedKey = `ratelimit:${key}:${windowStart}`;

  const r = redis();
  if (!r) {
    return { allowed: true, remaining: limit, resetAt };
  }

  try {
    await r.connect().catch(() => undefined);
    const count = await r.incr(composedKey);
    if (count === 1) {
      await r.expire(composedKey, windowSeconds + 5);
    }
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt,
    };
  } catch {
    return { allowed: true, remaining: limit, resetAt };
  }
}

/** Helpers comuns. */
export const LOGIN_LIMIT = { limit: 5, windowSeconds: 15 * 60 };
export const PUBLIC_FORM_LIMIT = { limit: 10, windowSeconds: 60 };
export const API_LIMIT_PER_TENANT = { limit: 1000, windowSeconds: 60 };

export function loginKey(ip: string): string {
  return `login:${ip}`;
}
export function publicFormKey(ip: string, form: string): string {
  return `pubform:${form}:${ip}`;
}
export function tenantApiKey(tenantId: string): string {
  return `tenantapi:${tenantId}`;
}
