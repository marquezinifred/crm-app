# Sprint 15H — Metas por Unidade + Reconcile de Approvals

**Estimativa:** 8-10 dias úteis · **Spec versão inicial:** 2026-07-08
**Migration:** 0032 (approvals) + 0033 (metas)
**Pré-requisitos:**
- ✅ Sprint 15G Fases 1-3 mergidas + QA verde
- 🟡 Sprint 15G Fase 4 em desenvolvimento (paralelo — não bloqueia início do 15H)
- 🟡 Sprint 15G rollout prod em curso

---

## 1. Objetivo

Fechar dois débitos naturais pós-15G:

**Bloco A — Reconcile de Approvals (P-77):**
Approvals persistem `approver_id` fixo no momento da criação. Quando role/rule/user
muda, approvals ficam "órfãs" — o novo approver correto não vê em `/approvals`,
o antigo pode ver. Detectado em produção durante diagnóstico do P-67 no tenant
`acme-tech`. Precisa mecanismo de reconciliação.

**Bloco B — Metas/Quotas por Unidade:**
Aproveita infra 15G (SalesUnitRepository + resolveOpportunityScope). Permite
admin definir target por unidade + período. UI de dashboard drill-down por nível
mostra progresso vs meta. Feature de negócio pedida pelo PO no discovery inicial
do 15G ("MSprint 15H" na spec).

Sub-bloco C (menor): estender `opportunities.list` com `owner.primaryUnit.name`
pra alimentar badge da Fase 4b (débito registrado).

## 2. O que NÃO entra

- Roll-up de metas cross-nível (Diretoria vê soma das Regionais) — Sprint 15I
- Alertas automáticos por atingimento < X% da meta — Sprint 15I
- Comissões calculadas com base em meta — feature separada (roadmap)
- UI de "orphaned approvals" complexa (só básica pra ADMIN reconciliar manualmente)

---

## 3. Bloco A — Reconcile de Approvals (P-77)

### 3.1. Decisão de arquitetura (fase 1 do chip)

Chip A escolhe entre 2 caminhos, documenta no commit:

**Caminho A1 — Worker daily reconcile** ⭐ recomendado
- Job BullMQ `approvals-reconcile` roda 03:00 BRT diário
- Pra cada Approval PENDING: verifica se `approver_user.role` (ou `cachedPermissions`)
  ainda satisfaz a rule original
- Se NÃO: marca `status='ORPHANED'` + notifica admin
- **Vantagem:** simples, sem hook nas mutations
- **Custo:** approvals órfãs sobrevivem até 24h

**Caminho A2 — Re-execução ativa**
- `Approval` ganha `applicableRuleId` (snapshot da rule aplicada)
- Hooks em `approval-rules.update`, `users.updateRole`, `users.deactivate`:
  disparam worker `approvals-reevaluate` no rule/user afetado
- **Vantagem:** reajuste em segundos
- **Custo:** mais superfície, mais risco de race conditions

**Recomendação spec:** Caminho A1 pra 15H. A2 fica pra Sprint 15I se pressão
de tempo dos approvers ficar crítica.

### 3.2. Schema (migration 0032)

```prisma
// Novos campos em Approval:
model Approval {
  // ... campos existentes ...
  applicableRuleId  String?    @map("applicable_rule_id") @db.Uuid
  applicableRule    ApprovalRule? @relation("ApplicableRule", fields: [applicableRuleId], references: [id], onDelete: SetNull)
  orphanedAt        DateTime?  @map("orphaned_at")
  orphanedReason    String?    @map("orphaned_reason")

  @@index([status, tenantId])  // pra reconcile job listar PENDING rápido
}

// Enum atualizado
enum ApprovalStatus {
  PENDING
  APPROVED
  REJECTED
  CHANGES_REQUESTED
  ORPHANED  // NOVO
}
```

Migration 0032:
- ADD COLUMN `applicable_rule_id` UUID nullable + FK
- ADD COLUMN `orphaned_at` timestamptz nullable
- ADD COLUMN `orphaned_reason` text nullable
- ALTER TYPE enum ApprovalStatus ADD VALUE 'ORPHANED' (pattern migration-pitfalls #1)
- CREATE INDEX approvals_status_tenant_id_idx ON approvals (status, tenant_id) WHERE status = 'PENDING'
- Backfill best-effort: `UPDATE approvals SET applicable_rule_id = (query) WHERE applicable_rule_id IS NULL`
  — se não conseguir mapear, deixa NULL

### 3.3. Service `approval-reconcile.service.ts` (novo)

```typescript
export async function reconcileApprovalsForTenant(tenantId: string) {
  const orphaned: string[] = [];
  const notified: string[] = [];

  // Query approvals PENDING do tenant
  const pending = await prisma.approval.findMany({
    where: { tenantId, status: 'PENDING', deletedAt: null },
    include: { approver: true, applicableRule: true },
  });

  for (const app of pending) {
    // Se rule foi deletada ou approver não bate mais → ORPHANED
    let shouldOrphan = false;
    let reason = '';

    if (!app.applicableRule) {
      shouldOrphan = true;
      reason = 'rule_deleted';
    } else if (app.applicableRule.approverRoles.length > 0 && !app.applicableRule.approverRoles.includes(app.approver.role)) {
      shouldOrphan = true;
      reason = 'approver_role_no_longer_matches_rule';
    } else if (app.applicableRule.approverPermission) {
      const has = await hasPermission(app.approverId, app.applicableRule.approverPermission);
      if (!has) {
        shouldOrphan = true;
        reason = 'approver_permission_revoked';
      }
    }

    if (!app.approver.active || app.approver.deletedAt) {
      shouldOrphan = true;
      reason = 'approver_inactive';
    }

    if (shouldOrphan) {
      await prisma.approval.update({
        where: { id: app.id },
        data: {
          status: 'ORPHANED',
          orphanedAt: new Date(),
          orphanedReason: reason,
        },
      });
      await audit({
        action: 'approval.orphaned',
        tableName: 'approvals',
        recordId: app.id,
        tenantIdOverride: tenantId,
        after: { reason, previousApproverId: app.approverId },
      });
      orphaned.push(app.id);
    }
  }

  // Notificar admin do tenant se houver órfãs novas
  if (orphaned.length > 0) {
    await notifyAdminOrphanedApprovals(tenantId, orphaned);
    notified.push(tenantId);
  }

  return { orphaned: orphaned.length, notified: notified.length };
}
```

### 3.4. Worker `approvals-reconcile.worker.ts` (novo)

- Registrado em `src/jobs/index.ts` com job recorrente diário 03:00 BRT (padrão Sprint 3)
- Loop por tenant ativo → chama `reconcileApprovalsForTenant`
- Best-effort — falha em 1 tenant não bloqueia outros

### 3.5. UI mínima `/admin/approvals-orphaned` (nova, gated `sales_structure:read` OU nova permission `approval:reconcile`)

- Lista approvals ORPHANED com badge motivo (colorido por severidade)
- Cada linha: botão "Rejeitar" (dispara audit) OU "Re-atribuir" (chama engine com rule atual pra achar novo approver)
- Sidebar item novo em Admin, gated

### 3.6. Feature flag

`APPROVAL_RECONCILE_ENABLED: envBoolean(false)` — só ativa em prod pós smoke test.

### 3.7. Testes
- `tests/unit/approval-reconcile-service.test.ts` — 10+ casos (rule deleted, role changed, permission revoked, user inactive, all fine)
- `tests/integration/approval-reconcile-worker.test.ts` gated por `DATABASE_URL_TEST` — cria 4 approvals nas 4 configs de órfã + worker roda + marca corretamente

---

## 4. Bloco B — Metas por Unidade

### 4.1. Schema (migration 0033)

```prisma
model SalesQuota {
  id        String   @id @default(uuid()) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  unitId    String   @map("unit_id") @db.Uuid
  period    String   // formato "YYYY-QN" ou "YYYY-MM" (config tenant)
  targetValue Decimal @map("target_value") @db.Decimal(15, 2)
  currency  String   @default("BRL")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  createdBy String?  @map("created_by") @db.Uuid
  deletedAt DateTime? @map("deleted_at")

  tenant Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  unit   SalesUnit @relation(fields: [unitId], references: [id], onDelete: Cascade)

  @@unique([tenantId, unitId, period])  // 1 meta por (unit, period)
  @@index([tenantId, period])
  @@map("sales_quotas")
}

model Tenant {
  // ... campos existentes ...
  quotaPeriodType String @default("QUARTERLY")  // QUARTERLY|MONTHLY|SEMIANNUAL|ANNUAL
}
```

Migration 0033:
- CREATE TABLE `sales_quotas` com RLS default policy
- ADD COLUMN `tenants.quota_period_type` text default 'QUARTERLY'
- Índices GiST descartados (não precisa — só filtro por tenant + period + unit)

### 4.2. Service `quota.service.ts` (novo)

```typescript
export const QuotaService = {
  // Progresso: opps WON do período dentro do subtree da unit
  async computeQuotaProgress(unitId: string, period: string, tenantId: string) {
    const unit = await prisma.salesUnit.findFirst({ where: { id: unitId, tenantId } });
    if (!unit) throw new TRPCError({ code: 'NOT_FOUND' });

    const memberIds = await SalesUnitRepository.getSubtreeMemberIds(
      // pequeno truque: passar unit.owner virtual = MANAGER dela mesma
      unit.id, tenantId
    );
    // Simpler: query direta users em members da subtree
    const memberIdsFromSubtree = await prisma.$queryRaw`
      SELECT DISTINCT m.user_id
      FROM sales_unit_members m
      JOIN sales_units su ON su.id = m.unit_id
      WHERE su.path <@ ${unit.path}::ltree
        AND su.tenant_id = ${tenantId}::uuid
    `;

    const wonInPeriod = await prisma.opportunity.aggregate({
      where: {
        tenantId,
        ownerId: { in: memberIdsFromSubtree },
        stage: 'CONTRATO',
        status: 'WON',
        // filter por period: converter "2026-Q3" pra date range
      },
      _sum: { closedValue: true },
    });

    const quota = await prisma.salesQuota.findFirst({
      where: { tenantId, unitId, period, deletedAt: null },
    });

    return {
      unitId,
      unitName: unit.name,
      period,
      target: quota?.targetValue ?? 0,
      actual: wonInPeriod._sum.closedValue ?? 0,
      progressPct: quota ? (Number(wonInPeriod._sum.closedValue) / Number(quota.targetValue)) * 100 : null,
    };
  },
};
```

### 4.3. Router `quotas` novo (7 procedures)

- `listByPeriod` (sales_structure:read) — todas as metas do tenant no período
- `getByUnit` (sales_structure:read) — meta + progresso de 1 unit
- `create/update/delete` (sales_structure:manage) — CRUD
- `dashboardTree` — árvore com meta + progresso por nível (pra UI drill-down)
- `updatePeriodType` (adminOnly) — muda `tenant.quotaPeriodType`

### 4.4. UI `/admin/sales-quotas` + drill-down `/reports/quota-tree`

- `/admin/sales-quotas` — tabela CRUD (unit + period + target)
- `/reports/quota-tree` — árvore visual com progress bar por nível

### 4.5. Feature flag

`SALES_QUOTAS_ENABLED: envBoolean(false)`.

### 4.6. Testes
- `quota-service.test.ts` — 8+ casos (progresso por unit, subtree N-nível, período correto, sem meta configurada)
- `quotas-router.test.ts` — 12+ casos (CRUD + RBAC + cross-tenant)

---

## 5. Bloco C (menor) — Estender `opportunities.list` com `owner.primaryUnit.name`

Débito registrado na Fase 4b. Extensão simples do include existente:

```typescript
// src/server/trpc/routers/opportunities.ts list procedure
opportunities.list.query(...):
  include: {
    // ... existente ...
    owner: {
      select: {
        id: true,
        fullName: true,
        salesUnitMemberships: {
          where: { isPrimary: true },
          include: { unit: { select: { name: true } } },
          take: 1,
        },
      },
    },
  }
```

Frontend consome `opp.owner.salesUnitMemberships[0]?.unit.name` e passa como
`ownerUnitName` prop pro OpportunityCard (Fase 4b já suporta).

Testes: 3+ casos verificando shape do include.

---

## 6. Rollout Sprint 15H em prod

1. Deploy código com `APPROVAL_RECONCILE_ENABLED=false` E `SALES_QUOTAS_ENABLED=false`
2. Migrations 0032 + 0033 via `prisma migrate deploy`
3. Rodar `approvals-reconcile` uma vez em modo dry-run (log only, sem UPDATE) pra ver quantos órfãs seriam marcados
4. Ativar `APPROVAL_RECONCILE_ENABLED=true` (worker começa a rodar diário)
5. Monitorar 48h — audit_logs `action='approval.orphaned'` deve gerar entradas razoáveis
6. UI `/admin/approvals-orphaned` disponível
7. Ativar `SALES_QUOTAS_ENABLED=true` quando admin quiser começar a configurar metas
8. UI de dashboard `/reports/quota-tree` disponível

---

## 7. Decomposição por chip (Modo B)

**Fase 1 (paralela):**
- **Chip 1a**: Migration 0032 (schema approvals) + service + worker + feature flag
- **Chip 1b**: Migration 0033 (schema quotas) + service base

**Fase 2 (paralela após Fase 1):**
- **Chip 2a**: Router `approvals-reconcile` + UI `/admin/approvals-orphaned`
- **Chip 2b**: Router `quotas` (7 procedures) + testes

**Fase 3 (paralela após Fase 2):**
- **Chip 3a**: UI `/admin/sales-quotas` (CRUD)
- **Chip 3b**: UI `/reports/quota-tree` (drill-down)
- **Chip 3c**: Extensão `opportunities.list` com owner.primaryUnit + integração badge Fase 4b

Total: **8 chips em 3 fases + 3 QAs Modo B**. Esforço agregado ~10 dias.

---

## 8. Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| Worker reconcile marca approvals válidas como ORPHANED por bug | Feature flag OFF em prod até smoke test; dry-run mode inicial log-only |
| Migration 0032 `ALTER TYPE ADD VALUE` bloqueante em Postgres antigo | Padrão migration-pitfalls #1 (RENAME_old + cast); Postgres 12+ suporta ADD VALUE non-blocking |
| Rollup de metas cross-nível não implementado no 15H | Explicitado no §2 "não entra"; Sprint 15I |
| `computeQuotaProgress` query pesada em tenants grandes | Índice `(tenantId, period)` + agregação limitada por período específico |
| Race condition em CRUD de quota simultâneo | UNIQUE constraint `(tenantId, unitId, period)` bloqueia duplicata |

---

## 9. Rollback

- Reconcile: setar `APPROVAL_RECONCILE_ENABLED=false` — worker para, approvals já marcadas ORPHANED ficam como estão (rejeitar manualmente ou re-atribuir via UI)
- Quotas: setar `SALES_QUOTAS_ENABLED=false` — routers respondem com feature disabled; UI oculta

Migrations 0032/0033 ficam no DB (tabelas ficam vazias/inertes). Rollback pesado exige revert migration reversa em `prisma/migrations/XXXX_revert/`.

---

## 10. Estado atual (2026-07-08)

- **Backlog Sprint 15H:** este documento
- **Chip prompts:** aguardando conclusão da Fase 4 do 15G pra spawnar
- **Dependências satisfeitas:**
  - ✅ Sprint 15E RBAC granular
  - ✅ Sprint 15G Fases 1-3 backend (SalesUnitRepository, SalesStructureService)
  - 🟡 Sprint 15G Fase 4 (UI) em desenvolvimento — não bloqueia backend do 15H
  - 🟡 Sprint 15G rollout prod (independe do início do 15H em dev)

- **Próximo:** aguardar Fase 4 15G + rollout prod estabilizar 48h antes de spawn primeiros chips 15H.
