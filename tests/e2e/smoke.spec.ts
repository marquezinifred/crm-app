import { test, expect } from '@playwright/test';

/**
 * Smoke E2E — não exige login. Verifica apenas que o app sobe e o health
 * endpoint responde. Sprints com Clerk em CI rodam fluxos autenticados.
 */

test('home renderiza', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Feche mais/i })).toBeVisible();
});

test('health endpoint retorna ok ou 503', async ({ request }) => {
  const res = await request.get('/api/v1/health');
  // Em CI com banco: 200; sem banco: 503 (mas a app está rodando)
  expect([200, 503]).toContain(res.status());
  const body = await res.json();
  expect(body.checks?.app).toBe('ok');
});

test('auto-cadastro público de contato renderiza form', async ({ page }) => {
  await page.goto('/p/qualquer-slug/contact');
  await expect(page.getByRole('heading', { name: /Fale com a gente/i })).toBeVisible();
  await expect(page.getByLabel(/Nome completo/i)).toBeVisible();
});
