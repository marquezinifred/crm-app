import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Sprint 15G.5 chip 2c (T15) — Backstop estrutural do guard de transferência.
 *
 * O guard vive na Prisma extension (`src/server/db/client.ts`) como choke
 * point name-independent: qualquer mutation de escrita dos 5 modelos que
 * referenciam uma opportunity passa por ele automaticamente (sem denylist de
 * procedures pra manter à mão). Este teste afirma que:
 *
 *  1. O guard está presente e cobre EXATAMENTE os 5 modelos esperados
 *     (regressão silenciosa: se alguém remover um modelo da lista, a
 *     invariante read-only quebra sem erro em runtime).
 *  2. A lista de write ops cobre create/update/upsert/delete + os *Many.
 *  3. O guard é consumidor runtime da flag (kill-switch T3/T16).
 *  4. O lookup usa `base` (client NÃO-estendido) — anti-recursão T15.
 *  5. Bloqueio via `ForbiddenError` (mapeado pra FORBIDDEN pelo trpc.ts).
 *  6. O backstop P-42 (`assertTenantWritePayload`) permanece presente —
 *     o guard 2c é ADITIVO, não substitui a semântica de tenant-isolation.
 *
 * Complementa os testes de comportamento (`transfer-write-guard.test.ts`) e
 * a integração real (`opportunity-transfer-guard.test.ts`, gated por DB).
 */

const SRC = readFileSync(
  resolve(process.cwd(), 'src/server/db/client.ts'),
  'utf-8',
);

const EXPECTED_MODELS = ['Opportunity', 'Proposal', 'Activity', 'Task', 'Document'] as const;

describe('guard de transferência — backstop estrutural (T15)', () => {
  it('cobre exatamente os 5 modelos que referenciam opportunity', () => {
    // Extrai o conteúdo do Set TRANSFER_GUARDED_MODELS.
    const match = SRC.match(/TRANSFER_GUARDED_MODELS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    expect(match, 'TRANSFER_GUARDED_MODELS não encontrado').not.toBeNull();
    const block = match![1]!;
    for (const model of EXPECTED_MODELS) {
      expect(block, `modelo ${model} sumiu do guard`).toContain(`'${model}'`);
    }
    // Não regrediu silenciosamente pra um número diferente de modelos.
    const count = (block.match(/'/g) ?? []).length / 2;
    expect(count, 'a lista de modelos guardados mudou de tamanho').toBe(EXPECTED_MODELS.length);
  });

  it('cobre as write ops (create/update/upsert/delete + *Many)', () => {
    const match = SRC.match(/TRANSFER_WRITE_OPS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    expect(match).not.toBeNull();
    const block = match![1]!;
    for (const op of [
      'create',
      'createMany',
      'update',
      'updateMany',
      'upsert',
      'delete',
      'deleteMany',
    ]) {
      expect(block, `op ${op} não coberta`).toContain(`'${op}'`);
    }
  });

  it('é consumidor runtime do kill-switch (T3/T16)', () => {
    // Lê OPPORTUNITY_TRANSFER_ENABLED em runtime (via isTransferGuardEnabled,
    // sem importar env.ts — mantém o módulo crítico com footprint mínimo).
    expect(SRC).toContain('OPPORTUNITY_TRANSFER_ENABLED');
    expect(SRC).toContain('isTransferGuardEnabled()');
  });

  it('NÃO importa @/lib/env (evita acoplar o choke point à validação Zod global)', () => {
    expect(SRC).not.toMatch(/from\s+['"]@\/lib\/env['"]/);
  });

  it('usa o client base NÃO-estendido no lookup (anti-recursão T15)', () => {
    expect(SRC).toContain('evaluateTransferGuard(');
    // O call site passa `base` (não o `prisma` estendido).
    expect(SRC).toMatch(/evaluateTransferGuard\(\s*base as unknown as TransferGuardDb/);
  });

  it('bloqueia via ForbiddenError (mapeado pra FORBIDDEN em trpc.ts)', () => {
    expect(SRC).toContain('new ForbiddenError(TRANSFER_GUARD_FORBIDDEN_MESSAGE)');
  });

  it('backstop P-42 permanece presente (guard 2c é aditivo)', () => {
    expect(SRC).toContain('assertTenantWritePayload');
    expect(SRC).toContain('[tenant-isolation]');
  });
});
