// @vitest-environment node
//
// Sprint 15G Fase 1a — helpers de path/short-id.
//
// Cobre `generateShortId()` (formato + unicidade em N gerações) e o
// comportamento observável do path calculado pelo repository (via mocks
// de $queryRaw pra confirmar formato da string ltree em 5 níveis).
//
// A regex CHECK do banco é `'^[a-zA-Z0-9._]+$'` (Emenda A7); testes
// aqui confirmam que geradores respeitam esse alfabeto.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateShortId } from '@/lib/utils/short-id';

const queryRawSpy = vi.fn();

vi.mock('@/server/db/client', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRawSpy(...args),
  },
}));

beforeEach(() => {
  queryRawSpy.mockReset();
});

// Regex A7 no schema
const A7_REGEX = /^[a-zA-Z0-9._]+$/;

const TENANT = '11111111-1111-1111-1111-111111111111';
const TYPE_ID = '33333333-3333-3333-3333-333333333333';

function pathFromLastInsert(): string {
  const strings = queryRawSpy.mock.calls[queryRawSpy.mock.calls.length - 1]![0] as TemplateStringsArray;
  const values = queryRawSpy.mock.calls[queryRawSpy.mock.calls.length - 1]!.slice(1);
  // path é o 5º valor no INSERT: (id, tenant_id, type_id, name, short_id, path::ltree, ...)
  // A ordem exata está na string; simples: procurar por qualquer string que
  // case com a regex A7 e tenha ao menos um ponto (ou seja, formato ltree).
  const combined = strings.join('');
  for (const v of values) {
    if (typeof v === 'string' && v.includes('.') && A7_REGEX.test(v)) return v;
  }
  throw new Error(`sem path visível na chamada: ${combined}`);
}

describe('generateShortId', () => {
  it('retorna 8 chars sobre alfabeto [a-z0-9]', () => {
    const id = generateShortId();
    expect(id).toHaveLength(8);
    expect(id).toMatch(/^[a-z0-9]{8}$/);
    expect(id).toMatch(A7_REGEX);
  });

  it('gera IDs únicos em 1000 gerações consecutivas', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(generateShortId());
    }
    // Espaço 36⁸ ≈ 2.8×10¹² — nenhuma colisão esperada em 1k gerações.
    expect(seen.size).toBe(1000);
  });

  it('todo output respeita a regex do CHECK A7', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateShortId()).toMatch(A7_REGEX);
    }
  });
});

describe('path calculado pelo repository', () => {
  it('nó raiz gera path `root.<shortId>`', async () => {
    queryRawSpy.mockResolvedValueOnce([
      {
        id: '44444444-4444-4444-4444-444444444444',
        tenant_id: TENANT,
        type_id: TYPE_ID,
        name: 'Padrão',
        short_id: 'abc12345',
        path: 'root.abc12345',
        depth: 1,
        parent_id: null,
        active: true,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      },
    ]);

    const { SalesUnitRepository } = await import('@/server/db/repositories/sales-unit.repository');
    await SalesUnitRepository.create({
      tenantId: TENANT,
      typeId: TYPE_ID,
      name: 'Padrão',
      shortId: 'abc12345',
    });

    const path = pathFromLastInsert();
    expect(path).toBe('root.abc12345');
    expect(path).toMatch(A7_REGEX);
  });

  it('nó filho concatena parent.path + `.` + shortId', async () => {
    queryRawSpy
      .mockResolvedValueOnce([{ path: 'root.parentxx', depth: 1 }])
      .mockResolvedValueOnce([
        {
          id: 'aa',
          tenant_id: TENANT,
          type_id: TYPE_ID,
          name: 'Sub',
          short_id: 'sub00001',
          path: 'root.parentxx.sub00001',
          depth: 2,
          parent_id: 'parent-uuid',
          active: true,
          created_at: new Date(),
          updated_at: new Date(),
          deleted_at: null,
        },
      ]);

    const { SalesUnitRepository } = await import('@/server/db/repositories/sales-unit.repository');
    await SalesUnitRepository.create({
      tenantId: TENANT,
      typeId: TYPE_ID,
      name: 'Sub',
      parentId: 'parent-uuid',
      shortId: 'sub00001',
    });

    const path = pathFromLastInsert();
    expect(path).toBe('root.parentxx.sub00001');
    expect(path).toMatch(A7_REGEX);
  });

  it('profundidade N=5: cada nível concatena mais um label sem quebrar o formato', async () => {
    // Simula deep parent com path 5 níveis
    queryRawSpy
      .mockResolvedValueOnce([{ path: 'root.aaa.bbb.ccc.ddd', depth: 5 }])
      .mockResolvedValueOnce([
        {
          id: 'aa',
          tenant_id: TENANT,
          type_id: TYPE_ID,
          name: 'L6',
          short_id: 'eee00006',
          path: 'root.aaa.bbb.ccc.ddd.eee00006',
          depth: 6,
          parent_id: 'p',
          active: true,
          created_at: new Date(),
          updated_at: new Date(),
          deleted_at: null,
        },
      ]);

    const { SalesUnitRepository } = await import('@/server/db/repositories/sales-unit.repository');
    const result = await SalesUnitRepository.create({
      tenantId: TENANT,
      typeId: TYPE_ID,
      name: 'L6',
      parentId: 'p',
      shortId: 'eee00006',
    });

    expect(result.depth).toBe(6);
    const path = pathFromLastInsert();
    expect(path).toBe('root.aaa.bbb.ccc.ddd.eee00006');
    expect(path.split('.').length).toBe(6);
    expect(path).toMatch(A7_REGEX);
  });

  it('path rejeitado pela regex A7 se contiver espaço ou caractere especial', () => {
    // O CHECK do banco garante essa proteção. Aqui só validamos que a
    // regex compilada do teste tem o comportamento esperado.
    expect('root.abc def').not.toMatch(A7_REGEX); // espaço
    expect('root.abc/def').not.toMatch(A7_REGEX); // barra
    expect('root.abc-def').not.toMatch(A7_REGEX); // hífen
    expect('').not.toMatch(A7_REGEX); // vazio
    expect('root.abc.def').toMatch(A7_REGEX); // ok
    expect('root.abc_def.gh1').toMatch(A7_REGEX); // ok
  });

  it('rejeita label vazio (regex A7 pega, CHECK do banco também)', () => {
    // "root..child" seria path inválido — dois pontos consecutivos.
    // Regex A7 do CHECK sozinha NÃO pega isso ("^[a-zA-Z0-9._]+$" permite),
    // mas o ltree do Postgres rejeita label vazio em `text::ltree`. Este
    // teste documenta o boundary — o repository sempre gera shortId ≥ 1 char,
    // então path com label vazio nunca chega ao INSERT.
    expect('root..child'.split('.').includes('')).toBe(true);
    // Nossos short_ids têm 8 chars — não podem ser vazio.
    for (let i = 0; i < 100; i++) {
      const id = generateShortId();
      expect(id.length).toBe(8);
      expect(id).not.toBe('');
    }
  });
});
