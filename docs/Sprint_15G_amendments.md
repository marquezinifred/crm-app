# Sprint 15G — Amendments à Spec Original
**Data:** 2026-07-06 · **Contexto:** revisão da spec `Sprint 15G — Estrutura Comercial e Visibilidade Hierárquica` (proposta pelo PO) antes de spawnar chip de implementação.

7 emendas identificadas em riscos de rollout, gaps de escopo e race conditions. Cada uma tem: **motivo**, **emenda concreta** (o que muda na spec), **onde na spec** (referência §X.Y), **impacto** (tempo/testes).

Após aprovação: emendar seções relevantes da spec original OU manter este doc como "amendments" carregado junto no chip. Recomendo o segundo — spec fica intocada, amendments são versionadas separadamente.

---

## A1. Rollout quebra visibilidade de GESTOR em tenants existentes

**Motivo.** Hoje GESTOR tem `opportunity:read_others` no default (Sprint 15E) → vê tudo do tenant. A spec 15G troca por `read_team` + `read_all` e concede só `read_team` a GESTOR. Mas tenants em produção **não têm nenhuma unidade comercial configurada**. Consequência: `getSubtreeMemberIds` retorna `[]` no dia do deploy → fallback pra `OWN` → **todo GESTOR passa de "vê tudo" pra "vê só as próprias"** até o admin do tenant configurar a estrutura.

**Emenda:** migration 0031 executa **backfill automático de estrutura mínima** por tenant existente:

```sql
-- Passo 1: cria SalesUnitType default "Equipe" (nível 1) por tenant
INSERT INTO sales_unit_types (tenant_id, name, level, color, icon)
SELECT id, 'Equipe', 1, '#6366F1', 'users'
FROM tenants
ON CONFLICT DO NOTHING;

-- Passo 2: cria SalesUnit "Padrão" raiz por tenant
INSERT INTO sales_units (tenant_id, type_id, name, short_id, path, depth, parent_id)
SELECT
  t.id,
  sut.id,
  'Equipe Padrão',
  '<gerado no service>',
  ('t' || substr(replace(t.id::text, '-', ''), 1, 8) || '.u' || substr(md5(t.id::text), 1, 7))::ltree,
  1,
  NULL
FROM tenants t
JOIN sales_unit_types sut ON sut.tenant_id = t.id AND sut.level = 1;

-- Passo 3: adiciona TODOS os users ativos como MEMBER
INSERT INTO sales_unit_members (user_id, unit_id, tenant_id, role, is_primary)
SELECT u.id, su.id, u.tenant_id, 'MEMBER', true
FROM users u
JOIN sales_units su ON su.tenant_id = u.tenant_id
WHERE u.active = true AND u.deleted_at IS NULL
  AND u.tenant_id IS NOT NULL;

-- Passo 4: promove GESTOR, DIRETOR_COMERCIAL, ADMIN, DIRETOR_OPERACOES a MANAGER
UPDATE sales_unit_members m
SET role = 'MANAGER'
FROM users u
WHERE m.user_id = u.id
  AND u.role IN ('GESTOR', 'DIRETOR_COMERCIAL', 'DIRETOR_OPERACOES', 'ADMIN');
```

**Efeito:** cada tenant começa com 1 unidade default; GESTOR + DIRETOR + ADMIN são MANAGER; ANALISTA é MEMBER. Nova regra `read_team` retorna a lista completa de members da mesma unidade → **comportamento idêntico ao pré-15G pra GESTOR**. Admin do tenant pode reorganizar depois via UI.

**Onde na spec:** §3.1 (adicionar passos 1-4 no fim da migration) e §12 (novo critério de aceite "backfill executado em cada tenant existente").

**Impacto:** +0.5 dia. Testes: migration é idempotente (ON CONFLICT nas 4 tabelas), pode rodar N vezes sem erro. E2E: verificar que baseline de visibilidade pré/pós deploy é idêntico pra GESTOR sem intervenção manual.

---

## A2. Backfill de `read_others` pode conflitar com UNIQUE `user_permission_overrides`

**Motivo.** Spec §6 propõe:
```sql
UPDATE user_permission_overrides
SET permission = 'opportunity:read_team'
WHERE permission = 'opportunity:read_others' AND action = 'granted';
DELETE FROM user_permission_overrides WHERE permission = 'opportunity:read_others';
```

Se um user tem BOTH: `read_others` como grant E `read_team` já como override (caso raro se admin manualmente concedeu, mas possível), o UPDATE viola `UNIQUE(user_id, permission)`. Sprint 15E schema tem esse índice — precisa handling.

**Emenda:** trocar por INSERT idempotente + DELETE:
```sql
-- Insere read_team pra quem tinha read_others (idempotente)
INSERT INTO user_permission_overrides (user_id, permission, action, granted_by, reason, at)
SELECT user_id, 'opportunity:read_team', action, granted_by,
       'Migrado do Sprint 15E: read_others → read_team (Sprint 15G)', now()
FROM user_permission_overrides
WHERE permission = 'opportunity:read_others'
ON CONFLICT (user_id, permission) DO NOTHING;

-- Também insere read_all pra quem tinha read_others granted (era catch-all)
INSERT INTO user_permission_overrides (user_id, permission, action, granted_by, reason, at)
SELECT user_id, 'opportunity:read_all', action, granted_by,
       'Migrado do Sprint 15E: read_others → read_all (Sprint 15G)', now()
FROM user_permission_overrides
WHERE permission = 'opportunity:read_others' AND action = 'granted'
ON CONFLICT (user_id, permission) DO NOTHING;

-- Remove read_others
DELETE FROM user_permission_overrides WHERE permission = 'opportunity:read_others';

-- Invalida cache de permissions de TODOS os users afetados
UPDATE users SET cached_permissions_at = NULL
WHERE id IN (
  SELECT user_id FROM user_permission_overrides
  WHERE reason LIKE 'Migrado do Sprint 15E%'
);
```

Cache invalidation forçada é crucial — sem isso, users continuam com `read_others` no cache e o path novo nem roda.

**Onde na spec:** §6 (substituir SQL) + §12 (critério "cache de permissions invalidado após backfill").

**Impacto:** +0.25 dia. Testes: migration testa que user com granted+revoked+catch-all vira granted+revoked pros dois novos, sem violar UNIQUE.

---

## A3. Reports não incluídos no novo escopo

**Motivo.** Spec §7 só toca `opportunities.list/count/aggregate`. Mas `src/server/trpc/routers/reports.ts` tem sua própria função `visibility()` (linhas 50-71) idêntica ao `visibilityWhere` das opportunities e é usada em `loadOpps` que alimenta 4 endpoints: `funnel`, `winLoss`, `timePerStage`, `performanceByOwner`, `revenueProjection`, e `inboundVsOutbound` (via `loadInboundOpps`).

Se `opportunities.list` migra pra `resolveOpportunityScope` mas reports ficam com `visibility()` legada, ANALISTA vê no `/reports/performance` a linha dele + team average, mas seu Kanban não mostra as outras opps porque `read_others` foi removido. Inconsistência. **Pior**: DIRETOR_COMERCIAL sem `read_all` migrado começa a ver `{}` no `visibility()` legado (bug — cai em código morto porque não tem mais o `hasPermission('opportunity:read_others')`).

**Emenda:** §7 estendida:
1. `reports.ts` remove `visibility()` local, importa `resolveOpportunityScope` do service.
2. `loadOpps` e `loadInboundOpps` chamam scope resolver com role + userId + tenantId.
3. Filtro final passa por `scope.filter` (mesma estrutura do opportunities.list).
4. ANALISTA em `performanceByOwner`: mantém regra "só linha própria + teamAverage anônimo" — não muda.
5. Adicionar test integration `reports-with-scope.test.ts` cobrindo 3 roles × 3 endpoints (9 casos).

**Onde na spec:** §7 (adicionar sub-seção "7.1 Reports"), §11.2 (adicionar 9 casos), §12 (novo critério "reports usam mesmo scope de opportunities").

**Impacto:** +0.75 dia. Reduz risco crítico de divergência entre visão pipeline vs relatórios.

---

## A4. PARCEIRO não pode passar pelo novo scope resolver

**Motivo.** Spec §5 mostra `resolveOpportunityScope` sem tratar `role === 'PARCEIRO'`. Hoje PARCEIRO tem filtro row-level rígido (`partnerCompanyId + PartnerEngagement.status=APPROVED`). Se novo service não faz early-return, PARCEIRO cai no fallback `OWN` → só vê opps que ele mesmo é `ownerId` → PARCEIRO nunca é owner → **vê zero opps**.

**Emenda:** §5, `resolveOpportunityScope`, primeiro branch:
```typescript
async resolveOpportunityScope(
  userId: string, tenantId: string, role: string, partnerCompanyId: string | null,
): Promise<OpportunityVisibilityScope> {
  if (role === 'PARCEIRO') {
    if (!partnerCompanyId) return { type: 'NONE', filter: { id: 'zero-uuid' } };
    return {
      type: 'PARTNER',
      filter: {
        tenantId,
        partnerCompanyId,
        partnerEngagements: { some: { partnerCompanyId, status: 'APPROVED' } },
      },
    };
  }
  // ... resto do fluxo com hasPermission
}
```

Signature muda pra receber `role` e `partnerCompanyId` (que já estão em `ctx.user`).

**Onde na spec:** §5 (adicionar early-return) e §12 (critério "PARCEIRO mantém filtro pré-15G").

**Impacto:** +0.25 dia. Test: adicionar em `sales-unit-visibility.test.ts` 3 casos (PARCEIRO com company + engagement / PARCEIRO com company sem engagement / PARCEIRO sem company).

---

## A5. `is_primary` sem constraint DB permite race condition

**Motivo.** Spec §5 `addMember` faz `updateMany({..., isPrimary: false}) → upsert({isPrimary: true})` sequencial, sem transação atômica. Dois writes concorrentes (admin trocando primary de dois lugares diferentes na mesma UI, ou script batch) podem resultar em 2 rows com `is_primary=true` pro mesmo user.

**Emenda:** partial unique index no schema:
```sql
-- Migration 0031 §3.1, adicionar após CREATE INDEX sales_unit_members_tenant_idx:
CREATE UNIQUE INDEX sales_unit_members_one_primary_per_user
  ON sales_unit_members (user_id)
  WHERE is_primary = true;
```

E envolver `addMember` em transação Prisma:
```typescript
await prisma.$transaction([
  prisma.salesUnitMember.updateMany({ where: { userId, tenantId, isPrimary: true }, data: { isPrimary: false } }),
  prisma.salesUnitMember.upsert({ ... }),
]);
```

**Onde na spec:** §3.1 (novo índice) + §5 (transação em `addMember`).

**Impacto:** +0.25 dia. Test: adicionar caso de concorrência simulada (2 addMember paralelos → apenas 1 primary permanece).

---

## A6. Approval engine ignora estrutura organizacional (P-77 aberto)

**Motivo.** Achado do P-67 documentado em `docs/RBAC_OrgVisibility_Mapa_2026-07-06.md` seção "Descompasso". `approval-engine.service.ts` usa `findFirst({ role, active })` sem noção de subtree. Após 15G, engine continua criando approvals fósseis quando estrutura muda, quando user é movido de unidade, ou quando role muda.

**Emenda:** Sprint 15G NÃO toca em approval engine (escopo mantido). Adicionar seção informativa:

```markdown
## §15.1 — Débito conhecido pós-15G: P-77 Approvals órfãs

Após 15G, o approval engine continua com o mesmo comportamento point-in-time do Sprint 15E.
As 4 approvals fósseis descobertas em `acme-tech` (2026-07-06) permanecem — solução operacional:
rejeitar via UI logando como users originais.

**P-77 escopo (sprint futuro, sugestão Sprint 15H):**
- Worker daily reconcile: pra cada Approval PENDING, checa se approver ainda tem
  role/permission requerida pela rule atual. Se não, marca como órfã + notifica admin.
- OU: Approval passa a persistir `applicable_rule_id` + `matched_criteria` — engine
  re-executa quando rule é editada.

Sprint 15H decide o caminho.
```

**Onde na spec:** §15 (adicionar 15.1). Também: registrar P-77 no `docs/Backlog_Pos_MVP.md`.

**Impacto:** 0 dia (docs only) no 15G. P-77 vira Sprint 15H (~2-3 dias).

---

## A7. Convenção crítica: `salesUnit` nunca acessado direto

**Motivo.** `path` é `ltree` — se alguém fizer `prisma.salesUnit.create({ data: { name, tenantId, ... } })` esquecendo o `path`, Postgres aceita `""` como ltree válido (label vazio). Índice GiST não bloqueia. Consequência silenciosa: nó órfão fora da árvore, `getSubtreeMemberIds` nunca encontra descendentes.

Prisma sync/type-check não pega isso porque `path` é `Unsupported("ltree")` do Prisma point-of-view — vira `never` no schema TS.

**Emenda em 3 partes:**

1. **Schema (§3.1):** CHECK constraint no path:
   ```sql
   ALTER TABLE sales_units ADD CONSTRAINT sales_units_path_not_empty
     CHECK (path::text != '' AND path::text ~ '^[a-zA-Z0-9._]+$');
   ```

2. **Convenção (§4):** documento explícito no repository:
   ```typescript
   /**
    * ⚠️ CONVENÇÃO: nunca fazer prisma.salesUnit.create() direto — sempre
    * SalesUnitRepository.create(), que calcula path corretamente.
    * Bypass viola CHECK constraint sales_units_path_not_empty.
    */
   ```

3. **Test (§11.1):** adicionar caso "tentar criar salesUnit direto com path vazio → CHECK constraint viola".

**Onde na spec:** §3.1 (CHECK), §4 (comment), §11.1 (test).

**Impacto:** +0.1 dia.

---

## Resumo de impacto

| Emenda | Descrição curta | Dias adicionais |
|--------|-----------------|----------------|
| A1 | Backfill de estrutura mínima por tenant | +0.5 |
| A2 | Backfill overrides idempotente + cache invalidation | +0.25 |
| A3 | Reports migrados pro novo scope | +0.75 |
| A4 | PARCEIRO early-return em resolveScope | +0.25 |
| A5 | Partial unique + transação em is_primary | +0.25 |
| A6 | P-77 documentado como débito pós-15G | 0 |
| A7 | CHECK constraint + convenção no path | +0.1 |
| **Total emendas** | | **~2.1 dias** |
| **Total revisado 15G** | Original 9.5 + emendas 2.1 | **~11.6 dias** |

Se 15H (metas) segue depois, P-77 pode ser absorvido lá com +2-3 dias.

---

## Ação recomendada

1. **PO valida amendments** — se concorda com A1–A7, doc vira parte da spec.
2. Chip Sprint 15G spawned com prompt referenciando **AMBAS**: `Sprint_15G_Estrutura_Comercial.md` (spec original) + `Sprint_15G_amendments.md` (este doc).
3. P-77 registrado no `docs/Backlog_Pos_MVP.md` como débito planejado Sprint 15H.

## Riscos residuais (aceitos)

- **Reorganização de estrutura** (mover nó com filhos): não coberto em 15G. Aceito pelo PO. Se emergir demanda antes de 15H, escapa via seed script/suporte.
- **Companies/Contacts com scope**: fora do 15G. Aceito. Consequência: GESTOR de equipe pode ver opp de empresa que ele não vê na lista de empresas. UX gap pequeno mas presente.
- **Cache invalidation em cascata**: se admin muda `parentId` de uma unidade (não suportado em 15G), cache dos users afetados fica stale. Mitigado por escopo.
