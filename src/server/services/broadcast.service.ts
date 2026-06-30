import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';
import type { Broadcast, BroadcastTarget, TenantPlan } from '@prisma/client';

/**
 * Broadcast targeting + dismissal — Sprint 15B.
 *
 * Resolve quais broadcasts um usuário deve ver. Substitui o
 * `MaintenanceBanner` da Sprint 14.5 por targeting genérico (ALL,
 * BY_PLAN, MANUAL_LIST) + window temporal + per-user dismiss.
 *
 * `matchesTargeting()` é função pura testável.
 */

export interface TenantSnapshot {
  id: string;
  plan: TenantPlan;
}

/** Função pura: decide se o broadcast alvo se aplica ao tenant. */
export function matchesTargeting(
  b: Pick<Broadcast, 'target' | 'targetPlans' | 'targetTenantIds'>,
  tenant: TenantSnapshot,
): boolean {
  switch (b.target as BroadcastTarget) {
    case 'ALL':
      return true;
    case 'BY_PLAN':
      return b.targetPlans.includes(tenant.plan);
    case 'MANUAL_LIST':
      return b.targetTenantIds.includes(tenant.id);
    default:
      return false;
  }
}

/** Está dentro da janela `[starts_at, ends_at]`. */
export function isWithinWindow(
  b: Pick<Broadcast, 'startsAt' | 'endsAt' | 'active'>,
  now: Date = new Date(),
): boolean {
  if (!b.active) return false;
  if (b.startsAt.getTime() > now.getTime()) return false;
  if (b.endsAt && b.endsAt.getTime() < now.getTime()) return false;
  return true;
}

export async function activeForUser(input: {
  tenantId: string;
  userId: string;
}): Promise<Broadcast[]> {
  return runAsSystem(async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { id: true, plan: true },
    });
    if (!tenant) return [];

    const now = new Date();
    const all = await prisma.broadcast.findMany({
      where: {
        active: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      },
      orderBy: { startsAt: 'desc' },
    });

    const dismissedRows = await prisma.broadcastDismissal.findMany({
      where: { userId: input.userId, broadcastId: { in: all.map((b) => b.id) } },
      select: { broadcastId: true },
    });
    const dismissed = new Set(dismissedRows.map((d) => d.broadcastId));

    return all.filter(
      (b) =>
        !dismissed.has(b.id) &&
        matchesTargeting(b, { id: tenant.id, plan: tenant.plan }),
    );
  });
}

export async function dismissForUser(input: {
  broadcastId: string;
  userId: string;
}): Promise<void> {
  await runAsSystem(() =>
    prisma.broadcastDismissal.upsert({
      where: {
        broadcastId_userId: {
          broadcastId: input.broadcastId,
          userId: input.userId,
        },
      },
      create: { broadcastId: input.broadcastId, userId: input.userId },
      update: {},
    }),
  );
}

/** Preview pro Platform Owner: quantos tenants serão atingidos. */
export async function previewTargeting(input: {
  target: BroadcastTarget;
  targetPlans?: string[];
  targetTenantIds?: string[];
}): Promise<{ count: number; sampleTenants: Array<{ id: string; name: string; plan: TenantPlan }> }> {
  return runAsSystem(async () => {
    const where: Record<string, unknown> = { deletedAt: null };
    if (input.target === 'BY_PLAN') {
      where.plan = { in: input.targetPlans ?? [] };
    } else if (input.target === 'MANUAL_LIST') {
      where.id = { in: input.targetTenantIds ?? [] };
    }
    const [count, samples] = await Promise.all([
      prisma.tenant.count({ where }),
      prisma.tenant.findMany({
        where,
        select: { id: true, name: true, plan: true },
        take: 10,
      }),
    ]);
    return { count, sampleTenants: samples };
  });
}
