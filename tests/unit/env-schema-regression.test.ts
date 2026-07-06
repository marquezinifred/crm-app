// @vitest-environment node

/**
 * P-63 — regression test estrutural que proíbe `z.coerce.boolean(` em
 * `src/lib/env.ts`.
 *
 * Contexto: `z.coerce.boolean(v)` invoca `Boolean(v)` em JS, e
 * `Boolean("false") === true` (qualquer string não-vazia é truthy).
 * Isso silenciosamente LIGAVA flags como `MULTI_AI_ENABLED=false` no
 * .env — bug descoberto no P-60.
 *
 * Toda flag booleana em `env.ts` DEVE usar o helper `envBoolean(default)`
 * que interpreta strings literalmente ("true|1|yes|on" → true;
 * "false|0|no|off|""  → false; ausente → default).
 *
 * Se este teste falhar, substitua a chamada por `envBoolean(default)`
 * e adicione um caso em `env-boolean-parsing.test.ts` cobrindo o valor
 * default esperado.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('env schema — regressão P-63', () => {
  it('z.coerce.boolean está banido em src/lib/env.ts (use envBoolean)', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/lib/env.ts'),
      'utf-8'
    );

    // Remove linhas que começam com comentário `//` (block comments não
    // costumam conter chamadas executáveis; o objetivo é evitar falso
    // positivo com a explicação do bug no cabeçalho de env.ts).
    const codeOnly = src
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');

    expect(codeOnly).not.toMatch(/z\.coerce\.boolean\s*\(/);
  });
});
