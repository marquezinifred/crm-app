import { prisma } from '@/server/db/client';
import { runAsSystem } from '@/server/db/tenant-context';

/**
 * Checklist de configuração inicial — Sprint 13.
 *
 * 9 passos calculados por heurística (nunca exige sync manual). O step
 * marca-se `done: true` quando a presença mínima do recurso é detectada
 * no banco. `available` indica se o link de destino está disponível
 * (todos os 9 estão disponíveis hoje).
 */

export interface ChecklistStep {
  key: string;
  label: string;
  description: string;
  href: string;
  done: boolean;
  available: boolean;
}

export interface ChecklistResult {
  steps: ChecklistStep[];
  completedCount: number;
  totalCount: number;
  setupCompletedAt: Date | null;
  tourDismissedAt: Date | null;
}

export async function computeChecklist(tenantId: string): Promise<ChecklistResult> {
  return runAsSystem(async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        aiApiKeyEncrypted: true,
        inboundEmailSlug: true,
        setupCompletedAt: true,
        tourDismissedAt: true,
        settings: { select: { themeConfig: true } },
      },
    });
    if (!tenant) throw new Error('Tenant não encontrado');

    const [
      usersCount,
      companiesCount,
      productsCount,
      approvalRulesCount,
      brandingConfigured,
    ] = await Promise.all([
      prisma.user.count({ where: { tenantId, deletedAt: null, active: true } }),
      prisma.company.count({ where: { tenantId, deletedAt: null } }),
      prisma.product.count({ where: { tenantId, deletedAt: null } }),
      prisma.approvalRule.count({ where: { tenantId, deletedAt: null } }),
      Promise.resolve(Boolean(tenant.settings?.themeConfig)),
    ]);

    const territoriesCount = await prisma.territory.count({
      where: { tenantId, deletedAt: null },
    });
    const segmentsCount = await prisma.segment.count({
      where: { tenantId, deletedAt: null },
    });

    const steps: ChecklistStep[] = [
      {
        key: 'invite_users',
        label: 'Convide sua equipe',
        description: 'Convide ao menos um outro usuário para colaborar.',
        href: '/admin/users',
        done: usersCount >= 2,
        available: true,
      },
      {
        key: 'territories',
        label: 'Cadastre territórios',
        description: 'Defina territórios para segmentar empresas e oportunidades.',
        href: '/companies',
        done: territoriesCount > 0,
        available: true,
      },
      {
        key: 'segments',
        label: 'Cadastre segmentos',
        description: 'Crie segmentos de mercado para classificar empresas.',
        href: '/companies',
        done: segmentsCount > 0,
        available: true,
      },
      {
        key: 'companies',
        label: 'Cadastre suas empresas',
        description: 'Importe ou adicione manualmente clientes, parceiros e fornecedores.',
        href: '/companies',
        done: companiesCount > 0,
        available: true,
      },
      {
        key: 'products',
        label: 'Cadastre produtos/serviços',
        description: 'Liste o que você vende para usar em propostas e contratos.',
        href: '/admin/products',
        done: productsCount > 0,
        available: true,
      },
      {
        key: 'approval_rules',
        label: 'Configure regras de aprovação',
        description: 'Defina aprovadores por margem ou valor total das propostas.',
        href: '/admin/approval-rules',
        done: approvalRulesCount > 0,
        available: true,
      },
      {
        key: 'email_inbound',
        label: 'Configure e-mail inbound',
        description: 'Redirecione comunicações para anexar ao CRM automaticamente.',
        href: '/admin/email-inbound',
        done: tenant.inboundEmailSlug !== null,
        available: true,
      },
      {
        key: 'ai',
        label: 'Configure IA',
        description: 'Conecte seu provider de IA para resumir e priorizar atividades.',
        href: '/admin/ai',
        done: tenant.aiApiKeyEncrypted !== null,
        available: true,
      },
      {
        key: 'branding',
        label: 'Personalize a identidade',
        description: 'Defina paleta, logo e tipografia da sua marca.',
        href: '/admin/branding',
        done: brandingConfigured,
        available: true,
      },
    ];

    return {
      steps,
      completedCount: steps.filter((s) => s.done).length,
      totalCount: steps.length,
      setupCompletedAt: tenant.setupCompletedAt,
      tourDismissedAt: tenant.tourDismissedAt,
    };
  });
}

export async function dismissTour(tenantId: string): Promise<void> {
  await runAsSystem(() =>
    prisma.tenant.update({
      where: { id: tenantId },
      data: { tourDismissedAt: new Date() },
    }),
  );
}

export async function markSetupCompleteIfDone(tenantId: string): Promise<void> {
  const result = await computeChecklist(tenantId);
  if (
    result.completedCount === result.totalCount &&
    result.setupCompletedAt === null
  ) {
    await runAsSystem(() =>
      prisma.tenant.update({
        where: { id: tenantId },
        data: { setupCompletedAt: new Date() },
      }),
    );
  }
}
