# Prompt de Chip — P-77 Approvals Órfãs

**Data:** 2026-07-06 · **Prontidão:** spawnar quando Sprint 15G estiver em prod estabilizado OU antes se ficar crítico.

Este doc contém o prompt self-contained pra `spawn_task`. Copiar tudo abaixo do `---`.

---

Fix arquitetural P-77 — approvals ficam órfãs quando role/rule/estrutura muda.

## Contexto

Descoberto durante diagnóstico P-67 em 2026-07-06 no tenant `acme-tech`. 4 approvals PENDING apontavam pra della.block36 (ANALISTA) e marquise_ritchie68 (GESTOR) mas as 2 rules ativas apontavam pra `{DIRETOR_COMERCIAL, DIRETOR_FINANCEIRO}` e `{DIRETOR_COMERCIAL}`. Nenhuma approval batia com role da rule atual.

Audit log de `approval_rules` vazio — rules nunca foram editadas via UI. Causa provável: seed antigo criou approvals com roles diferentes, ou role dos users della/marquise mudou depois. Impossível diagnosticar sem histórico.

**Bug arquitetural:** Approvals persistem `approver_id` fixo no momento da criação. Nem engine legado (`approver_roles → findFirst({role})`) nem novo (`approver_permission → findMany({cachedPermissions has 'X'})`) re-avalia quando:
- Role do approver muda
- Rule é editada
- User é desativado/removido
- (Pós-15G) User é movido de unidade organizacional

## Contexto obrigatório de leitura

1. `docs/Backlog_Pos_MVP.md` P-77 (bloco completo com anatomia + fix caminhos)
2. `docs/RBAC_OrgVisibility_Mapa_2026-07-06.md` seção "Descompasso RBAC dinâmico × Approvals snapshot"
3. `src/server/services/approval-engine.service.ts` inteiro (242 linhas)
4. `src/server/trpc/routers/proposals.ts:194-258` (approvalsRouter — myPending, decide)
5. `CLAUDE.md` §Sprint 8 (approval engine original)

## Escopo — decisão de arquitetura na primeira sub-etapa

**Antes de codar**, chip decide entre 2 caminhos (documentar decisão no commit):

### Caminho A — Worker daily reconcile
- Novo job BullMQ `approvals-reconcile` roda diariamente 03:00 BRT
- Pra cada `Approval` com `status=PENDING` no tenant:
  - Busca `approval_rule` original (via `applicable_rule_id` novo campo — ver adição no schema)
  - Verifica se `approver_user.role` (ou `cachedPermissions`) ainda satisfaz `rule.approverRoles` ou `rule.approverPermission`
  - Se NÃO: marca `Approval.status = ORPHANED` (novo valor enum) + notifica admin do tenant
  - Opcional: tenta re-atribuir chamando engine com rule + roles atuais
- **Trade-off:** approvals órfãs sobrevivem até 24h; simples

### Caminho B — Re-execução ativa quando rule/user muda
- `Approval` passa a persistir `applicable_rule_id` + `matched_criteria` (snapshot da rule no momento)
- Router `approval-rules.update`: quando `approverRoles`/`approverPermission` muda, worker `approvals-reevaluate` roda no rule.id afetado
- Router `users.updateRole` / `users.deactivate`: mesmo worker roda no user.id afetado
- **Trade-off:** approvals reajustam em segundos; mais código, mais risco

**Recomendação:** Caminho A pra fase 1 (menos risco). Caminho B como fase 2 (Sprint 15I) se PO validar.

## Escopo — implementação (assumindo Caminho A)

### Schema
- Nova coluna `Approval.applicableRuleId` (nullable, FK `approval_rules.id`, ON DELETE SET NULL)
- Novo valor enum `ApprovalStatus.ORPHANED`
- Nova coluna `Approval.orphanedAt DateTime?` + `Approval.orphanedReason String?`
- Migration 0032 backfill: `UPDATE approvals SET applicable_rule_id = (query complexa) WHERE applicable_rule_id IS NULL` — melhor esforço (pode ficar NULL se rule original foi deletada)

### Service
`src/server/services/approval-reconcile.service.ts` novo:
- `reconcileApprovalsForTenant(tenantId): Promise<{ orphaned: number; notified: number }>`
- Lógica: query approvals PENDING → join user → join rule → verifica se ainda válida → marca ORPHANED se não
- Reusa `hasPermission` helper de `permissions.service.ts` pra checar `cachedPermissions`

### Worker
`src/jobs/approvals-reconcile.worker.ts` novo:
- Registrado em `src/jobs/index.ts` com job recorrente diário 03:00 BRT (padrão Sprint 3)
- Loop por tenant ativo → chama `reconcileApprovalsForTenant`
- Notifica admin do tenant via email (`email-sender.service.ts`) OU push (`push-sender.service.ts`) com count de órfãs

### UI
`src/app/approvals/page.tsx` estender:
- Tab "Pendentes" (atual) + Tab "Órfãs (admin)" — só visível pra `withPermission('proposal:approve_manage')`
- Órfãs mostram razão + botão "Rejeitar" (com audit) e botão "Re-atribuir" (chama engine com rule atual)
- Ou: rota admin dedicada `/admin/approvals-orphaned`

### Fix imediato (não escopo mas ação humana)
Fred deve rejeitar as 4 approvals fósseis do `acme-tech` logando como della.block36 e marquise_ritchie68 na UI. Não bloqueia P-77.

## Regras arquiteturais aplicáveis

- Multi-tenancy: worker roda em `runWithTenant(tenantId, ...)` pra cada tenant
- Audit: `approval.orphaned` action registrada com `tenantIdOverride`
- RBAC: nova permission `proposal:approve_manage` (ver override individual, gerenciar órfãs)
- Envio de notificação: usa `centralCrmEmail` do tenant como fallback pra admin

## Checklist de fechamento

Ver §3 de `docs/Metodologia_Desenvolvimento_Venzo.md`. Destaques:

- [ ] Worker rodavel via `npm run worker:reconcile-now` pra teste manual
- [ ] Migration 0032 idempotente
- [ ] Feature flag `APPROVAL_RECONCILE_ENABLED: envBoolean(false)` — só ativa em prod após smoke test em staging
- [ ] Testes unit: reconcile puro (mock prisma, 8+ casos cobrindo cada status/rule)
- [ ] Test integration: worker roda no tenant seed acme-tech, marca 4 órfãs corretamente
- [ ] `docs/Backlog_Pos_MVP.md` marca P-77 como ✅ FECHADO
- [ ] `CLAUDE.md` ganha bloco P-77
- [ ] `docs/Roteiro_QA_Homologacao_Staging.md` ganha cenário: (a) admin cria approval; (b) rebaixa aprovador; (c) worker roda; (d) approval marca ORPHANED; (e) admin re-atribui

## Entrega

- Branch `claude/p77-approvals-reconcile`
- Commits self-contained com Caminho A explicado
- Reporte final: decisão A/B + arquivos + testes + baseline

## Esforço estimado

2-3 dias.
