/**
 * Sprint 15G Fase 4c — Seed demonstração da estrutura comercial.
 *
 * Extraído de `prisma/seed.ts` pra permitir teste unitário isolado
 * (o entry seed principal tem side-effects — top-level `main()`).
 *
 * Cria 3 níveis (Diretoria → Regional → Equipe), 4 units (1 raiz +
 * 1 regional + 2 equipes) e vincula seed users por role para exercitar
 * `resolveOpportunityScope` na UI Sprint 15G.
 *
 * **Idempotência crítica:** roda 2× seguidas sem erro. Pré-check
 * por (tenantId, level) em types e (tenantId, name) em units antes
 * de qualquer `.create`. `addMember` é upsert por (userId, unitId),
 * então repetir chamada só atualiza role/isPrimary.
 *
 * ⚠️ A7: SalesUnit sempre via `SalesUnitRepository.create` (path
 * ltree é calculado no INSERT via $queryRaw — bypass direto do
 * Prisma viola CHECK `sales_units_path_not_empty`).
 * ⚠️ A5: `addMember({ isPrimary: true })` roda em transação para
 * respeitar partial UNIQUE `is_primary WHERE is_primary=true`.
 */

import type { PrismaClient, UserRole } from '@prisma/client';
import { SalesUnitRepository } from '../src/server/db/repositories/sales-unit.repository';
import { SalesStructureService } from '../src/server/services/sales-structure.service';

export interface SeedUser {
  id: string;
  role: UserRole;
}

export async function seedCommercialStructure(
  prisma: PrismaClient,
  tenantId: string,
  admin: { id: string },
  users: SeedUser[],
): Promise<void> {
  async function ensureType(
    name: string,
    level: number,
    color: string,
    icon: string,
  ): Promise<{ id: string }> {
    const existing = await prisma.salesUnitType.findFirst({
      where: { tenantId, level },
      select: { id: true },
    });
    if (existing) return existing;
    return SalesStructureService.createUnitType({
      tenantId,
      name,
      level,
      color,
      icon,
    });
  }

  const dirType = await ensureType('Diretoria', 1, '#6366F1', 'building-2');
  const regType = await ensureType('Regional', 2, '#10B981', 'map-pin');
  const teamType = await ensureType('Equipe', 3, '#F59E0B', 'users');

  async function ensureUnit(
    typeId: string,
    name: string,
    parentId: string | null,
  ): Promise<{ id: string }> {
    const existing = await prisma.salesUnit.findFirst({
      where: { tenantId, name, deletedAt: null },
      select: { id: true },
    });
    if (existing) return existing;
    return SalesUnitRepository.create({
      tenantId,
      typeId,
      name,
      parentId,
    });
  }

  const dirSul = await ensureUnit(dirType.id, 'Diretoria Sul', null);
  const regSP = await ensureUnit(regType.id, 'Regional SP', dirSul.id);
  const teamEnterprise = await ensureUnit(
    teamType.id,
    'Equipe Enterprise',
    regSP.id,
  );
  const teamMidMarket = await ensureUnit(
    teamType.id,
    'Equipe Mid-Market',
    regSP.id,
  );

  // Vínculo por role. Regra:
  //   DIRETOR_COMERCIAL → Diretoria Sul MANAGER isPrimary
  //   GESTOR (1º)      → Regional SP MANAGER isPrimary
  //   ANALISTAs        → distribuídos entre Enterprise/MidMarket MEMBER isPrimary
  //   ADMIN            → Diretoria Sul MEMBER sem isPrimary (observador)
  //
  // Nota A1 backfill: quando SALES_STRUCTURE_ENABLED flip pra true em
  // tenants existentes, migration 0031 já criou unit "Padrão" com todos
  // users isPrimary=true. Ao migrar esses users pra estas units demo,
  // addMember desmarca a primary anterior (transação A5).
  const dirComercial = users.find((u) => u.role === 'DIRETOR_COMERCIAL');
  const gestores = users.filter((u) => u.role === 'GESTOR');
  const analistas = users.filter((u) => u.role === 'ANALISTA');

  if (dirComercial) {
    await SalesStructureService.addMember({
      unitId: dirSul.id,
      userId: dirComercial.id,
      role: 'MANAGER',
      tenantId,
      assignedBy: admin.id,
      isPrimary: true,
    });
  }
  const firstGestor = gestores[0];
  if (firstGestor) {
    await SalesStructureService.addMember({
      unitId: regSP.id,
      userId: firstGestor.id,
      role: 'MANAGER',
      tenantId,
      assignedBy: admin.id,
      isPrimary: true,
    });
  }
  for (let i = 0; i < analistas.length; i++) {
    const analista = analistas[i]!;
    const targetUnit = i % 2 === 0 ? teamEnterprise : teamMidMarket;
    await SalesStructureService.addMember({
      unitId: targetUnit.id,
      userId: analista.id,
      role: 'MEMBER',
      tenantId,
      assignedBy: admin.id,
      isPrimary: true,
    });
  }
  await SalesStructureService.addMember({
    unitId: dirSul.id,
    userId: admin.id,
    role: 'MEMBER',
    tenantId,
    assignedBy: admin.id,
    isPrimary: false,
  });
}
