#!/usr/bin/env node
/**
 * Lighthouse audit — Sprint 14.5 (item 8).
 *
 * Roda Lighthouse em 4 rotas-chave em headless Chromium e falha o
 * processo se qualquer categoria abaixo do threshold.
 *
 * Uso:
 *   STAGING_URL=https://staging.example.com node scripts/lighthouse-audit.mjs
 *
 * Localmente:
 *   STAGING_URL=http://localhost:3000 npx playwright install --with-deps chromium
 *   node scripts/lighthouse-audit.mjs
 *
 * CI: configura STAGING_URL como secret e dispara em pull_request.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import lighthouse from 'lighthouse';

const STAGING_URL = process.env.STAGING_URL ?? 'http://localhost:3000';
const ROUTES = ['/dashboard', '/pipeline', '/contacts', '/admin/billing'];
const THRESHOLDS = {
  accessibility: 90,
  performance: 85,
  'best-practices': 90,
  seo: 80,
};
const OUT_DIR = path.resolve('tests/lighthouse');

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    args: ['--remote-debugging-port=9222'],
  });

  const results = [];
  let failed = false;

  for (const route of ROUTES) {
    const url = `${STAGING_URL}${route}`;
    console.log(`\n▶ Auditing ${url}`);

    try {
      const { lhr } = await lighthouse(url, {
        port: 9222,
        output: 'json',
        logLevel: 'error',
        onlyCategories: Object.keys(THRESHOLDS),
      });

      const scores = Object.fromEntries(
        Object.entries(lhr.categories).map(([k, v]) => [k, Math.round((v.score ?? 0) * 100)]),
      );
      results.push({ route, url, scores });

      for (const [cat, threshold] of Object.entries(THRESHOLDS)) {
        const score = scores[cat] ?? 0;
        if (score < threshold) {
          console.error(`  ✗ ${cat}: ${score} < ${threshold}`);
          failed = true;
        } else {
          console.log(`  ✓ ${cat}: ${score}`);
        }
      }
    } catch (err) {
      console.error(`  ✗ failed: ${err instanceof Error ? err.message : err}`);
      results.push({ route, url, error: String(err) });
      failed = true;
    }
  }

  await writeFile(
    path.join(OUT_DIR, 'results.json'),
    JSON.stringify({ stagingUrl: STAGING_URL, results }, null, 2),
  );
  await browser.close();

  console.log(`\nResultado salvo em ${path.join(OUT_DIR, 'results.json')}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
