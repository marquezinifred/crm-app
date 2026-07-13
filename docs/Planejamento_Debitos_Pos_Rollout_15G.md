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

**Recomendação de sequenciamento revisada:**

| Quando | Itens | Observação |
|--------|-------|------------|
| **Dia 1 (paralelo, 4 chips walltime = 1 dia)** | P-88, P-89, P-86, P-80 | Arquivos disjuntos → paralelo real. P-80 sai de Sprint 16 pra cá. |
| **Dia 2-3** | P-85 (Clerk Production instance) | Sem esperar domínio próprio — pode operar no domínio Vercel existente. |
| **Sprint 15G.5 (2-3 dias)** | P-87 (writeScope + delegação hierárquica) | Antes do 15H (mini-sprint dedicado). |
| **Sprint 15H (8-10 dias)** | Blocos A + B + C originais | Escopo intacto — P-87 sai fora. |
| **Housekeeping (qualquer momento, paralelo)** | P-83, P-84, P-81 | Sem dependência entre si. |
| **Sprint 16** | P-82 (loop 401 → tela dedicada) | Mantém — não é urgente. |

**⚠️ Decisão em aberto pro PO:** o texto abaixo apresenta **duas opções** para P-87. A **Opção A (split em Sprint 15G.5)** foi adotada na tabela acima. Se preferir **Opção C (P-87 dentro do 15H, Metas empurra pra 15I)**, sinalizar antes do kickoff.

**Estimativa total agregada revisada:** ~11-13 dias de trabalho até fim do 15H (contra 8-10 no plano original).

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

#### P-87 — Delegação hierárquica de oportunidade

**Descoberto por:** Fred, logado como ANALISTA, criando opp e atribuindo `ownerId` a DIRETOR_COMERCIAL. Recebeu **NOT_FOUND** ao ser redirecionado — Sprint 15G escondeu corretamente a opp que ele não pode ver.

**Sintoma real:** ANALISTA pode escolher qualquer usuário como responsável no form. Se escolher outro, cria a opp mas "perde" ela (não vê mais em nenhum lugar).

**Root cause:** Backend `opportunities.create` valida escopo de **leitura** via Sprint 15G, mas **não valida escopo de escrita** (quem pode ser owner).

**Regra de negócio proposta (validada com PO — versão 2 após refinamento):**

Caller pode definir `ownerId` diferente dele se:
1. Owner é **ele mesmo** (sempre OK), OU
2. Owner está na **subárvore que caller gerencia** (ltree, mesmo pattern `read_team`), OU
3. Owner está no **mesmo nível hierárquico** do caller (par) — **com refinamento pendente de decisão do PO** (ver quadro abaixo).

**⚠️ Decisão em aberto pro PO — refinamento da regra "par no mesmo nível":**

| Delegação | Regra atual | Refinamento proposto | Nota |
|-----------|-------------|----------------------|------|
| Analista → analista **mesma unidade** | ✅ OK | ✅ OK | Sem controvérsia |
| Analista → analista **unidade irmã** (mesmo gestor) | ✅ permitido | ✅ permitido | Faz sentido — mesmo time expandido |
| Analista → analista **unidade diferente** (outro branch, outro gestor) | ✅ permitido | ⚠️ **PO decide** | Ver problema abaixo |
| Analista → gestor acima | ❌ bloqueado | ❌ bloqueado | Sem controvérsia |

**Problema com a regra atual (sem refinamento):**

Se Analista SP transfere opp para Analista RJ (equipes diferentes sob gestores diferentes), o **Gestor de RJ passa a ver essa opp** via `read_team` (a opp cai na subárvore que ele gerencia). Isso significa que o Analista SP está efetivamente **expondo dados** pra um gestor de outra equipe. Provavelmente não é a intenção — é side effect.

**Pergunta pro PO:** um vendedor de SP pode transferir um lead pra um vendedor do RJ mesmo sendo equipes diferentes sob gestores diferentes?
- **Se SIM:** regra atual está certa. Documentar side effect ("Gestor RJ verá a opp").
- **Se NÃO:** condição "mesmo nível" precisa virar "mesma unidade" ou "unidade irmã" (mesma subárvore de um gestor comum).

---

**Solução técnica (independente da decisão do refinamento):**

**Backend:**
1. **Consolidar em uma única query:** `salesStructure.myScopes` retornando `{ readScope, writeScope }` numa chamada só (ver ponto técnico abaixo).
2. `opportunities.create` valida `ownerId` contra `writeScope`. Se fora, throw FORBIDDEN.
3. `opportunities.update` idem quando altera `ownerId` (transferência).
4. **Audit log obrigatório** — quando `create.ownerId != callerId` OU `update.ownerId` muda, gravar entry:
   ```
   action: 'opportunity.owner_changed'
   metadata: { fromOwnerId, toOwnerId, callerId, opportunityId, reason }
   ```

**Frontend:**
1. `/pipeline/new` filtra dropdown "Responsável interno" pelos users em `writeScope`.
2. Se caller = ANALISTA sem pares na unidade → dropdown pré-preenchido com o próprio + disabled.
3. `salesStructure.myScopes` cacheado por sessão (React Query — invalidação só em `sales_structure:*` mutations).

**Testes:**
- Backend: 6 casos por role × cenários da tabela acima (ADMIN/DIRETOR/GESTOR/ANALISTA/PARCEIRO).
- Frontend: component test do form com role ANALISTA vs GESTOR — dropdown popula diferente.
- E2E: analista tenta forçar payload com ownerId inválido → FORBIDDEN + audit log NÃO grava (bloqueio antes).
- E2E: transferência legítima → audit log grava com `action: 'opportunity.owner_changed'`.

**Estimativa:** 2-3 dias.

**Dependências:** Sprint 15G (base) — atendida.

**Severidade:** ALTA (feature bloqueadora do modelo real de trabalho).

**Decisão em aberto pro PO — SPRINT ORGANIZATION:**

| Opção | Descrição | Impacto |
|-------|-----------|---------|
| **Opção A (adotada na tabela executiva)** | **Sprint 15G.5 dedicado (2-3 dias)** antes do 15H | 15H mantém escopo original 8-10 dias. Total: 15G.5 (3d) + 15H (10d) = 13d |
| Opção C | P-87 dentro do 15H, Bloco B (Metas) escorrega pro 15I | 15H fica 10-12d, Metas atrasa ~4d |

**PO precisa decidir antes do kickoff.**

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

## Mudanças desta revisão (v2 — 2026-07-11)

Todas as observações do PO foram aceitas:

- **P-80 elevado de MÉDIA → ALTA** e trazido pra Dia 1 (LGPD + blast radius existencial + custo baixo).
- **P-85 elevado de MÉDIA → ALTA** e agendado pra Dias 2-3 (bloqueador de vendas B2B; dependência de domínio próprio removida — Clerk Production instance funciona no domínio Vercel existente).
- **P-86 elevado de MÉDIA → ALTA** (sem workaround equivalente; `/admin/users/[id]/permissions` gerencia overrides individuais, não role padrão nem desativação).
- **P-87 refinamento da regra** — pergunta explícita ao PO sobre transferência cross-branch (Analista SP → Analista RJ expõe opp ao Gestor RJ via `read_team`). Solução técnica ganhou `myScopes` unificado + audit log obrigatório.
- **P-83 ↔ P-84** — dependência removida (P-84 funciona independentemente de P-83).
- **Chips Semana 1** — reconhecidos como paralelizáveis (arquivos disjuntos → 1 dia walltime, não 2).
- **Sprint organization P-87** — 2 opções explícitas (Opção A adotada / Opção C em aberto pra PO).

---

## Referências

- **Sprint 15G contexto:** [Sprint_15G_estrutura_comercial.md](Sprint_15G_estrutura_comercial.md) + [Sprint_15G_amendments.md](Sprint_15G_amendments.md)
- **Sprint 15H já planejado:** [Sprint_15H_Metas_e_Approvals.md](Sprint_15H_Metas_e_Approvals.md)
- **Rollout Sprint 15G executado:** [ROLLOUT_Sprint_15G_Prod.md](ROLLOUT_Sprint_15G_Prod.md)
- **Handoff noturno anterior:** [HANDOFF_Noturno_2026-07-08.md](HANDOFF_Noturno_2026-07-08.md)
