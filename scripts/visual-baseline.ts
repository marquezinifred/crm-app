/**
 * Visual baseline / regression — Sprint 14 (Passo 0).
 *
 * Percorre 25 rotas-chave em 3 viewports (375/768/1280) capturando
 * screenshot. Salva em tests/visual/{baseline|current}/.
 *
 * Modo baseline: rode UMA VEZ antes do sprint, commit dos PNGs.
 *   npm run visual:baseline
 *
 * Modo current: roda em cada PR, depois compare com pixelmatch.
 *   npm run visual:current
 *
 * Requer app rodando em http://localhost:3000 com seed E2E ativo
 * (E2E_TEST_TENANT_ID + E2E_TEST_USER_CLERK_ID + /api/e2e/login).
 */

import { chromium, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const MODE = (process.env.VISUAL_MODE ?? 'baseline') as 'baseline' | 'current';
const OUT_DIR = path.resolve(`tests/visual/${MODE}`);

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

const ROUTES = [
  // públicas
  '/',
  '/sign-in',
  '/privacy',
  '/terms',
  '/privacy-request',
  // app
  '/dashboard',
  '/pipeline',
  '/inbox',
  '/search',
  '/companies',
  '/contacts',
  '/reports',
  '/contracts',
  '/approvals',
  '/imports',
  '/more',
  // admin
  '/admin/users',
  '/admin/products',
  '/admin/billing',
  '/admin/branding',
  '/admin/ai',
  '/admin/alerts',
  '/admin/approval-rules',
  '/admin/email-inbound',
  '/admin/privacy',
] as const;

async function loginIfNeeded(page: Page): Promise<void> {
  const tenant = process.env.E2E_TEST_TENANT_ID;
  const user = process.env.E2E_TEST_USER_CLERK_ID;
  if (!tenant || !user) return;
  await page.context().addCookies([
    { name: 'x-e2e-tenant', value: tenant, url: BASE_URL },
    { name: 'x-e2e-user', value: user, url: BASE_URL },
  ]);
}

function safeRouteName(route: string): string {
  return route === '/' ? 'home' : route.slice(1).replace(/\//g, '_');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginIfNeeded(page);

  let failures = 0;
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const route of ROUTES) {
      const file = `${safeRouteName(route)}-${vp.name}.png`;
      try {
        const url = `${BASE_URL}${route}`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15_000 });
        await page.waitForTimeout(500); // settle de animações
        await page.screenshot({
          path: path.join(OUT_DIR, file),
          fullPage: false,
        });
        console.log(`[ok] ${vp.name} ${route}`);
      } catch (err) {
        failures++;
        console.error(`[fail] ${vp.name} ${route} — ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  await browser.close();
  console.log(`\nMode=${MODE}  routes=${ROUTES.length}  viewports=${VIEWPORTS.length}  failures=${failures}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
