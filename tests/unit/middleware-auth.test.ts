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

import { isApiRequest, apiAuthError } from '@/middleware';

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
