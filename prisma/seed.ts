/* eslint-disable no-console */
/**
 * Seed — Sprint 0
 *
 * 3 tenants × 20 empresas × 50 contatos × 30 oportunidades nos 7 estágios +
 * usuários cobrindo todos os perfis + datas importantes + tarefas e atividades
 * mínimas para popular o pipeline.
 *
 * Como rodar:
 *   npm run db:seed           # somente seed (banco já migrado)
 *   npx prisma migrate reset  # reset + migrate + seed automático
 *
 * Em dev, assume conexão Postgres com BYPASSRLS (owner do schema).
 * Em ambientes produtivos, NUNCA rode este seed.
 */

import { faker } from '@faker-js/faker';
import {
  PrismaClient,
  CompanyType,
  ContactSeniority,
  ContactRelationshipType,
  ContactFunction,
  WorkArea,
  ProductType,
  OpportunityStage,
  OpportunityStatus,
  OpportunitySource,
  TaskStatus,
  TaskPriority,
  UserRole,
  TenantPlan,
  AIProvider,
  ImportantDateEntityType,
  DateType,
  ActivityType,
  ApprovalRuleCriteria,
  Prisma,
} from '@prisma/client';
import { runAsSystem } from '../src/server/db/tenant-context';

faker.seed(20260101);
faker.setDefaultRefDate('2026-06-27T12:00:00Z');

const prisma = new PrismaClient();

const STAGES: OpportunityStage[] = [
  'PROSPECT',
  'LEAD',
  'OPORTUNIDADE',
  'PROPOSTA',
  'NEGOCIACAO',
  'ACEITE',
  'CONTRATO',
];

const TENANTS = [
  {
    slug: 'acme-tech',
    name: 'Acme Tecnologia Ltda',
    plan: TenantPlan.PRO,
    centralCrmEmail: 'crm@acme-tech.com.br',
    territories: ['Sudeste', 'Sul', 'Norte', 'Nordeste'],
    segments: ['SaaS', 'Indústria', 'Varejo', 'Saúde', 'Financeiro'],
  },
  {
    slug: 'beta-consultoria',
    name: 'Beta Consultoria & Estratégia',
    plan: TenantPlan.STARTER,
    centralCrmEmail: 'comercial@beta-consultoria.com',
    territories: ['SP Capital', 'SP Interior', 'Rio de Janeiro'],
    segments: ['Consultoria', 'Educação', 'Energia', 'Logística'],
  },
  {
    slug: 'gamma-industria',
    name: 'Gamma Indústria S/A',
    plan: TenantPlan.TRIAL,
    centralCrmEmail: 'vendas@gamma-industria.com.br',
    territories: ['Mercosul', 'América Latina'],
    segments: ['Indústria pesada', 'Automotivo', 'Energia'],
  },
];

const ROLES_TO_SEED: UserRole[] = [
  'ADMIN',
  'DIRETOR_COMERCIAL',
  'DIRETOR_FINANCEIRO',
  'GESTOR',
  'GESTOR',
  'ANALISTA',
  'ANALISTA',
  'ANALISTA',
  'PARCEIRO',
];

const PRODUCTS = [
  { name: 'Implementação CRM', type: ProductType.PROJETO_ESCOPO_FECHADO, minMarginPct: 30 },
  { name: 'Squad de Desenvolvimento', type: ProductType.PROJETO_SQUAD, minMarginPct: 35 },
  { name: 'Alocação Sênior FullStack', type: ProductType.ALOCACAO, minMarginPct: 45 },
  { name: 'Licença SaaS Anual', type: ProductType.PRODUTO, minMarginPct: 65 },
  { name: 'Consultoria Estratégica', type: ProductType.OUTRO, minMarginPct: 40 },
];

async function clean(): Promise<void> {
  console.log('🧹 Limpando dados existentes...');
  // Ordem inversa de dependência. Tudo em CASCADE pelo tenant, mas para ser
  // explícito e evitar surpresas em RLS:
  await prisma.$executeRawUnsafe('TRUNCATE TABLE alert_logs, ai_usage_logs, audit_logs RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE embeddings RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE document_versions, documents RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE partner_engagements, partner_tc_acceptances, partner_links RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE contract_installments, contracts RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE approvals, proposal_versions, proposals RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE tasks, activities, opportunity_stage_history, opportunity_team, opportunities RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE products, important_dates, contacts, companies RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE territories, segments, user_access_logs, users RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE tenants RESTART IDENTITY CASCADE');
}

function pickOne<T>(arr: readonly T[]): T {
  const idx = faker.number.int({ min: 0, max: arr.length - 1 });
  const v = arr[idx];
  if (v === undefined) throw new Error('pickOne em array vazio');
  return v;
}

async function seedTenant(tenantSpec: (typeof TENANTS)[number]): Promise<void> {
  console.log(`\n🏢 Tenant: ${tenantSpec.name}`);

  const tenant = await prisma.tenant.create({
    data: {
      slug: tenantSpec.slug,
      name: tenantSpec.name,
      plan: tenantSpec.plan,
      centralCrmEmail: tenantSpec.centralCrmEmail,
      alertLeadDays: [7, 1],
      taskOverdueDays: 2,
      aiProvider: AIProvider.ANTHROPIC,
      aiModel: 'claude-haiku-4-5-20251001',
    },
  });

  // Setamos o tenant ativo para que as próximas escritas sejam reconhecidas
  // pela extension (que injeta tenantId) e pelo RLS (caso esteja ativo).
  await prisma.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenant.id}'`);

  // Territórios e segmentos
  const territories = await Promise.all(
    tenantSpec.territories.map((name) =>
      prisma.territory.create({ data: { tenantId: tenant.id, name } }),
    ),
  );
  const segments = await Promise.all(
    tenantSpec.segments.map((name) =>
      prisma.segment.create({ data: { tenantId: tenant.id, name } }),
    ),
  );

  // Produtos
  for (const p of PRODUCTS) {
    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: p.name,
        type: p.type,
        minMarginPct: p.minMarginPct,
        sku: faker.string.alphanumeric({ length: 8, casing: 'upper' }),
      },
    });
  }

  // Approval rules default — margem < 15% e deals > R$ 500k exigem diretor
  await prisma.approvalRule.create({
    data: {
      tenantId: tenant.id,
      name: 'Margem abaixo de 15%',
      criteria: ApprovalRuleCriteria.MIN_MARGIN_BELOW,
      thresholdNumeric: 15,
      approverRoles: ['DIRETOR_COMERCIAL', 'DIRETOR_FINANCEIRO'],
    },
  });
  await prisma.approvalRule.create({
    data: {
      tenantId: tenant.id,
      name: 'Faturamento acima de R$ 500.000',
      criteria: ApprovalRuleCriteria.TOTAL_VALUE_ABOVE,
      thresholdNumeric: 500_000,
      approverRoles: ['DIRETOR_COMERCIAL'],
    },
  });

  // Platform Owner global — apenas no primeiro tenant rodar (Sprint 15A).
  // Em prod use `prisma/seed-platform.ts` em vez disso.
  if (tenantSpec.slug === 'acme-tech') {
    await prisma.user.create({
      data: {
        tenantId: null,
        clerkId: null,
        email: 'platform@crm.local',
        fullName: 'Platform Owner (seed)',
        role: UserRole.ADMIN,
        platformRole: 'PLATFORM_OWNER',
      } as Prisma.UserUncheckedCreateInput,
    });
  }

  // Usuários do tenant
  const users = [
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `admin@${tenantSpec.slug}.com.br`,
        fullName: faker.person.fullName(),
        role: UserRole.ADMIN,
      },
    }),
  ];
  for (const role of ROLES_TO_SEED) {
    users.push(
      await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: faker.internet.email({ provider: `${tenantSpec.slug}.com.br` }).toLowerCase(),
          fullName: faker.person.fullName(),
          role,
        },
      }),
    );
  }

  // 20 empresas com mix de tipos
  const companies = [];
  for (let i = 0; i < 20; i++) {
    const type =
      i === 0
        ? CompanyType.OWN
        : i < 4
          ? CompanyType.PARTNER
          : i < 6
            ? CompanyType.SUPPLIER
            : CompanyType.CLIENT;
    companies.push(
      await prisma.company.create({
        data: {
          tenantId: tenant.id,
          type,
          razaoSocial:
            i === 0
              ? tenantSpec.name
              : `${faker.company.name()} ${pickOne(['Ltda', 'S/A', 'EIRELI', 'ME'])}`,
          nomeFantasia: i === 0 ? tenantSpec.name : faker.company.name(),
          cnpj: faker.string.numeric(14),
          state: faker.location.state({ abbreviated: true }),
          city: faker.location.city(),
          territoryId: pickOne(territories).id,
          segmentId: pickOne(segments).id,
          email: faker.internet.email().toLowerCase(),
          phone: `+55 11 9${faker.string.numeric(4)}-${faker.string.numeric(4)}`,
          website: faker.internet.url(),
          createdBy: users[0]!.id,
        },
      }),
    );
  }

  // Datas importantes para empresas (fundação)
  for (const co of companies.slice(0, 10)) {
    await prisma.importantDate.create({
      data: {
        tenantId: tenant.id,
        entityType: ImportantDateEntityType.COMPANY,
        entityId: co.id,
        dateType: DateType.FUNDACAO,
        label: 'Aniversário de fundação',
        dateValue: faker.date.past({ years: 30 }),
        alertActive: true,
      },
    });
  }

  // 50 contatos
  const contacts = [];
  for (let i = 0; i < 50; i++) {
    const co = pickOne(companies);
    const name = faker.person.fullName();
    contacts.push(
      await prisma.contact.create({
        data: {
          tenantId: tenant.id,
          companyId: co.id,
          fullName: name,
          email: faker.internet
            .email({ firstName: name.split(' ')[0] })
            .toLowerCase(),
          phone: `+55 11 9${faker.string.numeric(4)}-${faker.string.numeric(4)}`,
          position: pickOne([
            'Diretor Comercial',
            'Gerente de TI',
            'Coordenador de Compras',
            'Analista de Marketing',
            'VP de Operações',
            'CEO',
            'CTO',
            'Head de Produto',
          ]),
          function: pickOne([
            ContactFunction.DIRETOR_ADMINISTRATIVO,
            ContactFunction.DIRETOR_OPERACOES,
            ContactFunction.GERENTE_PROJETOS,
            ContactFunction.GERENTE_SERVICOS,
            ContactFunction.GERENTE_GERAL,
            ContactFunction.CONSULTOR,
            ContactFunction.ESPECIALISTA,
          ]),
          seniority: pickOne([
            ContactSeniority.PROPRIETARIO,
            ContactSeniority.DIRETOR,
            ContactSeniority.GERENTE,
            ContactSeniority.COORDENADOR,
            ContactSeniority.ANALISTA,
          ]),
          workArea: pickOne([
            WorkArea.COMERCIAL,
            WorkArea.MARKETING,
            WorkArea.COMPRAS,
            WorkArea.USUARIO_SERVICOS_PRODUTOS,
          ]),
          relationshipType: ContactRelationshipType.CLIENTE,
          createdBy: users[0]!.id,
        },
      }),
    );
  }

  // Datas de aniversário para metade dos contatos
  for (const ct of contacts.slice(0, 25)) {
    await prisma.importantDate.create({
      data: {
        tenantId: tenant.id,
        entityType: ImportantDateEntityType.CONTACT,
        entityId: ct.id,
        dateType: DateType.ANIVERSARIO,
        label: 'Aniversário',
        dateValue: faker.date.birthdate({ min: 22, max: 65, mode: 'age' }),
        alertActive: true,
      },
    });
  }

  // 30 oportunidades distribuídas pelos 7 estágios
  const clientCompanies = companies.filter((c) => c.type === CompanyType.CLIENT);
  const partnerCompanies = companies.filter((c) => c.type === CompanyType.PARTNER);
  for (let i = 0; i < 30; i++) {
    const stage = STAGES[i % STAGES.length]!;
    const client = pickOne(clientCompanies);
    const owner = pickOne(users.filter((u) => u.role !== UserRole.PARCEIRO));
    const value = faker.number.int({ min: 5_000, max: 350_000 });
    const opp = await prisma.opportunity.create({
      data: {
        tenantId: tenant.id,
        title: `${pickOne(['Implementação', 'Renovação', 'Expansão', 'Piloto', 'Prova de Conceito'])} — ${client.nomeFantasia}`,
        clientCompanyId: client.id,
        partnerCompanyId: i % 5 === 0 && partnerCompanies.length > 0 ? pickOne(partnerCompanies).id : null,
        ownerId: owner.id,
        stage,
        status: OpportunityStatus.ACTIVE,
        estimatedValue: value,
        expectedCloseDate: faker.date.future({ years: 1 }),
        source: pickOne([
          OpportunitySource.INDICACAO,
          OpportunitySource.INBOUND,
          OpportunitySource.EVENTO,
          OpportunitySource.OUTBOUND,
          OpportunitySource.PARCEIRO,
        ]),
        description: faker.lorem.paragraph(),
        createdBy: owner.id,
      },
    });

    // Histórico simples: registro do estágio inicial
    await prisma.opportunityStageHistory.create({
      data: {
        tenantId: tenant.id,
        opportunityId: opp.id,
        fromStage: null,
        toStage: stage,
        movedById: owner.id,
        note: 'Seed inicial',
      },
    });

    // Equipe — adiciona 1-2 membros
    const teamCandidates = users
      .filter((u) => u.id !== owner.id && u.role !== UserRole.PARCEIRO);
    if (teamCandidates.length > 0) {
      const teamSize = faker.number.int({ min: 1, max: Math.min(2, teamCandidates.length) });
      for (let t = 0; t < teamSize; t++) {
        const m = teamCandidates[t]!;
        try {
          await prisma.opportunityTeam.create({
            data: {
              tenantId: tenant.id,
              opportunityId: opp.id,
              userId: m.id,
              roleInTeam: pickOne(['Pré-venda', 'Tech lead', 'Conta executiva']),
            },
          });
        } catch {
          /* duplicado — ignora */
        }
      }
    }

    // Atividade manual placeholder
    await prisma.activity.create({
      data: {
        tenantId: tenant.id,
        opportunityId: opp.id,
        authorId: owner.id,
        type: ActivityType.MANUAL_NOTE,
        title: 'Primeiro contato',
        content: faker.lorem.sentences(2),
      },
    });

    // Uma tarefa por oportunidade
    await prisma.task.create({
      data: {
        tenantId: tenant.id,
        opportunityId: opp.id,
        assigneeId: owner.id,
        title: pickOne([
          'Enviar proposta inicial',
          'Agendar reunião de descoberta',
          'Confirmar disponibilidade técnica',
          'Levantar dados de faturamento',
          'Validar contrato com jurídico',
        ]),
        dueDate: faker.date.soon({ days: 14 }),
        status: pickOne([TaskStatus.TODO, TaskStatus.DOING]),
        priority: pickOne([TaskPriority.LOW, TaskPriority.MEDIUM, TaskPriority.HIGH]),
      },
    });
  }

  console.log(`   ✅ ${tenantSpec.name}: ${users.length} users, ${companies.length} companies, ${contacts.length} contacts, 30 opps`);
}

async function main(): Promise<void> {
  await runAsSystem(async () => {
    await clean();
    for (const t of TENANTS) {
      await seedTenant(t);
    }
  });
  console.log('\n🎉 Seed concluído.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
