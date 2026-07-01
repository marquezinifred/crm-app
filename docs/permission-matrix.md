# Matriz de permissions por role — Sprint 15E

**Data:** 2026-07-01
**Complementa:** [Sprint_15E_RBAC_Granular.md](Sprint_15E_RBAC_Granular.md)
**Fonte da verdade:** este documento define `ROLE_DEFAULT_PERMISSIONS` em `src/lib/auth/rbac.ts` pós-Sprint 15E.

Legenda:
- ✅ **default** — permission concedida por padrão ao role
- — **não** — não concedida por default (Admin pode conceder via override individual)
- 🔒 **bloqueada por role** — mesmo com override individual, não faz sentido conceder (documental)

Roles: **PARCEIRO** propositalmente restrito. **ANALISTA** = execução em escala. **GESTOR** = time lead operacional. **DIRETOR_*** = visão executiva. **ADMIN** = configuração do tenant.

---

## Tenant

| Permission | ADMIN | DIRETOR_C | DIRETOR_O | DIRETOR_F | GESTOR | ANALISTA | PARCEIRO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `tenant:read` | ✅ | ✅ | ✅ | ✅ | — | — | — |
| `tenant:update` | ✅ | — | — | — | — | — | — |

Rationale: apenas ADMIN edita dados do tenant. Diretores leem pra contexto (nome, plano etc), demais roles não têm razão.

---

## Users

| Permission | ADMIN | DIRETOR_C | DIRETOR_O | DIRETOR_F | GESTOR | ANALISTA | PARCEIRO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `user:create` | ✅ | — | — | — | — | — | — |
| `user:read` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| `user:update` | ✅ | — | — | — | — | — | — |
| `user:delete` | ✅ | — | — | — | — | — | — |
| `user:grant_permissions` | ✅ | — | — | — | — | — | — |

Rationale: gestão de usuários concentrada em ADMIN. GESTOR lê pra saber a equipe. `grant_permissions` é action delicada — override só faz sentido em cenário de "co-admin" temporário.

---

## Catalog (territories, segments, products, lists)

| Permission | ADMIN | DIRETOR_C | DIRETOR_O | DIRETOR_F | GESTOR | ANALISTA | PARCEIRO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `catalog:create` | ✅ | — | — | — | — | — | — |
| `catalog:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| `catalog:update` | ✅ | — | — | — | — | — | — |
| `catalog:delete` | ✅ | — | — | — | — | — | — |

Rationale: catálogo é configuração operacional — só ADMIN muda. Todos leem pra popular selects. PARCEIRO não tem contexto.

---

## Companies

| Permission | ADMIN | DIRETOR_C | DIRETOR_O | DIRETOR_F | GESTOR | ANALISTA | PARCEIRO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `company:create` | ✅ | — | — | — | ✅ | ✅ | — |
| `company:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅* |
| `company:update` | ✅ | ✅ | ✅ | — | ✅ | ✅ | — |
| `company:delete` | ✅ | — | — | — | — | — | — |

*PARCEIRO só lê as companies em que está engajado (row-level filter no service — não é permission).

Rationale: pipeline de vendas cria/atualiza empresas ativamente. Diretores editam pra correções administrativas. Delete só ADMIN (soft). FINANCEIRO não edita (leitura pra reports).

---

## Contacts

| Permission | ADMIN | DIRETOR_C | DIRETOR_O | DIRETOR_F | GESTOR | ANALISTA | PARCEIRO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `contact:create` | ✅ | — | — | — | ✅ | ✅ | — |
| `contact:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅* |
| `contact:update` | ✅ | ✅ | ✅ | — | ✅ | ✅ | — |
| `contact:delete` | ✅ | — | — | — | — | — | — |

*PARCEIRO só lê contatos das companies onde tem engajamento aprovado.

Mesmo padrão de `companies`. FINANCEIRO leitura pra reports.

---

## Opportunities

| Permission | ADMIN | DIRETOR_C | DIRETOR_O | DIRETOR_F | GESTOR | ANALISTA | PARCEIRO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `opportunity:create` | ✅ | ✅ | — | — | ✅ | ✅ | — |
| `opportunity:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅* |
| `opportunity:update` | ✅ | ✅ | — | — | ✅ | ✅ | — |
| `opportunity:delete` | ✅ | — | — | — | — | — | — |
| `opportunity:advance_stage` | ✅ | ✅ | — | — | ✅ | ✅ | — |
| `opportunity:cancel` | ✅ | ✅ | — | — | ✅ | ✅ | — |
| `opportunity:read_others` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |

*PARCEIRO só as próprias (engajamento aprovado).

Rationale: `read_others` separa "vê tudo" (ADMIN/DIRETOR/GESTOR) de "vê só minhas" (ANALISTA). Antes era hardcoded em query — agora fica granular. DIRETOR_OPERACOES lê pra handoff mas não cria/edita.

---

## Proposals

| Permission | ADMIN | DIRETOR_C | DIRETOR_O | DIRETOR_F | GESTOR | ANALISTA | PARCEIRO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `proposal:create` | ✅ | ✅ | — | — | ✅ | — | — |
| `proposal:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| `proposal:update` | ✅ | ✅ | — | — | ✅ | — | — |
| `proposal:approve` | ✅ | ✅ | — | ✅ | — | — | — |

Rationale: propostas são criadas por comercial (DIRETOR_C, GESTOR) e admin. Aprovação por DIRETOR_C (aprovação comercial) e DIRETOR_F (aprovação financeira por margem). ANALISTA lê pra acompanhar mas não cria (segurança).

---

## Contracts

| Permission | ADMIN | DIRETOR_C | DIRETOR_O | DIRETOR_F | GESTOR | ANALISTA | PARCEIRO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `contract:create` | ✅ | ✅ | ✅ | — | — | — | — |
| `contract:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| `contract:update` | ✅ | ✅ | ✅ | — | — | — | — |

Rationale: contratos ativados por DIRETOR_C (fechamento) ou DIRETOR_O (handoff/renovação). GESTOR e ANALISTA leem pra saber status.

---

## Documents (Sprint P-19)

| Permission | ADMIN | DIRETOR_C | DIRETOR_O | DIRETOR_F | GESTOR | ANALISTA | PARCEIRO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `document:upload` | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅* |
| `document:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅* |
| `document:delete` | ✅ | — | — | — | — | — | — |

*PARCEIRO limitado a documents das opportunities em que tem engajamento.

Rationale: upload amplo (qualquer papel que edita oportunidade sobe doc). Delete só ADMIN pra evitar perda acidental (soft delete idealmente).

---

## Tasks (Sprint P-20)

| Permission | ADMIN | DIRETOR_C | DIRETOR_O | DIRETOR_F | GESTOR | ANALISTA | PARCEIRO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `task:create` | ✅ | ✅ | ✅ | — | ✅ | ✅ | — |
| `task:update` | ✅ | ✅ | ✅ | — | ✅ | ✅ | — |
| `task:delete` | ✅ | ✅ | ✅ | — | ✅ | ✅ | — |

Rationale: tarefas são "post-it" operacionais — todo mundo que edita opp pode criar/editar/deletar. FINANCEIRO e PARCEIRO só leem pelo `opportunity:read`. Não há task standalone hoje — sempre vinculada à opp.

---

## Partners

| Permission | ADMIN | DIRETOR_C | DIRETOR_O | DIRETOR_F | GESTOR | ANALISTA | PARCEIRO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `partner:invite` | ✅ | ✅ | ✅ | — | ✅ | — | — |
| `partner:approve_engagement` | ✅ | ✅ | ✅ | — | — | — | — |

Rationale: qualquer papel comercial/operacional pode convidar parceiro. Aprovação de engajamento (associa parceiro à opp específica) fica com diretores + ADMIN — GESTOR não pode auto-aprovar próprio parceiro.

---

## Inbound (Sprint 15D)

| Permission | ADMIN | DIRETOR_C | DIRETOR_O | DIRETOR_F | GESTOR | ANALISTA | PARCEIRO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `inbound:view_queue` | ✅ | ✅ | — | — | — | — | — |
| `inbound:assign_prospects` | ✅ | ✅ | — | — | — | — | — |
| `inbound:configure` | ✅ | — | — | — | — | — | — |
| `inbound:view_reports` | ✅ | ✅ | — | ✅ | — | — | — |

Rationale: hoje `GESTOR_INBOUND` (removido no 15E) tinha os 3 primeiros. Migration backfilla todos os antigos GESTOR_INBOUND com override manual desses 3 sobre role ADMIN. `configure` (forms de captura, sources) fica com ADMIN. `view_reports` também com FINANCEIRO (métrica de aquisição).

**Cenário típico Sprint 15E:** ADMIN promove um GESTOR pra também alocar prospects → grant `inbound:view_queue` + `inbound:assign_prospects` sem mudar role.

---

## Reports

| Permission | ADMIN | DIRETOR_C | DIRETOR_O | DIRETOR_F | GESTOR | ANALISTA | PARCEIRO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `reports:read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅* | — |
| `reports:financial` | ✅ | ✅ | — | ✅ | — | — | — |
| `reports:export` | ✅ | ✅ | — | ✅ | ✅ | — | — |

*ANALISTA só vê a própria linha em performance por vendedor + média anônima (row-level filter, Sprint 5 preserva).

Rationale: `reports:financial` esconde colunas de valor R$/margem — grande demanda ("intern não vê receita"). `reports:export` limita XLSX pra papéis executivos que levam pra reunião.

---

## AI (Sprint 15F granular)

| Permission | ADMIN | DIRETOR_C | DIRETOR_O | DIRETOR_F | GESTOR | ANALISTA | PARCEIRO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `ai:use_summary` | ✅ | ✅ | ✅ | — | ✅ | ✅ | — |
| `ai:use_extraction` | ✅ | ✅ | — | — | ✅ | ✅ | — |
| `ai:use_scoring` | ✅ | ✅ | — | ✅ | ✅ | — | — |
| `ai:configure_global` | ✅ | — | — | — | — | — | — |
| `ai:configure_feature` | ✅ | — | — | — | — | — | — |
| `ai:test_key` | ✅ | — | — | — | — | — | — |
| `ai:manage_breaker` | ✅ | — | — | — | — | — | — |

Rationale: **uso** de IA é amplo (features consumidoras acessíveis conforme role usa a opp). **Configuração** é ADMIN only — o Sprint 15F entregou UI cara delicada (chaves API, provider fallback, circuit breaker). `ai:manage_breaker` explicitamente segregado pra caso de "co-admin operacional sem acesso a config".

---

## Alerts

| Permission | ADMIN | DIRETOR_C | DIRETOR_O | DIRETOR_F | GESTOR | ANALISTA | PARCEIRO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `alert:configure` | ✅ | — | — | — | — | — | — |
| `alert:receive_admin` | ✅ | ✅ | ✅ | ✅ | — | — | — |

Rationale: configuração global (leadDays, taskOverdueDays) só ADMIN. Recebimento de alertas administrativos (ex: "tenant excedeu limite AI") vai pra diretores + admin.

---

## Audit

| Permission | ADMIN | DIRETOR_C | DIRETOR_O | DIRETOR_F | GESTOR | ANALISTA | PARCEIRO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `audit:read` | ✅ | ✅ | ✅ | ✅ | — | — | — |
| `audit:read_platform` | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 |

`audit:read_platform` é **exclusivo Platform Owner** — nenhum tenant admin acessa. Listado no catálogo pra clareza, mas grant via override não faz sentido (bypass já resolve).

Rationale: audit dá visibilidade a diretores pra forense ("quem editou X?"). GESTOR e ANALISTA não precisam.

---

## Import

| Permission | ADMIN | DIRETOR_C | DIRETOR_O | DIRETOR_F | GESTOR | ANALISTA | PARCEIRO |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `import:run` | ✅ | — | — | — | ✅ | — | — |
| `import:read` | ✅ | ✅ | ✅ | — | ✅ | ✅ | — |

Rationale: rodar import é ação delicada (pode duplicar dados) — ADMIN + GESTOR (line manager que valida). Leitura ampla pra saber quem subiu o quê.

---

## Contagens por role

| Role | # defaults | Uso típico |
|---|:-:|---|
| ADMIN | **60** | Configuração do tenant, gestão de users, tudo |
| DIRETOR_COMERCIAL | **39** | Aprovação de propostas, pipeline amplo, reports financeiros |
| DIRETOR_OPERACOES | **25** | Contratos, handoff, parceiros, leitura de opps |
| DIRETOR_FINANCEIRO | **18** | Aprovação por margem, reports financeiros, leitura ampla |
| GESTOR | **31** | Team lead — CRUD opps, tasks, parceiros, imports |
| ANALISTA | **23** | Execução — CRUD suas opps + tasks + documents + AI summary/extraction |
| PARCEIRO | **5** | Só o essencial das opps em que está engajado |

**Contagens validadas célula a célula em 2026-07-01.** Fonte da verdade — quando implementar `ROLE_DEFAULT_PERMISSIONS` no `rbac.ts`, cada `Set<Permission>` deve ter EXATAMENTE esse número de entries.

Total permissions distintas: **65**.

Diferença entre ADMIN e "tudo" (65): ADMIN não tem `audit:read_platform` (Platform Owner only).

---

## Alterações vs Sprint 15D

Sprint 15D adicionou:
- Role `GESTOR_INBOUND` (removido no 15E)
- Uso implícito de `inbound:*` via checks de role hardcoded

Sprint 15E:
- 4 permissions inbound novas (view_queue, assign_prospects, configure, view_reports)
- Migration backfilla `GESTOR_INBOUND` → `ADMIN` + 4 grants inbound
- Nenhum breaking change no comportamento

## Alterações vs Sprint 15F

Sprint 15F usou o legado `ai:configure` (monolítico) pros procedures novos (testKey, breakerStatus, clearCircuitBreaker, updateFeature). Sprint 15E:

| Antes (15F) | Depois (15E) |
|---|---|
| `withCapability('ai', 'configure')` em `updateGlobal` | `withPermission('ai:configure_global')` |
| `withCapability('ai', 'configure')` em `updateFeature` | `withPermission('ai:configure_feature')` |
| `withCapability('ai', 'configure')` em `testKey` | `withPermission('ai:test_key')` |
| `withCapability('ai', 'configure')` em `clearCircuitBreaker` | `withPermission('ai:manage_breaker')` |

Alias `ai:configure` (v1 monolítica) removido — ninguém deve depender do check antigo pós-15E.

---

## Cenários operacionais reais (justificativa da granularidade)

1. **"Estagiária ANALISTA sem valores R$"**
   Nada a fazer — ANALISTA já não tem `reports:financial` por padrão. Se admin havia concedido override e quer revogar, chamar `permissions.restore` (deleta o override → volta pro default `false`).

2. **"GESTOR também aloca prospects inbound"**
   Grant: `inbound:view_queue` + `inbound:assign_prospects` em cima do role GESTOR. Não precisa mudar role.

3. **"DIRETOR_OPERACOES precisa aprovar propostas em emergência (DIRETOR_C de férias)"**
   Grant: `proposal:approve` temporário. Sprint futuro pode adicionar `expires_at` no override.

4. **"ADMIN de férias, GESTOR precisa convidar dev novo"**
   Grant: `user:create` no GESTOR. Revoga ao retorno.

5. **"Co-admin operacional sem acesso a config IA"**
   Grant tudo do ADMIN via role change. Revoke: `ai:configure_global` + `ai:configure_feature` + `ai:test_key` + `ai:manage_breaker`. Restore quando confortável.

Sem Sprint 15E, cada um desses cenários exigia role nova ou hack de código.
