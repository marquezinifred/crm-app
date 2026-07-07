import type { Prisma, SalesUnitType } from '@prisma/client';

/**
 * Sprint 15G Fase 2b — stub do service (contrato compartilhado).
 *
 * ⚠️ Este arquivo é o CONTRATO que Fase 2a implementa em paralelo.
 * Ao mergear a Fase 2a, este arquivo é substituído pela implementação
 * real. O router (`sales-structure.ts`) consome este módulo por imports;
 * testes do router mockam via `vi.mock('@/server/services/sales-structure.service')`.
 *
 * Tipos abaixo formam a interface pública consumida por:
 *  - Router `sales-structure.ts` (Fase 2b)
 *  - Router `opportunities.ts` `visibilityWhere` (Fase 3)
 *  - Router `reports.ts` `visibility()` (Fase 3 + amendment A3)
 *
 * Nenhum consumidor deve depender do detalhe interno das funções
 * (queries ltree, cache, breaker, etc.) — só do contrato.
 */

export type ScopeType = 'ALL' | 'TEAM' | 'OWN' | 'PARTNER' | 'NONE';

/**
 * Escopo de visibilidade resolvido pra um user. `filter` é um
 * `OpportunityWhereInput` pronto pra spread em qualquer `where`
 * do Prisma. `teamSize` é populado só quando `type === 'TEAM'`
 * (usado pela UI e pelo relatório de performance para exibir a
 * média anônima).
 */
export interface OpportunityVisibilityScope {
  type: ScopeType;
  filter: Prisma.OpportunityWhereInput;
  teamSize?: number;
}

export interface SalesStructureUser {
  id: string;
  role: string;
  partnerCompanyId: string | null;
}

export interface CreateUnitTypeInput {
  tenantId: string;
  name: string;
  level: number;
  color?: string;
  icon?: string;
}

export interface AddMemberInput {
  tenantId: string;
  unitId: string;
  userId: string;
  role: 'MANAGER' | 'MEMBER';
  isPrimary?: boolean;
  assignedBy: string;
}

export interface RemoveMemberInput {
  tenantId: string;
  unitId: string;
  userId: string;
}

/**
 * Objeto do service. Implementação real fica no chip Fase 2a — os
 * métodos abaixo lançam pra deixar claro se algum callsite escapar
 * do `vi.mock` nos testes ou se o merge da Fase 2a for esquecido.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
export const SalesStructureService = {
  async resolveOpportunityScope(
    _user: SalesStructureUser,
    _tenantId: string,
  ): Promise<OpportunityVisibilityScope> {
    throw new Error(
      '[sales-structure-service] resolveOpportunityScope não implementado — aguardando Fase 2a',
    );
  },

  async createUnitType(_input: CreateUnitTypeInput): Promise<SalesUnitType> {
    throw new Error(
      '[sales-structure-service] createUnitType não implementado — aguardando Fase 2a',
    );
  },

  async addMember(_input: AddMemberInput): Promise<void> {
    throw new Error(
      '[sales-structure-service] addMember não implementado — aguardando Fase 2a',
    );
  },

  async removeMember(_input: RemoveMemberInput): Promise<void> {
    throw new Error(
      '[sales-structure-service] removeMember não implementado — aguardando Fase 2a',
    );
  },
};
/* eslint-enable @typescript-eslint/no-unused-vars */
