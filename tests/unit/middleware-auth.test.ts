import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Garantia de contrato — fix do bug "Unexpected token '<', '<!DOCTYPE'":
 *
 * Chamadas para `/api/trpc/*`, `/api/v1/*` ou `/api/platform/*` sem sessão
 * Clerk JAMAIS podem receber HTTP 307/308 redirect para `/sign-in` (que
 * devolve HTML). Devem sempre voltar 401 com JSON parseável.
 *
 * Importamos os helpers `isApiRequest` e `apiAuthError` diretamente,
 * isolando do `authMiddleware()` da Clerk (que precisa de Next.js runtime).
 */

vi.mock('@clerk/nextjs/server', () => ({
  authMiddleware: () => () => undefined,
}));

import { isApiRequest, apiAuthError, injectPlatformHeadersIfOwner } from '@/middleware';

function makeReq(path: string, method: 'GET' | 'POST' = 'POST'): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { method });
}

describe('middleware — fix POST /api/trpc/* sem auth retorna 401 JSON', () => {
  it('isApiRequest detecta /api/trpc/*', () => {
    expect(isApiRequest(makeReq('/api/trpc/opportunities.create'))).toBe(true);
    expect(isApiRequest(makeReq('/api/trpc/companies.list', 'GET'))).toBe(true);
  });

  it('isApiRequest detecta /api/v1/*', () => {
    expect(isApiRequest(makeReq('/api/v1/imports/upload'))).toBe(true);
    expect(isApiRequest(makeReq('/api/v1/privacy-request'))).toBe(true);
  });

  it('isApiRequest detecta /api/platform/*', () => {
    expect(isApiRequest(makeReq('/api/platform/audit/export'))).toBe(true);
  });

  it('isApiRequest é falso para rotas de UI', () => {
    expect(isApiRequest(makeReq('/pipeline/new'))).toBe(false);
    expect(isApiRequest(makeReq('/dashboard', 'GET'))).toBe(false);
    expect(isApiRequest(makeReq('/sign-in', 'GET'))).toBe(false);
  });

  it('apiAuthError(401) devolve content-type application/json', () => {
    const res = apiAuthError(401, 'Sessão expirada');
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('apiAuthError(401) tem corpo JSON parseável (não HTML)', async () => {
    const res = apiAuthError(401, 'Sessão expirada');
    const text = await res.text();
    // Pega o bug clássico: começa com `<` (HTML) seria ruim.
    expect(text.startsWith('<')).toBe(false);
    const parsed = JSON.parse(text);
    expect(parsed.error.code).toBe('UNAUTHORIZED');
    expect(parsed.error.message).toMatch(/sess/i);
  });

  it('apiAuthError(403) para acesso restrito', async () => {
    const res = apiAuthError(403, 'Acesso restrito a Platform Owners.');
    expect(res.status).toBe(403);
    const parsed = JSON.parse(await res.text());
    expect(parsed.error.code).toBe('FORBIDDEN');
  });

  it('respostas API preservam security headers (CSP, X-Frame-Options)', () => {
    const res = apiAuthError(401, 'x');
    expect(res.headers.get('content-security-policy')).toBeTruthy();
    expect(res.headers.get('x-frame-options')).toBeTruthy();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

/**
 * Fix P-11 (Sprint 15A residual) — dual identity: usuário com 2 rows
 * em `users` (admin de tenant + Platform Owner com mesmo clerk_id)
 * precisa receber os headers Platform EM PARALELO aos headers tenant.
 * Sem isso, `platformProcedure` no tRPC retorna FORBIDDEN ao acessar
 * /platform/dashboard mesmo com `platformRole` válido no JWT.
 */
describe('middleware — injectPlatformHeadersIfOwner (dual identity)', () => {
  it('injeta x-platform-* quando platformRole === PLATFORM_OWNER', () => {
    const headers = new Headers();
    injectPlatformHeadersIfOwner(headers, 'user_abc123', 'PLATFORM_OWNER');
    expect(headers.get('x-platform-user-clerk-id')).toBe('user_abc123');
    expect(headers.get('x-platform-role')).toBe('PLATFORM_OWNER');
  });

  it('é no-op quando platformRole é null (tenant pure)', () => {
    const headers = new Headers();
    injectPlatformHeadersIfOwner(headers, 'user_acme_admin', null);
    expect(headers.get('x-platform-user-clerk-id')).toBeNull();
    expect(headers.get('x-platform-role')).toBeNull();
  });

  it('é no-op quando platformRole é string inválida', () => {
    const headers = new Headers();
    injectPlatformHeadersIfOwner(headers, 'user_x', 'PLATFORM_SUPPORT');
    expect(headers.get('x-platform-user-clerk-id')).toBeNull();
    expect(headers.get('x-platform-role')).toBeNull();
  });

  it('coexiste com headers tenant existentes sem sobrescrever', () => {
    const headers = new Headers();
    headers.set('x-tenant-id', 'tenant_uuid');
    headers.set('x-user-clerk-id', 'user_fred');
    headers.set('x-user-role', 'ADMIN');
    injectPlatformHeadersIfOwner(headers, 'user_fred', 'PLATFORM_OWNER');
    expect(headers.get('x-tenant-id')).toBe('tenant_uuid');
    expect(headers.get('x-user-clerk-id')).toBe('user_fred');
    expect(headers.get('x-user-role')).toBe('ADMIN');
    expect(headers.get('x-platform-user-clerk-id')).toBe('user_fred');
    expect(headers.get('x-platform-role')).toBe('PLATFORM_OWNER');
  });
});
