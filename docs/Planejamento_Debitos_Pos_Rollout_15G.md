# Planejamento de Débitos Descobertos no Rollout Sprint 15G

**Data:** 2026-07-10 (revisão 2 — 2026-07-11)
**Origem:** Sessão de teste real em produção após rollout Sprint 15G (Estrutura Comercial e Visibilidade Hierárquica)
**Destinatário:** PO
**Autor:** Sessão Claude (gestão) + Fred Marquezini (validação + revisão crítica)

---

## Sumário executivo

Durante a validação em produção do Sprint 15G — com 6 roles reais logando e exercitando o fluxo de oportunidades — foram descobertos **10 débitos**. A revisão do PO ajustou classificações e sequenciamento. A distribuição atualizada:

- **6 débitos de severidade ALTA** — impacto imediato em segurança, operação ou vendas B2B, exigem chip cirúrgico ou Sprint dedicado antes de qualquer feature nova.
- **1 débito de severidade MÉDIA** — cenário de recuperação de incidente.
- **3 débitos de severidade BAIXA** — housekeeping/documentação.

**Recomendação de sequenciamento revisada (v3):**

| Quando | Itens | Observação |
|--------|-------|------------|
| **Dia 1 (paralelo, 4 chips walltime = 1 dia)** | P-88, P-89, P-86, P-80 | Arquivos disjuntos → paralelo real. P-80 sai de Sprint 16 pra cá. |
| **Dia 2-3** | P-85 (Clerk Production instance) | Sem esperar domínio próprio — pode operar no domínio Vercel existente. |
| **Sprint 15G.5 (6-7 dias)** | P-87 (workflow de transferência de oportunidade) | Sprint dedicado — não é feature simples, é workflow completo com aprovação. |
| **Sprint 15H (8-10 dias)** | Blocos A + B + C originais | Escopo intacto. |
| **Housekeeping (qualquer momento, paralelo)** | P-83, P-84, P-81 | Sem dependência entre si. |
| **Sprint 16** | P-82 (loop 401 → tela dedicada) | Mantém — não é urgente. |

**Estimativa total agregada revisada:** ~16-18 dias de trabalho até fim do 15H (Dia 1 chips + Dias 2-3 Clerk + 15G.5 workflow + 15H completo).

**Sprint organization confirmada pelo PO:** **Opção A** — Sprint 15G.5 dedicado antes do 15H. Opção C (embutir no 15H, empurrar Metas pra 15I) descartada porque o escopo do P-87 cresceu de "validação simples" pra "workflow completo com tabela dedicada + worker de timeout + 3 telas novas" — inviável sacrificar Bloco B (Metas) por completo.

---

## Débitos por prioridade (severidade revisada)

### 🔴 ALTA — Chips Semana 1 (paralelos, 1 dia walltime)

#### P-88 — Sidebar mostra itens Admin para roles sem permissão

**Descoberto por:** Fred, logado como ANALISTA (`frederico.marquezini@jaupartners.com.br`), acessando o menu lateral em produção.

**Sintoma:** ANALISTA vê no menu lateral (seção ADMIN) os itens **Usuários**, **Produtos** e **Listas** — que ele não tem permissão para acessar. Ao clicar, o backend retorna FORBIDDEN corretamente, mas o menu não deveria oferecer a opção.

**Root cause:** No `src/components/layout/Sidebar.tsx` linhas 69-71, esses 3 itens **não têm** a chave `permission:` configurada. Sprint 15E introduziu o padrão mas não retroagiu nos itens antigos.

**Impacto:**
- **Segurança:** dados **não vazam** (backend barra). Mas defesa em profundidade fica quebrada.
- **UX:** usuário vê opções que não pode usar; ao clicar recebe erro 403 sem contexto.

**Solução proposta:**
- `/admin/users` → `permission: 'user:read'`
- `/admin/products` → `permission: 'product:read'`
- `/admin/listas` → `permission: 'catalog:read'` (ou permissão equivalente do catálogo)

**Testes:** Component test do Sidebar renderizando com role ANALISTA / GESTOR / PARCEIRO → nenhum dos 3 itens aparece. Sanity com ADMIN → todos aparecem.

**Estimativa:** 30-45min. **Severidade:** ALTA.

---

#### P-89 — `/pipeline/new` permite duplicação de oportunidade

**Descoberto por:** Fred, criando opp em prod. Após primeira criação, Sheet lateral abriu mostrando a opp. Fechar o Sheet retornou ao form ainda preenchido; clicar Salvar novamente criou **segunda opp idêntica**.

**Sintoma:** Fluxo natural do usuário permite duplicação. Basta fechar o Sheet lateral após uma criação e clicar Salvar de novo.

**Root cause hipotético:**
- Form não reseta state após success.
- Fechar o Sheet retorna à rota `/pipeline/new` com dados preenchidos.
- Botão Salvar continua habilitado.

**Impacto:** Duplicatas em pipeline distorcem relatórios de conversão, previsão e comissões. Recovery exige acesso admin ao banco.

**Solução proposta (defesa em camadas):**

1. **Frontend imediato:** após `create` bem-sucedido, redirecionar para `/pipeline` (kanban). Form nunca fica pendurado.
2. **UX complementar:** botão Salvar `disabled` durante mutation e após success.
3. **Backend defensivo (opcional futuro):** idempotency por hash de payload + user_id + janela 5s.

**Estimativa:** 30min (camadas 1+2) OU 3h (com camada 3). **Severidade:** ALTA.

---

#### P-86 — `/admin/users` — dropdown Papel + botão Desativar sem persistência ⬆️ ELEVADO PARA ALTA

**Descoberto por:** Fred, testando manutenção de usuários em produção.

**Sintoma:** Dropdown de Papel aparece editável e botão Desativar aparece clicável. Ao interagir, **nada persiste**.

**Justificativa de severidade ALTA (revisada pelo PO):** trocar role de usuário e desativar usuário são funções administrativas centrais **sem workaround equivalente**. `/admin/users/[id]/permissions` gerencia **overrides individuais de permissão** — não substitui o role padrão nem desativação. Admin operacionalmente impedido de gerenciar o sistema.

**Root cause hipotético:** UI construída antes do endpoint estar finalizado ou perdeu binding no meio.

**Solução proposta:**
- Auditar cada ação:
  - Dropdown Papel → conectar a `users.updateRole` (com `withPermission('user:grant_permissions')` ou análogo).
  - Botão Desativar → conectar a `users.deactivate` com `AlertDialog` de confirmação.
  - Botão Permissões → navegar para `/admin/users/[id]/permissions` (esse já deve funcionar).
- Toast de sucesso/erro em cada mutation.
- Testes de integração para cada ação.

**Estimativa:** 3-4h. **Severidade:** ALTA.

---

#### P-80 — Vercel Production compartilha banco Neon com dev local ⬆️ ELEVADO PARA ALTA

**Descoberto durante:** rollout Sprint 15G. `DATABASE_URL` de produção aponta para o mesmo branch Neon (`ep-dry-pine-ajwvil7q`) usado no `.env.local` do desenvolvedor.

**Sintoma:** `db:reset` local afeta produção. Script bugado local mexe em dados de usuários reais. Já ocorreu neste projeto: db:reset acidental exigiu recovery manual de 4 users pós-restore PITR.

**Justificativa de severidade ALTA (revisada pelo PO):**
- Risco não é o dia normal — é o **próximo** db:reset acidental, migração experimental ou script mal rodado.
- Blast radius **existencial** para o produto.
- **LGPD exige isolamento de ambientes** — compliance/auditoria formal.

**Solução proposta:**
1. Criar branch Neon separado para produção (ex: `production-live`) a partir do estado atual do `staging`.
2. Atualizar `DATABASE_URL` no Vercel production apontando para o novo branch.
3. Documentar em runbook que desenvolvimento local **nunca** aponta para produção.

**Estimativa:** 2-3h (criar branch, cutover env, monitorar 24h). **Severidade:** ALTA.

---

### 🔴 ALTA — Dias 2-3

#### P-85 — Vercel Production aponta para Clerk **Development** instance ⬆️ ELEVADO PARA ALTA

**Descoberto por:** Fred, email de verification code com `[Development]` no assunto vindo de `notifications@accounts.dev`.

**Sintoma:** Instância Clerk que autentica usuários em produção é a de **desenvolvimento** (`guiding-bobcat-23.clerk.accounts.dev`). Emails vêm com "[Development]" no subject.

**Justificativa de severidade ALTA (revisada pelo PO):**
- Emails com "[Development]" **já foram vistos por usuários reais** (não hipotético).
- Instância dev do Clerk tem **limites de rate menores** e **políticas de segurança mais permissivas** (aceita sign-up livre, aceita qualquer email sem verificação de domínio).
- **Bloqueador de vendas B2B** — apresentar CRM pra cliente enterprise com email "[Development]" é inviável.
- Não é problema de percepção, é problema de venda.

**Correção de escopo (revisada pelo PO):**
Instalação da **Clerk Production instance pode ser feita imediatamente** e operar no **domínio Vercel existente** (`crm-app-pi-eight.vercel.app`). Domínio customizado (ex: `accounts.venzo.com.br`) é **opcional futuro** — não é dependência bloqueante. Isso libera a tarefa pra ser feita agora.

**Solução proposta:**
1. Criar Clerk **Production instance** no Dashboard.
2. Configurar JWT template idêntico ao dev (claims `public.tenantId`, `public.role`, `public.platformRole`).
3. Reconfigurar webhook endpoint apontando pra `crm-app-pi-eight.vercel.app/api/clerk/webhook`.
4. Migrar usuários existentes (Clerk oferece user migration API).
5. Atualizar `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` e `CLERK_SECRET_KEY` no Vercel Production (`pk_live_...` e `sk_live_...`).
6. Comunicar usuários existentes (magic links reenviados uma vez).
7. Domínio custom `accounts.venzo.com.br` — pode ficar pra Sprint 16 ou depois.

**Estimativa:** 1-2 dias (setup + migration + rollout gradual + monitoramento 24h). **Severidade:** ALTA.

---

### 🔴 ALTA — Sprint dedicado

#### P-87 — Workflow de transferência de oportunidade cross-team

**Descoberto por:** Fred, logado como ANALISTA, criando opp e atribuindo `ownerId` a DIRETOR_COMERCIAL. Recebeu **NOT_FOUND** ao ser redirecionado — Sprint 15G escondeu corretamente a opp que ele não pode ver.

**Sintoma real:** ANALISTA pode escolher qualquer usuário como responsável no form. Se escolher outro, cria a opp mas "perde" ela (Sprint 15G escopo isola). Bug arquitetural: não existe fluxo formal de transferência de responsabilidade cross-team.

**Root cause + evolução do escopo:**

Inicialmente pareceu problema simples de validação de escopo de escrita (2-3 dias). Após simulação de casos reais com o PO, ficou claro que o modelo de negócio exige um **workflow completo de aprovação de transferência**, não apenas delegação direta. O escopo cresceu pra Sprint dedicado (6-7 dias).

---

**Modelo de negócio (validado com PO):**

**Casos de uso reais:**
1. Vendedor sai da empresa → Gestor redistribui as opps dele (interno ou envia pra outro time)
2. Cliente muda de região → Gestor SP envia opp pra Gestor RJ
3. Balanceamento de carga → Gestor detecta sobrecarga em um analista e transfere pra outro
4. Diretor intervém em opp específica que exige atenção especial

**Regras cardinais:**

1. **Quem dispara:** apenas **ancestor da estrutura de vendas do dono** (Gestor, Diretor, Coordenador — qualquer nível acima do dono atual). Nunca o próprio dono. Nunca pares no mesmo nível. Nunca ADMIN plataforma (fora da estrutura de vendas).
2. **Destinos permitidos:** o disparador enxerga como destinos possíveis:
   - Pares no seu próprio nível (outros Gestores, outros Diretores)
   - Seu superior direto (Diretor se caller é Gestor)
   - **Nunca** subordinados (delegação interna é operação diferente, comportamento natural do Sprint 15G)
3. **Destino recebe autoridade unilateral:** ao aceitar, o destinatário escolhe qual analista da sua equipe recebe a opp. Não precisa aprovação do analista destino.
4. **Estágio preservado:** a opp mantém o estágio atual (não reseta pra Lead). Histórico completo preservado.
5. **Durante pendência:** opp fica sob **gestão do disparador**. Dono original **continua vendo** com badge "Em transferência" mas fica em **modo read-only** — não pode editar, adicionar atividades, mover estágio.
6. **Rejeição / cancelamento / timeout:** opp fica com o **disparador** indefinidamente até ação manual (redistribuir na própria equipe, reofertar pra outro destino, ou aceitar de volta pro dono original).

**Delegação intra-equipe (fora do workflow):** Gestor SP atribuir opp de Analista SP1 para Analista SP2 (mesma subárvore) **NÃO passa por workflow** — é autoridade natural do Gestor sobre sua subárvore (comportamento Sprint 15G já existente). Workflow existe **apenas quando cross-team** (destino fora da subárvore do disparador).

**Timeout parametrizável:** cada tenant configura em `TenantSettings.transferTimeoutHours` (default 72h = 3 dias). Cron worker verifica de hora em hora e auto-expira PENDING que passaram do limite.

---

**Modelo de dados novo:**

**Migration 0032 — `opportunity_transfers`:**

```sql
CREATE TYPE "TransferStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'TIMED_OUT',
  'CANCELLED'
);

CREATE TABLE opportunity_transfers (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  opportunity_id      UUID NOT NULL REFERENCES opportunities(id),
  requested_by_id     UUID NOT NULL REFERENCES users(id),  -- Gestor A (disparador)
  original_owner_id   UUID NOT NULL REFERENCES users(id),  -- Analista SP1 (dono no momento do disparo)
  target_unit_id      UUID REFERENCES sales_units(id),     -- Unidade destino (opcional, ajuda auditoria)
  target_manager_id   UUID NOT NULL REFERENCES users(id),  -- Gestor B (recebedor)
  new_owner_id        UUID REFERENCES users(id),           -- Analista escolhido por Gestor B ao aceitar (NULL até APPROVED)
  status              "TransferStatus" NOT NULL DEFAULT 'PENDING',
  reason              TEXT,                                 -- Justificativa do disparador (opcional)
  decision_reason     TEXT,                                 -- Justificativa do decisor (opcional)
  decided_by_id       UUID REFERENCES users(id),           -- Quem decidiu (Gestor B, ou disparador em cancelamento)
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at          TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ NOT NULL,                -- calculado a partir de TenantSettings.transferTimeoutHours
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transfers_pending_target ON opportunity_transfers (target_manager_id, status)
  WHERE status = 'PENDING';
CREATE INDEX idx_transfers_pending_expiry ON opportunity_transfers (expires_at, status)
  WHERE status = 'PENDING';
CREATE UNIQUE INDEX idx_transfers_active_per_opp ON opportunity_transfers (opportunity_id)
  WHERE status = 'PENDING';  -- 1 transferência PENDING por opp

-- RLS obrigatório
ALTER TABLE opportunity_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON opportunity_transfers
  USING (tenant_id = current_tenant_id());
```

**Migration 0032b — flag em Opportunity:**

```sql
ALTER TABLE opportunities
  ADD COLUMN current_transfer_id UUID REFERENCES opportunity_transfers(id);

-- Quando != null, opp está em transferência PENDING (usado pra bloquear edição pelo dono original)
```

**Migration 0032c — config timeout:**

```sql
ALTER TABLE tenant_settings
  ADD COLUMN transfer_timeout_hours INTEGER NOT NULL DEFAULT 72;
```

---

**Backend — procedures novas em `opportunityTransfers` router:**

1. **`request`** (disparo) — mutation:
   - Input: `{ opportunityId, targetManagerId, reason? }`
   - Valida caller é ancestor do owner atual da opp (via ltree)
   - Valida targetManagerId é destino permitido (par mesmo nível ou superior direto de caller)
   - Cria row `opportunity_transfers` com status PENDING
   - Atualiza `opportunities.current_transfer_id = new_transfer.id`
   - Dispara notificação (email + push) pro targetManager
   - Dispara notificação pro dono original ("sua opp entrou em transferência")
   - Audit log `opportunity_transfer.requested`

2. **`cancel`** (disparador cancela antes de decisão) — mutation:
   - Input: `{ transferId }`
   - Valida caller é o `requested_by_id`
   - Valida status == PENDING
   - Atualiza status = CANCELLED, `decided_by_id = caller`, `decided_at = now()`
   - Atualiza `opportunities.current_transfer_id = null`
   - Opp fica sob gestão do disparador (não retorna pro dono original — Confirmação B do PO)
   - Notifica dono original ("transferência cancelada, opp voltou pra Gestor X")
   - Audit log `opportunity_transfer.cancelled`

3. **`approve`** (destinatário aceita) — mutation:
   - Input: `{ transferId, newOwnerId, decisionReason? }`
   - Valida caller == `target_manager_id`
   - Valida status == PENDING
   - Valida `newOwnerId` é membro da subárvore que caller gerencia (via ltree)
   - Atualiza status = APPROVED, `new_owner_id`, `decided_by_id`, `decided_at`
   - Atualiza `opportunities.owner_id = newOwnerId` + `current_transfer_id = null`
   - Grava `opportunityStageHistory` com marca especial (transfer approved, from → to)
   - Notifica: disparador + dono original + novo owner
   - Audit log `opportunity_transfer.approved` + `opportunity.owner_changed`

4. **`reject`** (destinatário rejeita) — mutation:
   - Input: `{ transferId, decisionReason? }`
   - Valida caller == `target_manager_id`
   - Valida status == PENDING
   - Atualiza status = REJECTED, `decided_by_id`, `decided_at`
   - Atualiza `opportunities.current_transfer_id = null`
   - Opp fica sob gestão do disparador (Confirmação A do PO — mesmo comportamento de cancelamento/timeout)
   - Notifica: disparador + dono original
   - Audit log `opportunity_transfer.rejected`

5. **`pendingForMe`** (fila do destinatário) — query:
   - Retorna transfers PENDING onde caller == `target_manager_id`
   - Includes: opportunity, requested_by, original_owner

6. **`myOutgoing`** (o que o disparador enviou) — query:
   - Retorna transfers PENDING onde caller == `requested_by_id`
   - Includes: opportunity, target_manager

7. **`historyForOpportunity`** — query:
   - Todas as transferências (qualquer status) de uma opp específica
   - Usado no detalhe da opp pra mostrar histórico completo

**Worker cron novo:**

`jobs/opportunity-transfer-timeout.ts` — roda de hora em hora:
- Busca transfers PENDING onde `expires_at < now()`
- Atualiza status = TIMED_OUT
- Atualiza `opportunities.current_transfer_id = null`
- Opp fica sob gestão do disparador (mesmo comportamento de reject/cancel)
- Notifica: disparador + dono original ("timeout — opp voltou pra Gestor X")

**Guard adicional na Opportunity update/write:**

Toda operação de write em `opportunities.*` (update, delete, stage advance, activity add, task create, document upload) precisa checar `opportunities.current_transfer_id`:
- Se != null (transferência PENDING) → allow apenas se caller == `requested_by_id` da transfer atual (disparador tem controle temporário)
- Bloqueia dono original + qualquer outro user (mesmo do time)

Isso implementa o **read-only pro dono original** durante pendência (Confirmação B).

---

**Frontend — 3 telas novas + integração em existentes:**

1. **Botão "Transferir responsabilidade"** em `/pipeline/{id}` header:
   - Visível apenas se caller é ancestor do owner atual (via `salesStructure.myScopes.canTransferOpportunity(oppId)`)
   - Abre Modal com:
     - Dropdown "Destino" (populado com pares no mesmo nível + superior direto)
     - Textarea "Motivo (opcional)"
     - Botões Cancelar / Solicitar transferência
   - Se transferência já está PENDING (`opp.currentTransferId != null`) → botão vira "Cancelar transferência pendente"

2. **Nova tela `/inbox/transferencias-recebidas`** — fila do destinatário:
   - Lista de transferências PENDING (`opportunityTransfers.pendingForMe`)
   - Cada card mostra: opp title/valor/empresa, disparador, dono original, motivo, "há X dias" (com destaque se próximo do timeout)
   - Botões: **Aceitar** (abre sub-modal com dropdown pra escolher novo owner da própria equipe + textarea motivo) / **Rejeitar** (modal simples com textarea motivo)

3. **Nova tela `/pipeline/transferencias-em-andamento`** — visibilidade do disparador:
   - Lista de transferências PENDING/APPROVED/REJECTED/TIMED_OUT/CANCELLED disparadas por mim
   - Filtro por status
   - Botão "Cancelar" em cada PENDING

4. **Integração em `/pipeline/{id}`:**
   - Se opp está em transferência PENDING:
     - Badge grande no header: "🔄 Em transferência para Gestor X (aguarda decisão)"
     - Botões de edit disabled com tooltip "Opp em transferência, contate Gestor Y"
   - Se opp foi transferida no passado (histórico):
     - Aba "Histórico" mostra timeline com eventos de transferência

5. **Notificação no Topbar:**
   - Badge no ícone de sino quando há transferências pendentes pra mim (destinatário)
   - Click leva pra `/inbox/transferencias-recebidas`

---

**Notificações (worker BullMQ existente):**

Emails (templates novos):
- `TRANSFER_REQUESTED` → destinatário: "Nova transferência de oportunidade aguardando sua decisão"
- `TRANSFER_REQUESTED_ORIGINAL_OWNER` → dono original: "Sua oportunidade foi enviada pra transferência (edição bloqueada)"
- `TRANSFER_APPROVED` → disparador + dono original: "Transferência aprovada, novo responsável: X"
- `TRANSFER_APPROVED_NEW_OWNER` → novo owner: "Você recebeu uma nova oportunidade"
- `TRANSFER_REJECTED` → disparador + dono original: "Transferência rejeitada, opp voltou pra Gestor X"
- `TRANSFER_CANCELLED` → dono original + destinatário: "Transferência cancelada pelo disparador"
- `TRANSFER_TIMED_OUT` → disparador + dono original: "Transferência expirou sem decisão, opp voltou pra Gestor X"

Push notifications (VAPID já existe — Sprint 10):
- Mesmos eventos que emails, versão resumida

---

**Testes (E2E crítico):**

- Fluxo happy path completo: Gestor SP dispara → Gestor RJ aceita → owner muda + notificações OK
- Fluxo timeout: dispara → aguarda expiração → worker roda → status TIMED_OUT + opp volta pro disparador
- Fluxo cancelamento: dispara → cancela em 5min → status CANCELLED + opp fica com disparador
- Fluxo rejeição: dispara → destinatário rejeita → status REJECTED + opp fica com disparador
- **Read-only durante pendência:** dono original tenta editar opp em transferência → FORBIDDEN
- **Guard escopo disparador:** Analista tenta disparar → FORBIDDEN
- **Guard destino:** disparador tenta enviar pra subordinado → FORBIDDEN (subordinado não é destino válido, é delegação direta)
- **Guard newOwner:** destinatário tenta atribuir pra user fora da sua subárvore → FORBIDDEN
- **Concorrência:** 2 disparadores tentam iniciar transfer da mesma opp simultaneamente → 1 aceita, outro recebe CONFLICT (UNIQUE constraint)

---

**Estimativa detalhada — 6-7 dias:**

- **Dia 1:** Modelo de dados (migrations 0032abc) + Prisma schema + specs
- **Dia 2:** Backend procedures 1-4 (request, cancel, approve, reject) + guards de escopo
- **Dia 3:** Backend procedures 5-7 (queries) + worker cron timeout + notificações
- **Dia 4:** Frontend — botão de disparo + modal + integração no `/pipeline/{id}`
- **Dia 5:** Frontend — tela `/inbox/transferencias-recebidas` + tela `/pipeline/transferencias-em-andamento`
- **Dia 6:** Testes E2E completos + audit log validação + code review
- **Dia 7:** QA Modo B + polish + docs + deploy

**Severidade:** ALTA (feature bloqueadora do modelo real de trabalho).

**Sprint organization:** **Sprint 15G.5 dedicado** (6-7 dias) antes do 15H. Confirmado pelo PO. Opção C (embutir no 15H) descartada.

**Dependências:** Sprint 15G (base ltree + Sales Units) — atendida.

---

### 🟡 MÉDIA — Sprint 16

#### P-82 — Loop 401 quando `clerkId` chega sem row local correspondente

**Descoberto por:** Fred, logando com `fredmarquezini@hotmail.com` após restore Neon PITR — a conta Clerk existia mas o row local havia sido apagado. Dashboard entrou em loop de reload infinito.

**Sintoma:** Sessão Clerk válida + `public_metadata.tenantId` populado + user não existe no banco = 401 em qualquer tRPC call → session-guard força reload → mesmo estado → loop infinito.

**Root cause:** Session-guard (`src/lib/trpc/session-guard.ts`) reage a 401 assumindo cookie expirado. Não distingue "cookie expirado" de "usuário não conhecido pelo backend".

**Solução proposta:**
1. Backend `users.me` retorna código de erro diferenciado quando `clerkId` presente mas row local ausente: `USER_NOT_PROVISIONED`.
2. Session-guard distingue:
   - `UNAUTHORIZED` → reload (comportamento atual).
   - `USER_NOT_PROVISIONED` → redirect pra tela dedicada `/account-not-found` com contexto.
3. Botão "Sign out" na tela dedicada para o usuário trocar de conta.

**Estimativa:** 4-6h. **Severidade:** MÉDIA (recuperação de incidente — não urgente).

---

### 🟢 BAIXA — Housekeeping (paralelo)

#### P-81 — Runbook de recovery pós-restore Neon PITR

**Descoberto durante:** próprio processo de recuperação de 4 users pós-restore acidental. Cada passo foi improvisado.

**Solução proposta:**
`docs/Runbook_Recovery_Pos_Neon_Restore.md` com:
1. **Detecção:** script de diff Clerk vs banco.
2. **Recuperação seletiva:** template SQL para reinserir user preservando role/tenant do Clerk metadata.
3. **Cache RBAC:** re-executar `rbac:backfill-cache` obrigatório pós-recovery.
4. **Verificação:** checklist de teste (cada role recuperada faz sign-in e acessa dashboard sem loop).

**Estimativa:** 2h. **Severidade:** BAIXA.

---

#### P-83 — Constraint UNIQUE `(tenant_id, email)` deveria ser PARTIAL

**Descoberto por:** Fred, ao reenviar convite para email soft-deleted → erro Prisma "Unique constraint failed".

**Solução proposta:**
Migration:
```sql
DROP INDEX users_tenant_id_email_key;
CREATE UNIQUE INDEX users_tenant_id_email_active_key
  ON users (tenant_id, email)
  WHERE deleted_at IS NULL;
```

**Estimativa:** 30min.

**Dependência:** ~~P-84~~ **nenhuma** — corrigido pelo PO. P-83 e P-84 podem ser chips paralelos independentes.

**Severidade:** BAIXA.

---

#### P-84 — `/admin/users` → Convidar não trata row soft-deleted

**Descoberto:** ao tentar reenviar convite pra email soft-deleted, erro Prisma vaza pra UI como mensagem crua.

**Solução proposta:**
No procedure `users.invite`, antes de `prisma.user.create`:
```
- findFirst incluindo deleted_at != null
- Se existir row soft-deleted:
    → oferecer reativar (UPDATE deleted_at=null, active=true)
    → mensagem amigável: "Este email já foi convidado antes e foi desativado. Deseja reativar?"
```

**Nota:** funciona **sem** depender do P-83 — o UPDATE deleted_at=NULL não exige o partial UNIQUE.

**Estimativa:** 2h. **Dependências:** nenhuma. **Severidade:** BAIXA.

---

## Métricas de sucesso pós-implementação

Depois de encerrar os chips da Semana 1 + P-85 + P-87:

1. **P-88:** Sidebar de ANALISTA/GESTOR/PARCEIRO não mostra Usuários/Produtos/Listas — verificado em prod com cada role.
2. **P-89:** 10 opps criadas em fluxo natural, zero duplicatas no banco. Fluxo redireciona corretamente após sucesso.
3. **P-86:** Admin troca role e desativa user com feedback visual imediato.
4. **P-80:** Neon prod separado de dev. `psql` local não afeta `crm-app-pi-eight.vercel.app`.
5. **P-85:** Email do Clerk chega sem "[Development]" no subject. Instância `pk_live_...` ativa.
6. **P-87:** ANALISTA tenta criar opp com owner=DIRETOR → FORBIDDEN legível. Dropdown mostra apenas pares/subárvore. Audit log grava `opportunity.owner_changed` em delegações válidas.

Todos os cenários registrados no `Roteiro_QA_Homologacao_Staging.md` como V-15G-N a partir de V-15G-7.

---

## Mudanças desta revisão (v3 — 2026-07-11 tarde)

Após simulação de casos reais com o PO, **P-87 evoluiu radicalmente**:

- **P-87 não é "delegação simples"** — é **workflow completo de transferência com aprovação**. Modelo de dados dedicado (`opportunity_transfers`), 7 procedures novas, 3 telas novas, worker cron pra timeout, 7 templates de notificação.
- **Regra cardinal:** apenas ancestor da estrutura de vendas pode disparar (nunca o dono). Destino é par no mesmo nível ou superior direto do disparador. Destinatário escolhe qual analista da sua equipe recebe.
- **Durante pendência:** dono original vê a opp read-only (badge "Em transferência"). Disparador tem controle temporário.
- **Rejeição/timeout/cancelamento:** opp fica com o disparador (não retorna automático ao dono original — confirmação B do PO).
- **Estimativa P-87:** 2-3 dias → **6-7 dias**.
- **Sprint 15G.5 confirmado como Sprint dedicado.** Opção C (embutir no 15H) descartada — sacrificaria Bloco B inteiro (Metas).
- Timeout parametrizável em `TenantSettings.transferTimeoutHours` (default 72h).

## Mudanças da revisão v2 (2026-07-11 manhã)

Observações originais do PO aceitas:

- **P-80 elevado de MÉDIA → ALTA** e trazido pra Dia 1 (LGPD + blast radius existencial + custo baixo).
- **P-85 elevado de MÉDIA → ALTA** e agendado pra Dias 2-3 (bloqueador de vendas B2B; dependência de domínio próprio removida — Clerk Production instance funciona no domínio Vercel existente).
- **P-86 elevado de MÉDIA → ALTA** (sem workaround equivalente; `/admin/users/[id]/permissions` gerencia overrides individuais, não role padrão nem desativação).
- **P-83 ↔ P-84** — dependência removida (P-84 funciona independentemente de P-83).
- **Chips Semana 1** — reconhecidos como paralelizáveis (arquivos disjuntos → 1 dia walltime, não 2).

---

## Referências

- **Sprint 15G contexto:** [Sprint_15G_estrutura_comercial.md](Sprint_15G_estrutura_comercial.md) + [Sprint_15G_amendments.md](Sprint_15G_amendments.md)
- **Sprint 15H já planejado:** [Sprint_15H_Metas_e_Approvals.md](Sprint_15H_Metas_e_Approvals.md)
- **Rollout Sprint 15G executado:** [ROLLOUT_Sprint_15G_Prod.md](ROLLOUT_Sprint_15G_Prod.md)
- **Handoff noturno anterior:** [HANDOFF_Noturno_2026-07-08.md](HANDOFF_Noturno_2026-07-08.md)
