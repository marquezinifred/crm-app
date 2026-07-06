# Prompt de Chip — Sprint 15G Estrutura Comercial

**Data:** 2026-07-06 · **Prontidão:** aguarda validação do PO nos amendments A1-A7 antes de spawn.

Este doc contém o **prompt self-contained** pra spawnar via `spawn_task` quando PO aprovar. Copiar tudo abaixo do `---` como `prompt` do `spawn_task`.

---

Sprint 15G — Estrutura Comercial e Visibilidade Hierárquica. Implementação completa em N-nível via `ltree` do Postgres. Migration 0031.

## Contexto obrigatório de leitura

1. `docs/Sprint_15G_estrutura_comercial.md` — spec original do PO (base)
2. **`docs/Sprint_15G_amendments.md`** — 7 emendas críticas A1-A7 aprovadas 2026-07-06. **LER ANTES** de aplicar spec original.
3. `docs/RBAC_OrgVisibility_Mapa_2026-07-06.md` — mapa do que existe pré-15G
4. `CLAUDE.md` §Sprint 15E — pra entender permissions-catalog, ROLE_DEFAULT_PERMISSIONS, cached_permissions, guard anti-escalada
5. Memory `migration-pitfalls.md` — 5 padrões recorrentes em migrações Postgres
6. Memory `tenant-backstop-lesson.md` — P-42 semântica de update

## Escopo — spec base + amendments obrigatórios

Aplicar spec original + as 7 emendas:

**A1** Migration 0031 executa backfill automático de estrutura mínima por tenant existente (1 unit "Padrão" nível 1, membros = users ativos, MANAGER = GESTOR/DIRETOR/ADMIN). Sem esse backfill, GESTOR passa de "vê tudo" pra "vê só próprias" no dia do deploy.

**A2** Backfill de overrides idempotente: INSERT + ON CONFLICT DO NOTHING (não UPDATE — colide com UNIQUE user_permission_overrides). Invalidar cache forçado pós-backfill (`cached_permissions_at = NULL` pros users afetados).

**A3** Reports migrados pro mesmo scope. `src/server/trpc/routers/reports.ts` remove `visibility()` local, importa `resolveOpportunityScope` do service. `loadOpps` e `loadInboundOpps` usam. Regra especial ANALISTA em `performanceByOwner` (só linha própria + teamAverage) preservada. +9 test integration.

**A4** PARCEIRO early-return em `resolveOpportunityScope`:
```typescript
if (role === 'PARCEIRO') {
  if (!partnerCompanyId) return { type: 'NONE', filter: { id: 'zero-uuid' } };
  return {
    type: 'PARTNER',
    filter: { tenantId, partnerCompanyId, partnerEngagements: { some: { partnerCompanyId, status: 'APPROVED' } } },
  };
}
```
Signature muda pra receber `role` e `partnerCompanyId` de `ctx.user`.

**A5** Partial unique index + transação pra `is_primary`:
```sql
CREATE UNIQUE INDEX sales_unit_members_one_primary_per_user
  ON sales_unit_members (user_id) WHERE is_primary = true;
```
`addMember` em `prisma.$transaction([updateMany, upsert])`.

**A6** Adicionar seção §15.1 informativa: "P-77 approvals órfãs pós-15G — Sprint 15H absorverá". Sprint 15G não muda approval engine.

**A7** CHECK constraint no path + convenção no repository:
```sql
ALTER TABLE sales_units ADD CONSTRAINT sales_units_path_not_empty
  CHECK (path::text != '' AND path::text ~ '^[a-zA-Z0-9._]+$');
```
Comment no repository: "⚠️ NUNCA `prisma.salesUnit.create()` direto — sempre `SalesUnitRepository.create()` que calcula path."

## Regras arquiteturais aplicáveis (§4 Metodologia)

- **Multi-tenancy**: toda query com `tenantId`, Prisma extension + RLS
- **Audit**: mutations com `tenantIdOverride: ctx.tenantId` (padrão P-04)
- **RBAC granular Sprint 15E**: `withPermission('sales_structure:read/manage')` — nunca `withRoles`
- **Feature flag**: adicionar `SALES_STRUCTURE_ENABLED` default `false`. `resolveOpportunityScope` respeita flag — quando false, fallback pro comportamento pré-15G (`visibilityWhere` legado). Ver P-62 (RBAC kill-switch runtime real). Rollback = flag `false`, sem redeploy.
- **envBoolean obrigatório** pra flag (§4.9): `SALES_STRUCTURE_ENABLED: envBoolean(false)`
- **Backstop tenant-isolation P-42**: `update`/`upsert.update` NÃO exigem tenantId no data — WHERE injection protege. `create` de nova unit exige.

## Checklist de fechamento (obrigatório)

Ver §3 de `docs/Metodologia_Desenvolvimento_Venzo.md`. Destaques específicos:

- [ ] Migration 0031 idempotente (backfill roda 2× sem erro)
- [ ] Feature flag `SALES_STRUCTURE_ENABLED` desliga toda mudança runtime (test: com flag `false`, baseline pré-15G preservado)
- [ ] Cache de permissions invalidado pós-backfill
- [ ] PARCEIRO passa por early-return, não pelo path nuevo
- [ ] Reports usam mesma `resolveOpportunityScope`
- [ ] `sales_units_one_primary_per_user` bloqueia race condition
- [ ] `CHECK sales_units_path_not_empty` bloqueia path vazio
- [ ] Seed de demonstração (3 níveis: Diretoria → Regional → Equipe)
- [ ] Testes: 12+ unit (visibility 12, ltree-path 6) + 5 integration + 3 E2E = 20+ total
- [ ] Baseline preserve: pré-chip 944/0/174 (atual pós P-65+P-66) — chip pode SÓ ADICIONAR testes, não regredir
- [ ] Type-check zero. Lint zero
- [ ] `docs/Backlog_Pos_MVP.md` marca Sprint 15G como ✅ FECHADO com commit hash
- [ ] `CLAUDE.md` ganha bloco Sprint 15G no topo
- [ ] `docs/Roteiro_QA_Homologacao_Staging.md` ganha cenários pass/fail: (a) admin cria unidade + adiciona membro; (b) GESTOR vê equipe; (c) DIRETOR vê tudo; (d) ANALISTA vê próprias; (e) PARCEIRO preserved

## Entrega

- Commits na branch `claude/sprint-15g-estrutura-comercial`
- **NÃO fazer push nem PR** — main session merge + QA automation
- Reporte final no chat: commits, arquivos, linhas, débitos residuais identificados

## Não escopo (não fazer neste chip)

- Metas/quotas por unidade (Sprint 15H)
- Reorganização de estrutura (mover nó com filhos) — Sprint 15I ou script
- Visibilidade de Companies/Contacts por unidade — sprint futuro
- P-77 approvals órfãs — permanece aberto pra Sprint 15H

## Esforço estimado

11.6 dias (spec original 9.5 + emendas 2.1). Se ultrapassar 15 dias, sinalizar main session.
