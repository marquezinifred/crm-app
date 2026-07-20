# Sprint 15G.5 — Workflow de Transferência de Oportunidade

**Autor:** sessão de gestão (arquiteto) · **Data:** 2026-07-17
**Débito de origem:** P-87 (Planejamento_Debitos_Pos_Rollout_15G.md §P-87)
**Estimativa:** 6-7 dias · **Depende de:** Sprint 15G (estrutura ltree + Sales Units) — atendido
**Status:** 📋 planejado — aguarda kickoff do Fred

---

## 1. Objetivo

Fechar o gap semântico do Sprint 15G. O 15G resolveu **visão** (quem vê quais
oportunidades via hierarquia). O 15G.5 resolve **atribuição com governança**:
transferir a responsabilidade de uma oportunidade entre estruturas comerciais
diferentes, com fluxo de aprovação pelo gestor que recebe.

**Não confundir com delegação intra-equipe:** um gestor atribuir opp de um
analista dele para outro analista da própria subárvore já é comportamento
natural do 15G (autoridade sobre a subárvore) e **não** passa por este workflow.
O workflow existe **apenas para transferência cross-team** (destino fora da
subárvore do disparador).

---

## 2. Modelo de negócio (validado com PO/Fred)

### Regras cardinais

1. **Quem dispara:** apenas um **ancestor da estrutura de vendas do dono atual**
   (gestor, diretor, coordenador — qualquer nível acima do dono na árvore ltree).
   Nunca o próprio dono. Nunca pares no mesmo nível do dono. Nunca ADMIN de
   plataforma (fora da estrutura de vendas).
2. **Destinos permitidos** (o que o disparador enxerga como alvo):
   - Pares no próprio nível do disparador (outros gestores, outros diretores)
   - O superior direto do disparador na cadeia (diretor, se caller é gestor)
   - **Nunca** subordinados (isso é delegação interna, não transferência)
3. **Destinatário tem autoridade unilateral:** ao aceitar, escolhe qual membro da
   **própria subárvore** recebe a opp como novo owner. Não precisa aprovação do
   analista destino.
4. **Estágio preservado:** a opp mantém o estágio e o histórico completo. Não
   reseta para Lead.
5. **Durante a pendência:** a opp fica sob **gestão do disparador**. O dono
   original **continua vendo** a opp com badge "Em transferência" em modo
   **read-only** — não edita, não adiciona atividade, não move estágio.
6. **Rejeição / cancelamento / timeout:** a opp fica com o **disparador**
   indefinidamente até ação manual dele (redistribuir na própria subárvore,
   reofertar para outro destino, ou devolver ao dono original).
7. **Timeout parametrizável:** `TenantSettings.transferTimeoutHours` (default 72h
   = 3 dias). Worker verifica de hora em hora e auto-expira PENDING vencidas.

### Casos de uso reais

- Vendedor sai da empresa → gestor redistribui as opps dele (interno OU cross-team)
- Cliente muda de região → gestor SP transfere opp para gestor RJ
- Balanceamento de carga → gestor detecta sobrecarga e transfere
- Diretor intervém em opp específica que exige atenção

---

## 3. Emendas / decisões de arquitetura (riscos e mitigações)

Estilo A1-A7 do Sprint 15G. Cada risco identificado antes dos chips, com a
mitigação embutida nos critérios de aceite.

| # | Risco | Mitigação (obrigatória) |
|---|-------|--------------------------|
| **T1** | Race: 2 disparadores iniciam transfer da mesma opp | Partial UNIQUE `idx_transfers_active_per_opp ON opportunity_transfers (opportunity_id) WHERE status='PENDING'`. Segundo request → CONFLICT. |
| **T2** | Guard de write incompleto — dono edita opp em pendência por um caminho não coberto | Guard centralizado. TODAS as mutations de opportunity checam `current_transfer_id`: `opportunities.update/advanceStage/cancel`, `proposals.*`, `activities.*`, `tasks.*`, `documents.*` que referenciam a opp. Lista fechada no chip 2b + teste por caminho. |
| **T3** | Kill-switch ausente invalida rollback | `env.OPPORTUNITY_TRANSFER_ENABLED = envBoolean(false)`. Consumer runtime único no router (padrão P-73). Flag OFF → procedures retornam FORBIDDEN/feature-off e guard de write não bloqueia (comportamento pré-15G.5). |
| **T4** | Audit perdido em contexto tRPC | Toda mutation grava `audit()` com `tenantIdOverride: ctx.tenantId` (bug audit-trpc-context-loss). |
| **T5** | Notificação falha derruba a mutation | Push/email best-effort: `void sendX().catch(console.warn)`. Nunca propaga rejection (padrão inbound-assign-push P-31). |
| **T6** | Vazamento cross-tenant nas queries novas | Toda query de `opportunity_transfers` filtra `tenantId: ctx.tenantId` explícito (memória feedback_cross_tenant_leak). RLS como 2ª barreira. |
| **T7** | `cause` técnico vaza pro cliente em FORBIDDEN de scope | Mensagem genérica visível + detalhe no `cause` string server-side (padrão P-98). |
| **T8** | Transição de estado inválida (ex: aprovar transfer já CANCELLED) | Toda mutation revalida `status === PENDING` antes de transicionar. Testes de máquina de estado. |
| **T9** | Migration em 2 branches Neon (P-80) | Rollout aplica 0032 em `staging` (dev) E `production-live` (prod via `vercel env pull`). |
| **T10** | newOwner fora da subárvore do destinatário (escalada) | `approve` valida `newOwnerId ∈ getSubtreeMemberIds(destinatário)` antes de setar owner. |

---

## 4. Modelo de dados — Migration 0032

```sql
CREATE TYPE "TransferStatus" AS ENUM (
  'PENDING', 'APPROVED', 'REJECTED', 'TIMED_OUT', 'CANCELLED'
);

CREATE TABLE opportunity_transfers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  opportunity_id      UUID NOT NULL REFERENCES opportunities(id),
  requested_by_id     UUID NOT NULL REFERENCES users(id),  -- disparador (ancestor)
  original_owner_id   UUID NOT NULL REFERENCES users(id),  -- dono no momento do disparo
  target_manager_id   UUID NOT NULL REFERENCES users(id),  -- destinatário (par/superior)
  target_unit_id      UUID REFERENCES sales_units(id),     -- auditoria (opcional)
  new_owner_id        UUID REFERENCES users(id),           -- escolhido no approve (NULL até APPROVED)
  status              "TransferStatus" NOT NULL DEFAULT 'PENDING',
  reason              TEXT,          -- justificativa do disparador
  decision_reason     TEXT,          -- justificativa do decisor
  decided_by_id       UUID REFERENCES users(id),
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at          TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ NOT NULL,  -- requested_at + transferTimeoutHours
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transfers_pending_target ON opportunity_transfers (target_manager_id, status) WHERE status='PENDING';
CREATE INDEX idx_transfers_pending_expiry ON opportunity_transfers (expires_at, status) WHERE status='PENDING';
CREATE UNIQUE INDEX idx_transfers_active_per_opp ON opportunity_transfers (opportunity_id) WHERE status='PENDING'; -- T1

ALTER TABLE opportunity_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON opportunity_transfers USING (tenant_id = current_tenant_id());

ALTER TABLE opportunities ADD COLUMN current_transfer_id UUID REFERENCES opportunity_transfers(id); -- T2 (guard flag)
ALTER TABLE tenant_settings ADD COLUMN transfer_timeout_hours INTEGER NOT NULL DEFAULT 72; -- T3
```

Prisma: enum `TransferStatus`, model `OpportunityTransfer`, campo
`Opportunity.currentTransferId`, campo `TenantSettings.transferTimeoutHours`.

---

## 5. Decomposição em fases (chips via spawn_task, sessões separadas)

Modo canônico: gestão coordena, chips rodam em sessões separadas, QA Modo B por
fase. Chips de uma mesma fase que tocam arquivos disjuntos rodam em paralelo.

### Fase 1 — Fundação (schema + service) · ~1,5 dia

**Chip 1a — Migration 0032 + Prisma models** *(sequencial, bloqueia o resto)*
- Migration 0032 (tabela, enum, 3 índices, RLS, colunas em opportunities/tenant_settings)
- Prisma schema: enum + model + campos novos
- `env.OPPORTUNITY_TRANSFER_ENABLED = envBoolean(false)` (T3)
- Sem backfill (tabela nasce vazia; `transfer_timeout_hours` default 72)
- Critério: `prisma migrate dev` limpo, `prisma validate` OK, type-check zero

**Chip 1b — TransferScopeService (funções puras)** *(depende de 1a p/ tipos)*
- `resolveTransferSources(caller, tenantId)`: caller é ancestor de quais donos? (pode disparar sobre quais opps)
- `resolveTransferTargets(caller, tenantId)`: pares no nível do caller + superior direto → lista de target managers válidos
- `canReceiveAsNewOwner(targetManager, newOwnerId, tenantId)`: newOwner ∈ subárvore do targetManager (T10) — reusa `SalesUnitRepository.getSubtreeMemberIds`
- `isAncestorOf(callerUnitPath, ownerUnitPath)`: comparação ltree
- Funções PURAS testáveis sem tRPC (padrão do `analytics.service`/`approval-engine.service`)
- Critério: testes unitários cobrindo cada cenário da tabela de regras §2

**QA Modo B Fase 1** — baseline verde + coverage do service.

### Fase 2 — Backend (procedures + worker + guard) · ~2 dias

**Chip 2a — Router `opportunityTransfers` (7 procedures)** *(depende de 1b)*
- `request` (dispara; valida ancestor + destino via TransferScopeService; cria row PENDING; seta `opportunities.current_transfer_id`; notifica; audit T4)
- `cancel` (disparador; status→CANCELLED; opp fica com disparador; notifica)
- `approve` (destinatário; valida newOwner T10; status→APPROVED; troca `owner_id`; limpa `current_transfer_id`; grava stageHistory; notifica)
- `reject` (destinatário; status→REJECTED; opp fica com disparador; notifica)
- `pendingForMe` / `myOutgoing` / `historyForOpportunity` (queries; filtro tenantId T6)
- Todas revalidam `status===PENDING` (T8); kill-switch no topo (T3); cross-tenant guard; mensagem genérica + cause (T7)

**Chip 2b — Worker timeout + guard de write** *(depende de 1a; paralelo a 2a se não colidir no router de opportunities — coordenar)*
- `jobs/opportunity-transfer-timeout.worker.ts` + queue: de hora em hora, PENDING com `expires_at < now()` → TIMED_OUT + limpa flag + notifica (idempotente, T5)
- Guard centralizado de write (T2): helper `assertOpportunityWritable(oppId, callerId)` chamado em TODAS as mutations que escrevem na opp — `opportunities.update/advanceStage/cancel`, `proposals.create/addVersion`, `activities.*`, `tasks.create/update/delete`, `documents.create/addVersion`. Bloqueia se `current_transfer_id != null` e caller ≠ `requested_by_id`.
- 7 templates de notificação (email `lib/email/templates` + push `push-sender`): REQUESTED (destinatário + dono), APPROVED (disparador + dono + novo owner), REJECTED/CANCELLED/TIMED_OUT (disparador + dono)

**QA Modo B Fase 2** — atenção à colisão 2a/2b no router de opportunities; máquina de estado; guard por caminho; kill-switch OFF preserva runtime.

### Fase 3 — Frontend (3 telas) · ~2 dias · chips paralelos

**Chip 3a — Disparo + read-only em `/pipeline/[id]`**
- Botão "Transferir responsabilidade" (visível só se caller é ancestor do owner — via novo `myTransferCapability`); Modal com Select de destino (`resolveTransferTargets`) + textarea motivo
- Badge "🔄 Em transferência para X" + edits disabled quando `currentTransferId != null` (espelha guard backend); aba Histórico mostra transferências
- Se já PENDING e caller é disparador → botão "Cancelar transferência"

**Chip 3b — Fila do destinatário `/inbox/transferencias-recebidas`**
- Lista `pendingForMe`: card com opp/valor/empresa, disparador, dono original, motivo, "há X" (destaque perto do timeout)
- Aceitar → sub-modal com Select do novo owner (subárvore do destinatário) + motivo; Rejeitar → modal com motivo
- Badge no Topbar (sino) quando há pendências; item no Sidebar gated

**Chip 3c — Acompanhamento do disparador `/pipeline/transferencias-em-andamento`**
- Lista `myOutgoing` com filtro por status; botão Cancelar nas PENDING

Todas: toast Venzo + `friendlyTrpcError`; AlertDialog nas ações destrutivas; ErrorState em erro de query (padrões P-92/P-92b/P-96 já estabelecidos).

**QA Modo B Fase 3** — telas disjuntas; RBAC UI (só ancestor vê botão disparo); read-only do dono.

### Fase 4 — Rollout + fechamento · ~0,5 dia

- `docs/ROLLOUT_Sprint_15G5_Prod.md` (migration 0032 nos 2 branches Neon T9 → flag OFF → smoke → ativar `OPPORTUNITY_TRANSFER_ENABLED=true`)
- Roteiro QA §2.12 (cenários de transferência ponta a ponta por role)
- Atualizar CLAUDE.md + HANDOFF

---

## 6. Kill-switch e rollout

`OPPORTUNITY_TRANSFER_ENABLED` (default `false`). Deploy com flag OFF → runtime
idêntico ao pré-15G.5 (procedures indisponíveis, guard de write inerte, botões
não renderizam). Migration 0032 aplicada nos 2 branches. Ativar flag em prod só
após smoke. Rollback = flag `false` sem redeploy; dados ficam inertes.

---

## 7. Testes (mínimos)

- **Unit** (Fase 1): TransferScopeService — cada regra §2 (ancestor dispara / par-e-superior como destino / newOwner na subárvore / dono não dispara / analista não dispara).
- **Unit/Integration** (Fase 2): máquina de estado (request→approve/reject/cancel/timeout; revalidação PENDING); guard por caminho de write; race → CONFLICT; kill-switch OFF; cross-tenant NOT_FOUND; audit com override; notificação best-effort.
- **Component** (Fase 3): botão de disparo só p/ ancestor; read-only do dono; fila do destinatário; escolha de newOwner limitada à subárvore.
- **E2E**: happy path completo + timeout + rejeição.

---

## 8. Estimativa consolidada

| Fase | Chips | Dias |
|------|-------|------|
| 1 — Fundação | 1a + 1b | 1,5 |
| 2 — Backend | 2a + 2b | 2,0 |
| 3 — Frontend | 3a + 3b + 3c | 2,0 |
| 4 — Rollout | doc + QA final | 0,5 |
| **Total** | **7 chips + 4 QAs** | **~6 dias** |

---

## 9. Decisão em aberto pro PO (herdada do Planejamento v3 — reconfirmar)

Regra "destino cross-branch": Fred definiu que transferência para outra estrutura
vai ao **gestor** daquela estrutura (que decide seguir/cancelar e atribui um
analista) — ou seja, o modelo deste sprint. Reconfirmar antes do kickoff que
**não** existe caso de transferência direta analista→analista cross-team (isso
foi descartado em favor do workflow via gestor). O plano acima assume o workflow.

---

## 10. Referências

- **Regras completas + tabela de delegação:** [Planejamento_Debitos_Pos_Rollout_15G.md](Planejamento_Debitos_Pos_Rollout_15G.md) §P-87
- **Base ltree/Sales Units:** Sprint 15G (CLAUDE.md §Sprint 15G) + `SalesUnitRepository`
- **Kill-switch pattern:** [rbac-kill-switch-runtime.md](../../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/rbac-kill-switch-runtime.md) (P-73)
- **Padrões UX herdados:** P-92 (toast erro), P-92b (ErrorState query), P-96 (AlertDialog), P-98 (msg genérica + cause)
- **Neon 2 branches:** [HANDOFF_Estado_Atual_2026-07-17.md](HANDOFF_Estado_Atual_2026-07-17.md) §P-80
