import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { loginAsAdmin } from './fixtures/auth';

/**
 * Smoke a11y — Sprint 14.
 *
 * Roda axe-core em 4 rotas-chave (Lighthouse target) e bloqueia o PR
 * em qualquer violação AA. As páginas públicas (sign-in, privacy)
 * também são checadas porque não exigem auth.
 *
 * P-52 (2026-07-05): `.exclude('iframe')` para não analisar subframes
 * de terceiros (Clerk injeta iframe oculto pra session management em
 * todas as rotas via ClerkProvider). Axe reportava `html-has-lang`
 * contra o `<html>` interno desses iframes que não controlamos. A tag
 * `<html lang="pt-BR">` do nosso app segue em `src/app/layout.tsx:59`.
 */

const PUBLIC_ROUTES = ['/', '/sign-in', '/privacy', '/terms', '/privacy-request'];
const AUTH_ROUTES = ['/dashboard', '/pipeline', '/contacts', '/admin/billing'];

test.describe('a11y axe-core', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`zero violações AA em ${route}`, async ({ page }) => {
      await page.goto(route);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .exclude('iframe')
        .analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }

  const hasFixture = !!(process.env.E2E_TEST_TENANT_ID && process.env.E2E_TEST_USER_CLERK_ID);
  test.describe('rotas autenticadas', () => {
    test.skip(!hasFixture, 'fixture E2E não configurado');

    for (const route of AUTH_ROUTES) {
      test(`zero violações AA em ${route}`, async ({ page, context }) => {
        await loginAsAdmin(page, context);
        await page.goto(route);
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .exclude('iframe')
          .analyze();
        expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
      });
    }
  });
});
