import { test, expect } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './fixtures/auth';

/**
 * E2E "percorrer os 7 estágios" — Sprint 2 + fixture Sprint 11.
 *
 * Cobertura: criar oportunidade em Prospect → preencher campos por estágio →
 * avançar para Lead → Oportunidade → Proposta → Negociação → Aceite → Contrato.
 *
 * Pré-requisitos no ambiente CI:
 *   - App rodando com NODE_ENV=test e endpoint /api/e2e/login habilitado
 *   - E2E_TEST_TENANT_ID, E2E_TEST_USER_CLERK_ID configurados
 *   - E2E_RESET_URL apontando para handler que executa `prisma migrate reset --skip-seed && seed`
 *
 * Localmente: definir essas variáveis e rodar `npm run test:e2e`.
 */

const hasFixture = !!(process.env.E2E_TEST_TENANT_ID && process.env.E2E_TEST_USER_CLERK_ID);

test.describe('Pipeline 7 estágios', () => {
  test.beforeAll(async () => {
    if (hasFixture) await resetDatabase();
  });

  test.skip(!hasFixture, 'fixture E2E não configurado (defina E2E_TEST_TENANT_ID + E2E_TEST_USER_CLERK_ID)');

  test('cria oportunidade e percorre Prospect → Contrato', async ({ page, context }) => {
    await loginAsAdmin(page, context);
    await page.goto('/pipeline/new');

    await page.getByLabel(/Título/).fill('E2E test deal');
    await page.getByLabel(/Empresa cliente/).selectOption({ index: 1 });
    await page.getByLabel(/Responsável interno/).selectOption({ index: 1 });
    await page.getByLabel(/Origem/).selectOption('INDICACAO');
    await page.getByLabel(/Valor estimado/).fill('50000');
    await page.getByLabel(/Data prevista de fechamento/).fill('2026-12-31');
    await page.getByRole('button', { name: /Criar oportunidade/i }).click();

    // PROSPECT → LEAD
    await expect(page.getByText(/Prospect/i)).toBeVisible();
    await page.getByRole('button', { name: /Avançar para Lead/i }).click();

    // LEAD: preencher reunião
    await page.getByLabel(/Reunião agendada/).fill('2026-07-15T10:00');
    await page.getByLabel(/Reunião aconteceu/).selectOption('true');
    await page.getByRole('button', { name: /Salvar alterações/i }).click();
    await page.getByRole('button', { name: /Avançar para Oportunidade/i }).click();

    // OPORTUNIDADE: briefing + valor + data
    await page.getByLabel(/Briefing/).fill('Cliente quer migrar do legado em 6 meses');
    await page.getByRole('button', { name: /Salvar alterações/i }).click();
    await page.getByRole('button', { name: /Avançar para Proposta/i }).click();

    // PROPOSTA: datas
    await page.getByLabel(/Data de apresentação/).fill('2026-08-15');
    await page.getByLabel(/Decisão esperada em/).fill('2026-09-15');
    await page.getByRole('button', { name: /Salvar alterações/i }).click();
    await page.getByRole('button', { name: /Avançar para Negociação/i }).click();

    // NEGOCIACAO → ACEITE
    await page.getByRole('button', { name: /Avançar para Aceite/i }).click();

    // ACEITE: data
    await page.getByLabel(/Data do aceite/).fill('2026-09-20T16:00');
    await page.getByRole('button', { name: /Salvar alterações/i }).click();
    await page.getByRole('button', { name: /Avançar para Contrato/i }).click();

    await expect(page.getByText(/Contrato/)).toBeVisible();
  });
});
