import type { Page, BrowserContext } from '@playwright/test';

/**
 * Helpers de auth E2E — Sprint 11.
 *
 * Em CI usamos modo "test bypass": configure `E2E_TEST_TENANT_ID` e
 * `E2E_TEST_USER_CLERK_ID` no env e a rota `/api/e2e/login` (apenas em
 * NODE_ENV=test) seta cookies de sessão fake. Em produção essa rota é 404.
 */

export async function loginAsAdmin(page: Page, context: BrowserContext) {
  const tenantId = process.env.E2E_TEST_TENANT_ID;
  const userClerkId = process.env.E2E_TEST_USER_CLERK_ID;
  if (!tenantId || !userClerkId) {
    throw new Error(
      'E2E_TEST_TENANT_ID / E2E_TEST_USER_CLERK_ID ausentes — defina no env de CI',
    );
  }
  await context.addCookies([
    {
      name: 'x-e2e-tenant',
      value: tenantId,
      url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    },
    {
      name: 'x-e2e-user',
      value: userClerkId,
      url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    },
  ]);
  await page.goto('/dashboard');
}

export async function resetDatabase(): Promise<void> {
  const url = process.env.E2E_RESET_URL;
  if (!url) return;
  await fetch(url, { method: 'POST' });
}
