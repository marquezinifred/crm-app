/* eslint-disable */
// @vitest-environment node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- QA scaffolding Sprint 15E; describe.skip até validação manual
//
// AC-07 — Baseline: grep -rn "withRoles\|withCapability" src/server/trpc/routers
//          retorna 0 (todos migrados pra withPermission).
// AC-13 — docs/rbac-migration-map.md existe com mapping old → new dos 47 casos.
//
// Estratégia: filesystem scan sem depender de código do Sprint 15E.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const ROUTERS_DIR = path.resolve(process.cwd(), 'src/server/trpc/routers');
const MIGRATION_MAP = path.resolve(process.cwd(), 'docs/rbac-migration-map.md');

describe.skip('AC-07 — baseline: zero withRoles/withCapability nos routers pós-15E', () => {
  it('nenhum arquivo em src/server/trpc/routers usa withRoles ou withCapability', async () => {
    const files = await walk(ROUTERS_DIR);
    const offenders: Array<{ file: string; matches: string[] }> = [];
    for (const file of files) {
      const src = await fs.readFile(file, 'utf-8');
      const matches: string[] = [];
      const withRolesMatches = src.matchAll(/withRoles\s*\(/g);
      const withCapMatches = src.matchAll(/withCapability\s*\(/g);
      for (const m of withRolesMatches) matches.push(`withRoles at ${m.index}`);
      for (const m of withCapMatches) matches.push(`withCapability at ${m.index}`);
      if (matches.length > 0) {
        offenders.push({ file: path.relative(process.cwd(), file), matches });
      }
    }
    expect(
      offenders,
      `${offenders.length} arquivos ainda usam guards legados: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it('todos os routers importam withPermission de middlewares.ts', async () => {
    const files = await walk(ROUTERS_DIR);
    const withoutImport: string[] = [];
    for (const file of files) {
      const src = await fs.readFile(file, 'utf-8');
      // Se o router chama .use ou monta procedure custom, deve importar withPermission
      // ou requirePermission. Skip arquivos sem procedures (helpers).
      if (!/\.query\s*\(|\.mutation\s*\(/.test(src)) continue;
      if (
        !/withPermission|requirePermission/.test(src) &&
        !/protectedProcedure|publicProcedure|platformProcedure/.test(src)
      ) {
        withoutImport.push(path.relative(process.cwd(), file));
      }
    }
    expect(withoutImport).toEqual([]);
  });
});

describe.skip('AC-13 — docs/rbac-migration-map.md existe e completo', () => {
  it('arquivo docs/rbac-migration-map.md existe', async () => {
    const stat = await fs.stat(MIGRATION_MAP);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(500);
  });

  it('contém tabela Router | Antes | Depois com todas 47 linhas', async () => {
    const content = await fs.readFile(MIGRATION_MAP, 'utf-8');
    expect(content).toMatch(/\|\s*Router\s*\|\s*Antes\s*\|\s*Depois\s*\|/i);

    // Conta linhas de tabela válidas (cada uma tem 3 pipes internos)
    const rows = content
      .split('\n')
      .filter((l) => l.trim().startsWith('|') && !l.match(/^\|[\s-:]+\|/));
    // header + 47 procedures = 48+ linhas de dados
    expect(rows.length).toBeGreaterThanOrEqual(48);
  });

  it('menciona pelo menos as migrações críticas (inbound, ai, opportunities, users)', async () => {
    const content = await fs.readFile(MIGRATION_MAP, 'utf-8');
    expect(content).toMatch(/inbound[.:]/);
    expect(content).toMatch(/aiConfig|ai:/);
    expect(content).toMatch(/opportunities?\.list|opportunity:read/);
    expect(content).toMatch(/users?\.invite|user:create/);
    expect(content).toMatch(/withPermission\s*\(\s*['"]/);
  });
});
