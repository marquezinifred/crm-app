import { TRPCError } from '@trpc/server';
import { Prisma, type UserRole, type SalesUnitType } from '@prisma/client';
import { prisma } from '@/server/db/client';
import { env } from '@/lib/env';
import { audit } from '@/server/services/audit.service';
import {
  hasPermission,
  invalidateUserPermissionsCache,
} from '@/server/services/permissions.service';
import { SalesUnitRepository } from '@/server/db/repositories/sales-unit.repository';

/**
 * Sprint 15G Fase 2a — Service central de estrutura comercial + resolução
 * de visibilidade hierárquica.
 *
 * Contrato com Fase 2b/3 (router + consumers):
 *   - `resolveOpportunityScope(user, tenantId)` retorna um objeto
 *     `OpportunityVisibilityScope` cuja propriedade `filter` deve ser
 *     passada como spread (`{ ...scope.filter, ...outros }`) pro Prisma
 *     `where`. Sempre inclui `tenantId`.
 *   - `teamSize` só existe quando `type='TEAM'` — usado por reports pra
 *     computar médias anônimas.
 *
 * Kill-switch runtime P-62 pattern (fecha P-73 candidato do QA Fase 1):
 *   Quando `env.SALES_STRUCTURE_ENABLED=false`, `resolveOpportunityScope`
 *   NÃO consulta a estrutura hierárquica. Cai no fallback pré-15G:
 *   qualquer uma das duas permissions `read_team|read_all` destrava
 *   visão tenant-wide (binário), replicando o `visibilityWhere` atual
 *   de `opportunities.ts`. Rollback é reversível apenas religando a
 *   flag — não precisa deletar estrutura já criada.
 */

export type ScopeType = 'ALL' | 'TEAM' | 'OWN' | 'PARTNER' | 'NONE';

export interface OpportunityVisibilityScope {
  type: ScopeType;
  filter: Prisma.OpportunityWhereInput;
  teamSize?: number;
}

export interface ScopeUser {
  id: string;
  role: UserRole;
  partnerCompanyId?: string | null;
}

/**
 * UUID sentinela retornado quando o scope é NONE (PARCEIRO sem
 * partnerCompanyId resolvido). Bate com o pattern pré-15G em
 * `opportunities.ts:66` — pega zero rows sem quebrar a query.
 */
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

export const SalesStructureService = {
  /**
   * Resolve o escopo de visibilidade de opportunities para o `user` no
   * `tenantId` corrente. Ordem canônica:
   *   1. Kill-switch OFF → fallback pré-15G (binário read_team|read_all)
   *   2. PARCEIRO early-return (A4) — filtro row-level rígido
   *   3. read_all → ALL (tenant inteiro)
   *   4. read_team → TEAM (subtree gerenciada via SalesUnitRepository)
   *   5. Default → OWN (só as próprias)
   *
   * O `filter` retornado sempre inclui `tenantId` — segunda barreira
   * defensiva além do Prisma extension e RLS.
   */
  async resolveOpportunityScope(
    user: ScopeUser,
    tenantId: string,
  ): Promise<OpportunityVisibilityScope> {
    if (!env.SALES_STRUCTURE_ENABLED) {
      if (user.role === 'PARCEIRO') {
        if (!user.partnerCompanyId) {
          return { type: 'NONE', filter: { id: ZERO_UUID, tenantId } };
        }
        return {
          type: 'PARTNER',
          filter: {
            tenantId,
            partnerCompanyId: user.partnerCompanyId,
            partnerEngagements: {
              some: { partnerCompanyId: user.partnerCompanyId, status: 'APPROVED' },
            },
          },
        };
      }
      const [canTeamLegacy, canAllLegacy] = await Promise.all([
        hasPermission(user.id, 'opportunity:read_team'),
        hasPermission(user.id, 'opportunity:read_all'),
      ]);
      if (canTeamLegacy || canAllLegacy) {
        return { type: 'ALL', filter: { tenantId } };
      }
      return { type: 'OWN', filter: { ownerId: user.id, tenantId } };
    }

    if (user.role === 'PARCEIRO') {
      if (!user.partnerCompanyId) {
        return { type: 'NONE', filter: { id: ZERO_UUID, tenantId } };
      }
      return {
        type: 'PARTNER',
        filter: {
          tenantId,
          partnerCompanyId: user.partnerCompanyId,
          partnerEngagements: {
            some: { partnerCompanyId: user.partnerCompanyId, status: 'APPROVED' },
          },
        },
      };
    }

    if (await hasPermission(user.id, 'opportunity:read_all')) {
      return { type: 'ALL', filter: { tenantId } };
    }

    if (await hasPermission(user.id, 'opportunity:read_team')) {
      const visibleUserIds = await SalesUnitRepository.getSubtreeMemberIds(
        user.id,
        tenantId,
      );
      if (visibleUserIds.length === 0) {
        return { type: 'OWN', filter: { ownerId: user.id, tenantId } };
      }
      return {
        type: 'TEAM',
        filter: { ownerId: { in: visibleUserIds }, tenantId },
        teamSize: visibleUserIds.length,
      };
    }

    return { type: 'OWN', filter: { ownerId: user.id, tenantId } };
  },

  /**
   * Cria um novo SalesUnitType (nível hierárquico) no tenant. Levels
   * válidos são 1-8 (bate com backfill A1 e docs da spec §3.1).
   *
   * A migration 0031 tem `UNIQUE(tenant_id, level)` e `UNIQUE(tenant_id, name)`,
   * então o create pode falhar com `P2002` se level ou name colidir — o
   * caller no router traduz pra CONFLICT.
   */
  async createUnitType(input: {
    tenantId: string;
    name: string;
    level: number;
    color?: string | null;
    icon?: string | null;
  }): Promise<SalesUnitType> {
    if (!Number.isInteger(input.level) || input.level < 1 || input.level > 8) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Level do tipo de unidade deve ser inteiro entre 1 e 8.',
      });
    }

    return prisma.salesUnitType.create({
      data: {
        tenantId: input.tenantId,
        name: input.name,
        level: input.level,
        color: input.color ?? null,
        icon: input.icon ?? null,
      },
    });
  },

  /**
   * Adiciona (ou atualiza role/isPrimary de) um membro em uma unit.
   *
   * Cross-tenant guard: unit e user precisam pertencer ao mesmo `tenantId`.
   * Qualquer discrepância vira NOT_FOUND (evita enumeration cross-tenant).
   *
   * A5 (partial unique `is_primary` per user via migration): quando
   * `isPrimary=true`, roda em transação atômica — desmarca outras
   * primary do user antes do upsert. Sem isso, dois writes concorrentes
   * podem produzir 2 rows com `is_primary=true` no mesmo user (o partial
   * unique protege contra o commit, mas queremos evitar o erro).
   *
   * Cache de permissions é invalidado — `read_team` depende da estrutura
   * atual (getSubtreeMemberIds).
   */
  async addMember(input: {
    unitId: string;
    userId: string;
    role: 'MANAGER' | 'MEMBER';
    tenantId: string;
    assignedBy: string;
    isPrimary?: boolean;
  }): Promise<{ created: boolean; roleChanged: boolean; primaryChanged: boolean }> {
    // Duas validações distintas pra mensagens úteis pro usuário.
    const [unit, user] = await Promise.all([
      prisma.salesUnit.findFirst({
        where: { id: input.unitId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true },
      }),
      prisma.user.findFirst({
        where: { id: input.userId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (!unit) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Unidade não encontrada ou pertence a outro tenant.',
      });
    }
    if (!user) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Usuário selecionado não pertence a este tenant.',
      });
    }

    const isPrimary = input.isPrimary ?? false;

    // Lê membership existente pra detectar se é criação, mudança ou no-op.
    const existing = await prisma.salesUnitMember.findUnique({
      where: {
        userId_unitId: { userId: input.userId, unitId: input.unitId },
      },
      select: { role: true, isPrimary: true },
    });

    const upsertOp = prisma.salesUnitMember.upsert({
      where: {
        userId_unitId: {
          userId: input.userId,
          unitId: input.unitId,
        },
      },
      create: {
        userId: input.userId,
        unitId: input.unitId,
        tenantId: input.tenantId,
        role: input.role,
        isPrimary,
        assignedBy: input.assignedBy,
      },
      update: {
        role: input.role,
        isPrimary,
        assignedBy: input.assignedBy,
      },
    });

    if (isPrimary) {
      await prisma.$transaction([
        prisma.salesUnitMember.updateMany({
          where: {
            userId: input.userId,
            tenantId: input.tenantId,
            isPrimary: true,
            unitId: { not: input.unitId },
          },
          data: { isPrimary: false },
        }),
        upsertOp,
      ]);
    } else {
      await upsertOp;
    }

    const created = !existing;
    const roleChanged = !!existing && existing.role !== input.role;
    const primaryChanged = !!existing && existing.isPrimary !== isPrimary;

    await invalidateUserPermissionsCache(input.userId);

    await audit({
      action: 'sales_unit.member_added',
      tableName: 'sales_unit_members',
      recordId: input.userId,
      tenantIdOverride: input.tenantId,
      after: { unitId: input.unitId, role: input.role, isPrimary },
    });

    return { created, roleChanged, primaryChanged };
  },

  /**
   * Remove membro de uma unit (deleteMany defensivo — não falha se
   * a row não existir). Cross-tenant guard via `tenantId` no filtro.
   */
  async removeMember(input: {
    unitId: string;
    userId: string;
    tenantId: string;
  }): Promise<void> {
    await prisma.salesUnitMember.deleteMany({
      where: {
        unitId: input.unitId,
        userId: input.userId,
        tenantId: input.tenantId,
      },
    });

    await invalidateUserPermissionsCache(input.userId);

    await audit({
      action: 'sales_unit.member_removed',
      tableName: 'sales_unit_members',
      recordId: input.userId,
      tenantIdOverride: input.tenantId,
      after: { unitId: input.unitId },
    });
  },
};
