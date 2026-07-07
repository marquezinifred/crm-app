import { prisma } from '@/server/db/client';
import { generateShortId } from '@/lib/utils/short-id';

/**
 * ⚠️ CONVENÇÃO Sprint 15G Fase 1a (Emenda A7):
 *
 *   NUNCA fazer `prisma.salesUnit.create(...)` direto.
 *   SEMPRE usar `SalesUnitRepository.create(...)`.
 *
 * Motivo: `path` é `ltree` do Postgres — Prisma trata como `Unsupported`
 * (vira `never` no cliente TS). Se alguém tentar criar direto com uma
 * expressão do Prisma, `path` fica `''` no INSERT, o que viola o CHECK
 * `sales_units_path_not_empty` da migration 0031. Este repository monta
 * o INSERT via `$queryRaw` calculando path a partir do parent.
 *
 * Também centraliza as queries hierárquicas (`getSubtreeMemberIds`,
 * `getTree`, `getAncestors`, `getChildren`) que usam operadores ltree
 * (`<@`, `@>`, `nlevel`, etc.) — nada disso é expressável via Prisma.
 */

export interface SalesUnitRow {
  id: string;
  tenantId: string;
  typeId: string;
  name: string;
  shortId: string;
  path: string;
  depth: number;
  parentId: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface SalesUnitWithType extends SalesUnitRow {
  typeName: string;
  typeLevel: number;
  typeColor: string | null;
  typeIcon: string | null;
}

export interface SalesUnitTreeNode extends SalesUnitWithType {
  memberCount: number;
}

export interface CreateSalesUnitInput {
  tenantId: string;
  typeId: string;
  name: string;
  /**
   * Se `null`, cria nó raiz com path `root.<shortId>` e depth=1.
   * Se informado, path = parent.path || '.' || shortId e depth = parent.depth + 1.
   * FK RESTRICT no schema garante que parentId inválido falha o INSERT.
   */
  parentId?: string | null;
  /**
   * short_id opcional pra testes determinísticos. Padrão: gera via
   * `generateShortId()` (crypto.randomBytes). Em produção deixar undefined.
   */
  shortId?: string;
  active?: boolean;
}

interface RawUnitRow {
  id: string;
  tenant_id: string;
  type_id: string;
  name: string;
  short_id: string;
  path: string;
  depth: number;
  parent_id: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function mapRow(r: RawUnitRow): SalesUnitRow {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    typeId: r.type_id,
    name: r.name,
    shortId: r.short_id,
    path: r.path,
    depth: r.depth,
    parentId: r.parent_id,
    active: r.active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

interface RawUnitWithType extends RawUnitRow {
  type_name: string;
  type_level: number;
  type_color: string | null;
  type_icon: string | null;
}

function mapRowWithType(r: RawUnitWithType): SalesUnitWithType {
  return {
    ...mapRow(r),
    typeName: r.type_name,
    typeLevel: r.type_level,
    typeColor: r.type_color,
    typeIcon: r.type_icon,
  };
}

export const SalesUnitRepository = {
  /**
   * Cria uma nova SalesUnit calculando `path` deterministicamente.
   *
   * Sem `parentId`: nó raiz, path = `root.<shortId>`, depth = 1.
   * Com `parentId`: valida existência+tenant, path = `<parent.path>.<shortId>`,
   *   depth = parent.depth + 1.
   *
   * Cross-tenant defense: quando `parentId` é informado, o lookup filtra por
   * `tenantId` — parent de outro tenant retorna vazio e o método lança.
   *
   * Consumidores devem estar dentro de `runWithTenant`; o INSERT ainda passa
   * por RLS pra defesa em profundidade.
   */
  async create(input: CreateSalesUnitInput): Promise<SalesUnitRow> {
    const shortId = input.shortId ?? generateShortId();
    const active = input.active ?? true;

    let path: string;
    let depth: number;

    if (input.parentId) {
      const parentRows = await prisma.$queryRaw<
        Array<{ path: string; depth: number }>
      >`
        SELECT path::text AS path, depth
        FROM sales_units
        WHERE id = ${input.parentId}::uuid
          AND tenant_id = ${input.tenantId}::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `;
      const parent = parentRows[0];
      if (!parent) {
        throw new Error(
          `[sales-unit-repository] parentId ${input.parentId} não encontrado no tenant ${input.tenantId}`,
        );
      }
      path = `${parent.path}.${shortId}`;
      depth = parent.depth + 1;
    } else {
      path = `root.${shortId}`;
      depth = 1;
    }

    const rows = await prisma.$queryRaw<RawUnitRow[]>`
      INSERT INTO sales_units (
        id, tenant_id, type_id, name, short_id, path, depth, parent_id, active,
        created_at, updated_at, deleted_at
      ) VALUES (
        gen_random_uuid(),
        ${input.tenantId}::uuid,
        ${input.typeId}::uuid,
        ${input.name},
        ${shortId},
        ${path}::ltree,
        ${depth},
        ${input.parentId ?? null}::uuid,
        ${active},
        now(),
        now(),
        NULL
      )
      RETURNING
        id, tenant_id, type_id, name, short_id, path::text AS path,
        depth, parent_id, active, created_at, updated_at, deleted_at
    `;
    const row = rows[0];
    if (!row) {
      throw new Error('[sales-unit-repository] INSERT retornou vazio');
    }
    return mapRow(row);
  },

  /**
   * Retorna IDs de todos os users acessíveis pelo `managerId` a partir de
   * QUALQUER unit onde ele é MANAGER (inclui subtree completa).
   *
   * Inclui o próprio `managerId` no resultado. Se ele não é MANAGER em nenhuma
   * unit, retorna `[]` (fallback pra OWN acontece no chamador — não aqui).
   *
   * Query: subtree de cada unit que ele gerencia usa `su.path <@ manager_unit.path`
   * (`<@` = descendant_or_equal em ltree).
   */
  async getSubtreeMemberIds(
    managerId: string,
    tenantId: string,
  ): Promise<string[]> {
    const rows = await prisma.$queryRaw<Array<{ user_id: string }>>`
      SELECT DISTINCT sub_members.user_id::text AS user_id
      FROM sales_unit_members mgr_membership
      JOIN sales_units mgr_unit
        ON mgr_unit.id = mgr_membership.unit_id
       AND mgr_unit.tenant_id = ${tenantId}::uuid
       AND mgr_unit.deleted_at IS NULL
      JOIN sales_units sub_unit
        ON sub_unit.tenant_id = ${tenantId}::uuid
       AND sub_unit.deleted_at IS NULL
       AND sub_unit.path <@ mgr_unit.path
      JOIN sales_unit_members sub_members
        ON sub_members.unit_id = sub_unit.id
       AND sub_members.tenant_id = ${tenantId}::uuid
      WHERE mgr_membership.user_id = ${managerId}::uuid
        AND mgr_membership.tenant_id = ${tenantId}::uuid
        AND mgr_membership.role = 'MANAGER'
    `;
    return rows.map((r) => r.user_id);
  },

  /**
   * Retorna toda a árvore do tenant ordenada por `path`. Cada nó vem com
   * dados do tipo (name/level/color/icon) e `memberCount` (só ativos).
   * Nós soft-deleted são excluídos.
   */
  async getTree(tenantId: string): Promise<SalesUnitTreeNode[]> {
    const rows = await prisma.$queryRaw<Array<RawUnitWithType & { member_count: bigint }>>`
      SELECT
        su.id, su.tenant_id, su.type_id, su.name, su.short_id,
        su.path::text AS path, su.depth, su.parent_id, su.active,
        su.created_at, su.updated_at, su.deleted_at,
        sut.name AS type_name, sut.level AS type_level,
        sut.color AS type_color, sut.icon AS type_icon,
        COUNT(sum.id) AS member_count
      FROM sales_units su
      JOIN sales_unit_types sut ON sut.id = su.type_id
      LEFT JOIN sales_unit_members sum ON sum.unit_id = su.id
      WHERE su.tenant_id = ${tenantId}::uuid
        AND su.deleted_at IS NULL
      GROUP BY su.id, sut.id
      ORDER BY su.path
    `;
    return rows.map((r) => ({
      ...mapRowWithType(r),
      memberCount: Number(r.member_count),
    }));
  },

  /**
   * Breadcrumb: ancestrais do `unitId` (do mais próximo à raiz), SEM incluir
   * a própria unit. Usa `@>` (ancestor_or_equal) e filtra `path != self.path`.
   * Ordenação por `nlevel(path)` asc.
   */
  async getAncestors(
    unitId: string,
    tenantId: string,
  ): Promise<SalesUnitWithType[]> {
    const rows = await prisma.$queryRaw<RawUnitWithType[]>`
      SELECT
        anc.id, anc.tenant_id, anc.type_id, anc.name, anc.short_id,
        anc.path::text AS path, anc.depth, anc.parent_id, anc.active,
        anc.created_at, anc.updated_at, anc.deleted_at,
        sut.name AS type_name, sut.level AS type_level,
        sut.color AS type_color, sut.icon AS type_icon
      FROM sales_units target
      JOIN sales_units anc
        ON anc.path @> target.path
       AND anc.path != target.path
       AND anc.tenant_id = target.tenant_id
       AND anc.deleted_at IS NULL
      JOIN sales_unit_types sut ON sut.id = anc.type_id
      WHERE target.id = ${unitId}::uuid
        AND target.tenant_id = ${tenantId}::uuid
        AND target.deleted_at IS NULL
      ORDER BY nlevel(anc.path) ASC
    `;
    return rows.map(mapRowWithType);
  },

  /**
   * Filhos diretos (depth = parent.depth + 1) do `unitId`. Não recursivo.
   * Retorna vazio se `unitId` não existe no tenant.
   */
  async getChildren(
    unitId: string,
    tenantId: string,
  ): Promise<SalesUnitWithType[]> {
    const rows = await prisma.$queryRaw<RawUnitWithType[]>`
      SELECT
        c.id, c.tenant_id, c.type_id, c.name, c.short_id,
        c.path::text AS path, c.depth, c.parent_id, c.active,
        c.created_at, c.updated_at, c.deleted_at,
        sut.name AS type_name, sut.level AS type_level,
        sut.color AS type_color, sut.icon AS type_icon
      FROM sales_units c
      JOIN sales_unit_types sut ON sut.id = c.type_id
      WHERE c.parent_id = ${unitId}::uuid
        AND c.tenant_id = ${tenantId}::uuid
        AND c.deleted_at IS NULL
      ORDER BY c.name ASC
    `;
    return rows.map(mapRowWithType);
  },
};
