/* eslint-disable */
// AC-20 — E2E /admin/users/[id]/permissions: 3 estados visuais + botões
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- QA scaffolding Sprint 15E; describe.skip até validação manual
//          funcionais + histórico inline.
//
// Estratégia: Playwright + fixture loginAsAdmin (Sprint 11).
// Gated via hasFixture — pula se E2E_TEST_TENANT_ID/E2E_TEST_USER_CLERK_ID
// não estão setados (mesmo padrão do pipeline-7-stages.spec.ts).
//
// TODO(Sprint 15E): remover test.describe.skip após merge da Fase 3.
// Depende de: /admin/users/[id]/permissions page + permissions router.

import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './fixtures/auth';

const hasFixture = !!(
  process.env.E2E_TEST_TENANT_ID && process.env.E2E_TEST_USER_CLERK_ID
);

test.describe.skip('AC-20 — /admin/users/[id]/permissions', () => {
  test.skip(!hasFixture, 'fixture E2E não configurado');

  test('lista 3 estados visuais (default / granted / revoked)', async ({
    page,
    context,
  }) => {
    await loginAsAdmin(page, context);
    // Assume seed com um user ANALISTA em /admin/users
    await page.goto('/admin/users');
    await page.getByRole('link', { name: /permissões/i }).first().click();

    // Header contém nome + role + email
    await expect(page.locator('h1, [role="heading"]')).toContainText(/ANALISTA/i);

    // 3 estados representados via ícones/labels
    await expect(page.getByRole('list', { name: /permissões/i }).or(
      page.locator('[data-permissions-list]'),
    )).toBeVisible();

    // Estado "default" (herdado do role) — ícone check ou classe específica
    const defaultBadges = page.getByText(/do perfil/i);
    expect(await defaultBadges.count()).toBeGreaterThan(0);
  });

  test('botão Conceder cria override granted e atualiza UI sem reload', async ({
    page,
    context,
  }) => {
    await loginAsAdmin(page, context);
    await page.goto('/admin/users');
    await page.getByRole('link', { name: /permissões/i }).first().click();

    // Localiza uma permission sem grant e concede
    const grantButton = page
      .getByRole('button', { name: /Conceder/i })
      .first();
    await grantButton.click();

    // Depois do click, texto do botão vira "Revogar" (state flip)
    await expect(
      page.getByRole('button', { name: /Revogar/i }).first(),
    ).toBeVisible({ timeout: 3000 });

    // Toast de sucesso
    await expect(page.getByText(/permissão concedida|salv/i)).toBeVisible();
  });

  test('botão Revogar cria override revoked e mostra "Restaurar padrão"', async ({
    page,
    context,
  }) => {
    await loginAsAdmin(page, context);
    await page.goto('/admin/users');
    await page.getByRole('link', { name: /permissões/i }).first().click();

    // Revoga uma permission do default
    const revokeButton = page
      .getByRole('button', { name: /^Revogar$/ })
      .first();
    await revokeButton.click();

    await expect(
      page.getByRole('button', { name: /Restaurar padrão/i }).first(),
    ).toBeVisible({ timeout: 3000 });
  });

  test('botão Restaurar padrão volta ao estado default', async ({
    page,
    context,
  }) => {
    await loginAsAdmin(page, context);
    await page.goto('/admin/users');
    await page.getByRole('link', { name: /permissões/i }).first().click();

    const restoreButton = page
      .getByRole('button', { name: /Restaurar padrão/i })
      .first();
    if (await restoreButton.isVisible()) {
      await restoreButton.click();
      await expect(page.getByText(/do perfil/i).first()).toBeVisible({
        timeout: 3000,
      });
    }
  });

  test('histórico inline mostra "concedida em DATA por PESSOA"', async ({
    page,
    context,
  }) => {
    await loginAsAdmin(page, context);
    await page.goto('/admin/users');
    await page.getByRole('link', { name: /permissões/i }).first().click();

    // Depois de conceder uma permissão, o card deve mostrar quem/quando/motivo
    await page.getByRole('button', { name: /Conceder/i }).first().click();
    await expect(
      page.getByText(/concedida em .+ por /i),
    ).toBeVisible({ timeout: 3000 });
  });

  test('contagem no header é transparente (X do perfil + Y concedidas − Z revogadas)', async ({
    page,
    context,
  }) => {
    await loginAsAdmin(page, context);
    await page.goto('/admin/users');
    await page.getByRole('link', { name: /permissões/i }).first().click();

    await expect(
      page.getByText(/\d+ permiss(ões|ão) \(\d+ do perfil.*\d+ concedid.*\d+ revogad/i),
    ).toBeVisible();
  });

  test('ANALISTA sem user:grant_permissions recebe 403 na rota', async ({
    page,
    context,
  }) => {
    // Cenário: user ANALISTA logado tentando acessar /admin/users/[id]/permissions
    // Deveria receber 403 (middleware bloqueia rota admin).
    // TODO: fixture loginAsAnalista pra rodar esse cenário — deixa como todo.
    test.skip(true, 'depende de fixture loginAsAnalista (não existe ainda)');
    await page.goto('/admin/users/xyz/permissions');
    await expect(page).toHaveURL(/\/403|\/dashboard/);
  });

  test('modal invite → ganha collapsible "Permissões avançadas"', async ({
    page,
    context,
  }) => {
    await loginAsAdmin(page, context);
    await page.goto('/admin/users');
    await page.getByRole('button', { name: /Convidar/i }).click();

    // Collapsible fechado por default
    const advanced = page.getByRole('button', {
      name: /Permissões avançadas|Advanced/i,
    });
    await expect(advanced).toBeVisible();
    await advanced.click();

    // Após expand, checkbox list aparece com as permissions inbound e reports
    await expect(page.getByText(/inbound:view_queue/i)).toBeVisible();
    await expect(page.getByText(/reports:financial/i)).toBeVisible();
  });

  test('sidebar renderiza "Inbox de prospects" só se hasPermissionByRole(inbound:view_queue)', async ({
    page,
    context,
  }) => {
    await loginAsAdmin(page, context);
    await page.goto('/dashboard');

    // ADMIN default vê o link
    await expect(
      page.getByRole('link', { name: /Inbox de prospects|Fila inbound/i }),
    ).toBeVisible();
  });

  test('E2E: ADMIN concede inbound:view_queue a ANALISTA → link aparece no reload', async ({
    page,
    context,
  }) => {
    // Cenário integrado — depende de dois usuários (fixtures Sprint 15E).
    // TODO: setup dedicado.
    test.skip(true, 'depende de 2 fixtures (ADMIN + ANALISTA) — ver docs/QA report');
  });
});
