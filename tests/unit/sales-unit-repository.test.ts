// @vitest-environment node
//
// Sprint 15G Fase 1a — SalesUnitRepository. Cobre create() com/sem parent,
// getSubtreeMemberIds (o coração da visibility hierárquica da Fase 2),
// getTree/getAncestors/getChildren. Mock de $queryRaw permite unit-test
// puro sem exigir Postgres com ltree instalado.
//
// Sem esse repository, TODA leitura hierárquica quebra silenciosamente
// (Prisma não expressa operadores ltree). Testes verificam:
//   - path calculado corretamente (com e sem parent)
//   - shortId injetável (determinismo pra teste)
//   - queries usam tenantId nas duas metades do WHERE (defesa cross-tenant)
//   - MANAGER-only filter no getSubtreeMemberIds

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_stub';
process.env.CLERK_SECRET_KEY ??= 'sk_test_stub';

import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryRawSpy = vi.fn();

vi.mock('@/server/db/client', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRawSpy(...args),
  },
}));

// short-id determinístico pra assertions. Repository aceita `shortId`
// via input; quando não vier, chama `generateShortId` — mockamos como fallback.
vi.mock('@/lib/utils/short-id', () => ({
  generateShortId: () => 'aaaa1111',
}));

// Prisma serializa tagged templates como `TemplateStringsArray + values`.
// Nossos testes só se importam com valores e um `combined` textual (join
// da template com valores intercalados) pra fazer asserts sobre a query.
function combineSqlCall(call: unknown[]): string {
  const strings = call[0] as TemplateStringsArray;
  const values = call.slice(1);
  let combined = '';
  strings.forEach((s, i) => {
    combined += s;
    if (i < values.length) combined += `<<${JSON.stringify(values[i])}>>`;
  });
  return combined;
}

beforeEach(() => {
  queryRawSpy.mockReset();
});

const TENANT = '11111111-1111-1111-1111-111111111111';
const PARENT_UNIT = '22222222-2222-2222-2222-222222222222';
const TYPE_ID = '33333333-3333-3333-3333-333333333333';

const rawUnitBase = {
  id: '44444444-4444-4444-4444-444444444444',
  tenant_id: TENANT,
  type_id: TYPE_ID,
  name: 'Padrão',
  short_id: 'aaaa1111',
  path: 'root.aaaa1111',
  depth: 1,
  parent_id: null,
  active: true,
  created_at: new Date('2026-07-06T00:00:00Z'),
  updated_at: new Date('2026-07-06T00:00:00Z'),
  deleted_at: null,
};

describe('SalesUnitRepository.create', () => {
  it('sem parent gera path `root.<shortId>` + depth=1', async () => {
    // 1 query: INSERT ... RETURNING (não faz lookup do parent porque parent é NULL)
    queryRawSpy.mockResolvedValueOnce([{ ...rawUnitBase }]);

    const { SalesUnitRepository } = await import('@/server/db/repositories/sales-unit.repository');
    const result = await SalesUnitRepository.create({
      tenantId: TENANT,
      typeId: TYPE_ID,
      name: 'Padrão',
      parentId: null,
      shortId: 'aaaa1111',
    });

    expect(result.path).toBe('root.aaaa1111');
    expect(result.depth).toBe(1);
    expect(result.parentId).toBeNull();

    // Só 1 chamada — não fez SELECT do parent (parent=null)
    expect(queryRawSpy).toHaveBeenCalledTimes(1);
    const combined = combineSqlCall(queryRawSpy.mock.calls[0]!);
    expect(combined).toContain('INSERT INTO sales_units');
    expect(combined).toContain('<<"root.aaaa1111">>'); // path
    expect(combined).toContain('<<1>>'); // depth
  });

  it('com parent gera path parent.path + `.` + shortId + depth=parent.depth+1', async () => {
    queryRawSpy
      .mockResolvedValueOnce([{ path: 'root.parentxx', depth: 1 }]) // SELECT parent
      .mockResolvedValueOnce([{
        ...rawUnitBase,
        path: 'root.parentxx.aaaa1111',
        depth: 2,
        parent_id: PARENT_UNIT,
      }]);

    const { SalesUnitRepository } = await import('@/server/db/repositories/sales-unit.repository');
    const result = await SalesUnitRepository.create({
      tenantId: TENANT,
      typeId: TYPE_ID,
      name: 'Sub',
      parentId: PARENT_UNIT,
      shortId: 'aaaa1111',
    });

    expect(result.path).toBe('root.parentxx.aaaa1111');
    expect(result.depth).toBe(2);
    expect(result.parentId).toBe(PARENT_UNIT);

    // 2 chamadas: lookup parent + INSERT
    expect(queryRawSpy).toHaveBeenCalledTimes(2);
    const lookup = combineSqlCall(queryRawSpy.mock.calls[0]!);
    expect(lookup).toContain('FROM sales_units');
    expect(lookup).toContain(`<<"${PARENT_UNIT}">>`);
    expect(lookup).toContain(`<<"${TENANT}">>`); // filtro tenant no lookup
  });

  it('sem shortId informado, usa generateShortId() (mock retorna determinístico)', async () => {
    queryRawSpy.mockResolvedValueOnce([{ ...rawUnitBase }]);

    const { SalesUnitRepository } = await import('@/server/db/repositories/sales-unit.repository');
    await SalesUnitRepository.create({
      tenantId: TENANT,
      typeId: TYPE_ID,
      name: 'Padrão',
      // shortId omitido: fallback pra `generateShortId()` -> 'aaaa1111'
    });

    const combined = combineSqlCall(queryRawSpy.mock.calls[0]!);
    expect(combined).toContain('<<"aaaa1111">>');
    expect(combined).toContain('<<"root.aaaa1111">>');
  });

  it('parent inexistente ou de outro tenant → throw claro', async () => {
    queryRawSpy.mockResolvedValueOnce([]); // SELECT retorna vazio

    const { SalesUnitRepository } = await import('@/server/db/repositories/sales-unit.repository');
    await expect(
      SalesUnitRepository.create({
        tenantId: TENANT,
        typeId: TYPE_ID,
        name: 'Sub',
        parentId: PARENT_UNIT,
        shortId: 'aaaa1111',
      }),
    ).rejects.toThrow(/parentId .* não encontrado/);
  });

  it('INSERT que retorna vazio → throw explícito (defesa em profundidade)', async () => {
    queryRawSpy.mockResolvedValueOnce([]); // RETURNING vazio

    const { SalesUnitRepository } = await import('@/server/db/repositories/sales-unit.repository');
    await expect(
      SalesUnitRepository.create({
        tenantId: TENANT,
        typeId: TYPE_ID,
        name: 'Padrão',
        shortId: 'aaaa1111',
      }),
    ).rejects.toThrow(/INSERT retornou vazio/);
  });
});

describe('SalesUnitRepository.getSubtreeMemberIds', () => {
  const MANAGER = 'manager-uuid-0000-0000-000000000001';
  const SUBORDINATE = 'sub-uuid-0000-0000-000000000002';

  it('manager sem role MANAGER em nenhuma unit → [] (o filtro `mgr.role = \'MANAGER\'` cuida)', async () => {
    queryRawSpy.mockResolvedValueOnce([]); // nenhum resultado

    const { SalesUnitRepository } = await import('@/server/db/repositories/sales-unit.repository');
    const result = await SalesUnitRepository.getSubtreeMemberIds(MANAGER, TENANT);

    expect(result).toEqual([]);

    // Confere que o filtro MANAGER está na query
    const combined = combineSqlCall(queryRawSpy.mock.calls[0]!);
    expect(combined).toContain("mgr_membership.role = 'MANAGER'");
  });

  it('manager com subtree retorna próprio ID + descendentes', async () => {
    queryRawSpy.mockResolvedValueOnce([
      { user_id: MANAGER },
      { user_id: SUBORDINATE },
    ]);

    const { SalesUnitRepository } = await import('@/server/db/repositories/sales-unit.repository');
    const result = await SalesUnitRepository.getSubtreeMemberIds(MANAGER, TENANT);

    expect(result).toContain(MANAGER);
    expect(result).toContain(SUBORDINATE);
  });

  it('descendentes de N-nível são incluídos via operador ltree <@', async () => {
    // 3 members em 3 unidades diferentes (avô, pai, filho); todos devem
    // aparecer se o manager é MANAGER na avó.
    queryRawSpy.mockResolvedValueOnce([
      { user_id: 'grand-user-uuid' },
      { user_id: 'parent-user-uuid' },
      { user_id: 'child-user-uuid' },
    ]);

    const { SalesUnitRepository } = await import('@/server/db/repositories/sales-unit.repository');
    const result = await SalesUnitRepository.getSubtreeMemberIds(MANAGER, TENANT);

    expect(result).toHaveLength(3);
    const combined = combineSqlCall(queryRawSpy.mock.calls[0]!);
    // ltree descendant-or-equal
    expect(combined).toContain('sub_unit.path <@ mgr_unit.path');
  });

  it('filtro tenant aplicado em TODAS as tabelas juntadas (cross-tenant defense)', async () => {
    queryRawSpy.mockResolvedValueOnce([]);

    const { SalesUnitRepository } = await import('@/server/db/repositories/sales-unit.repository');
    await SalesUnitRepository.getSubtreeMemberIds(MANAGER, TENANT);

    const combined = combineSqlCall(queryRawSpy.mock.calls[0]!);
    // tenant_id aparece na query em 4 pontos (mgr_membership, mgr_unit, sub_unit, sub_members).
    // Contagem de aparições do UUID intercalado.
    const occurrences = combined.split(`<<"${TENANT}">>`).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(4);
  });
});

describe('SalesUnitRepository.getTree', () => {
  it('retorna árvore com typeName + memberCount por nó', async () => {
    queryRawSpy.mockResolvedValueOnce([
      {
        ...rawUnitBase,
        type_name: 'Unidade',
        type_level: 1,
        type_color: '#6366F1',
        type_icon: 'users',
        member_count: 5n,
      },
    ]);

    const { SalesUnitRepository } = await import('@/server/db/repositories/sales-unit.repository');
    const result = await SalesUnitRepository.getTree(TENANT);

    expect(result).toHaveLength(1);
    expect(result[0]!.typeName).toBe('Unidade');
    expect(result[0]!.typeLevel).toBe(1);
    expect(result[0]!.memberCount).toBe(5);

    const combined = combineSqlCall(queryRawSpy.mock.calls[0]!);
    expect(combined).toContain('ORDER BY su.path'); // ordenação por hierarquia
    expect(combined).toContain('LEFT JOIN sales_unit_members'); // memberCount join
  });
});

describe('SalesUnitRepository.getAncestors', () => {
  it('retorna breadcrumb sem incluir o próprio node', async () => {
    queryRawSpy.mockResolvedValueOnce([
      {
        ...rawUnitBase,
        id: 'root-uuid',
        path: 'root.aaa',
        depth: 1,
        type_name: 'Diretoria',
        type_level: 1,
        type_color: null,
        type_icon: null,
      },
      {
        ...rawUnitBase,
        id: 'mid-uuid',
        path: 'root.aaa.bbb',
        depth: 2,
        parent_id: 'root-uuid',
        type_name: 'Regional',
        type_level: 2,
        type_color: null,
        type_icon: null,
      },
    ]);

    const { SalesUnitRepository } = await import('@/server/db/repositories/sales-unit.repository');
    const result = await SalesUnitRepository.getAncestors('leaf-uuid', TENANT);

    expect(result).toHaveLength(2);
    // Deve ordenar por nlevel asc (root primeiro)
    const combined = combineSqlCall(queryRawSpy.mock.calls[0]!);
    expect(combined).toContain('ORDER BY nlevel(anc.path) ASC');
    // Filtro que exclui a própria unit
    expect(combined).toContain('anc.path != target.path');
    // ltree ancestor-or-equal
    expect(combined).toContain('anc.path @> target.path');
  });
});

describe('SalesUnitRepository.getChildren', () => {
  it('retorna filhos diretos por parent_id (não recursivo)', async () => {
    queryRawSpy.mockResolvedValueOnce([
      {
        ...rawUnitBase,
        id: 'child-1',
        name: 'Regional Sul',
        depth: 2,
        parent_id: PARENT_UNIT,
        type_name: 'Regional',
        type_level: 2,
        type_color: null,
        type_icon: null,
      },
      {
        ...rawUnitBase,
        id: 'child-2',
        name: 'Regional Norte',
        depth: 2,
        parent_id: PARENT_UNIT,
        type_name: 'Regional',
        type_level: 2,
        type_color: null,
        type_icon: null,
      },
    ]);

    const { SalesUnitRepository } = await import('@/server/db/repositories/sales-unit.repository');
    const result = await SalesUnitRepository.getChildren(PARENT_UNIT, TENANT);

    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe('Regional Sul');

    const combined = combineSqlCall(queryRawSpy.mock.calls[0]!);
    expect(combined).toContain(`<<"${PARENT_UNIT}">>`);
    expect(combined).toContain(`<<"${TENANT}">>`);
    expect(combined).toContain('WHERE c.parent_id ='); // filtro por parent direto
    expect(combined).not.toContain('<@'); // sem operador de subtree
  });
});
