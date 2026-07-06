# Metodologia de Desenvolvimento — Venzo CRM

> Documento único de padrões de trabalho. Consolida acordos operacionais + regras
> técnicas + padrão de fechamento de tarefa que evoluímos ao longo das Sprints
> 0–15E. Toda pessoa (humana ou IA) que trabalha neste repo deve seguir isto.
>
> **Última atualização:** 2026-07-04
>
> **Fonte da verdade única.** Se algo neste doc conflita com CLAUDE.md ou
> Backlog_Pos_MVP.md, este doc vence. CLAUDE.md continua sendo o changelog vivo
> das sprints; este doc é o processo.

---

## 1. Modelo mental — quem faz o quê

### 1.1. Sessão paterna (esta) — QA/gestor/arquiteto
Não escreve código de app. Responsabilidades:
- Planejar sprints/débitos
- Escrever specs e docs
- Spawnar chips (via `spawn_task`) para trabalho de código
- Revisar merges, aplicar decisões finais (mergir, resolver conflitos)
- Manter Backlog_Pos_MVP.md, CLAUDE.md, HANDOFF_Estado_Atual, este doc e o
  Roteiro_QA_Homologacao_Staging.md alinhados
- Coordenar chips paralelos (áreas disjuntas)

### 1.2. Chips (Task tool + skill dev)
Escrevem código. Um chip = um débito P-XX ou uma sub-tarefa de sprint.
- Cada chip abre worktree isolado (branch `claude/<nome>`)
- Cada chip termina com commit(s) na sua branch e reporta título do commit +
  arquivos tocados no chat
- Chips paralelos podem coexistir se áreas de código são disjuntas — coordenar
  via `git pull` antes de mergir

### 1.3. QA Automation (chip especializado)
Após mergir chip com código de app, spawnar chip de QA automation via skill
`anthropic-skills:qa-automation`. Rodá Vitest + tsc + lint + Playwright, analisa
falhas, referencia arquivo:linha, devolve **plano de correção**. Sessão paterna
consome esse plano e decide: aplicar direto (fix trivial), spawnar chip de fix
(fix complexo), ou registrar débito P-XX (baixa prioridade).

---

## 2. Fluxo canônico de uma tarefa (do débito até merge)

```
Débito identificado
   ↓
Registrar no Backlog_Pos_MVP.md com ID P-XX + severidade + escopo
   ↓
[opcional] Debater com PO / atualizar spec
   ↓
Spawn chip via spawn_task — prompt inclui o Checklist de fechamento (§3)
   ↓
Chip trabalha em worktree isolado — 1 ou mais commits
   ↓
Chip reporta no chat: título commit(s), arquivos tocados, contagem linhas,
próximos passos identificados
   ↓
Sessão paterna faz merge --no-ff na branch main (nunca push)
   ↓
Validação local: npx tsc --noEmit && npm run lint
   ↓
Spawn chip QA Automation — skill anthropic-skills:qa-automation
(OBRIGATÓRIO — não opcional. Comportamento default da sessão paterna.)
   ↓
Consumir plano de correção do QA:
   • Zero falhas → task fecha
   • Falhas triviais → aplicar direto na paterna
   • Falhas complexas → spawn chip de fix (loop volta pro fluxo)
   ↓
Atualizar task list (TaskUpdate) marcando como completed
   ↓
Atualizar Backlog_Pos_MVP.md marcando débito como ✅ FECHADO com commit hash
   ↓
Atualizar CLAUDE.md changelog
   ↓
Se mudança tem impacto UX/funcionalidade em staging:
atualizar docs/Roteiro_QA_Homologacao_Staging.md com cenário pass/fail
```

---

## 3. Checklist de fechamento do chip (OBRIGATÓRIO)

Todo prompt de `spawn_task` **deve** conter este checklist verbatim ou uma
versão instruída ao chip:

### 3.1. Código
- [ ] Todo `.update`/`.create`/`.upsert` passa `tenantId` explícito no payload
      (ou o modelo está no `ALLOW_MISSING_TENANT_ON_WRITE` com justificativa)
- [ ] Toda entrada de usuário validada com **Zod no servidor**
- [ ] Zero secret hardcoded
- [ ] Zero `console.log` com PII ou tokens
- [ ] Data masking obrigatório antes de chamar IA (`masking.mask()` → provider
      → `masking.unmask()`)
- [ ] `tenantIdOverride: ctx.tenantId` em toda chamada de `audit()` dentro de
      procedures tRPC
- [ ] RBAC — endpoints usam `withPermission('resource:action')` (Sprint 15E)
      ou justificam por que ainda usam `withRoles`/`withCapability`
- [ ] Soft delete (deleted_at) em vez de DELETE real

### 3.2. Testes
- [ ] Vitest unit test para toda função pura nova
- [ ] Supertest para procedures tRPC ou endpoints REST (cross-tenant, RBAC,
      erros esperados)
- [ ] Playwright para fluxo E2E (se toca UI)
- [ ] Baseline preservado: `npx tsc --noEmit && npm run lint && npm test`
      com zero regressão vs baseline pré-chip
- [ ] Se pulou testes, justificativa por escrito no commit (ex: "infra sem
      código app", "doc-only change")

### 3.3. Documentação
- [ ] `docs/Backlog_Pos_MVP.md` — débito marcado como ✅ FECHADO com commit hash
- [ ] `CLAUDE.md` — nova seção no changelog com bullets do que foi entregue,
      testes, baseline
- [ ] `docs/Roteiro_QA_Homologacao_Staging.md` — se afeta UX/funcionalidade em
      staging, adicionar cenário pass/fail com passos executáveis
- [ ] Se cria doc novo, entrar na tabela §7 de `HANDOFF_Estado_Atual_*.md`

### 3.4. Commit
- [ ] Conventional Commits: `feat:`, `fix:`, `chore:`, `test:`, `docs:`,
      `refactor:`
- [ ] `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` no rodapé
- [ ] Nunca `--no-verify` (pre-commit hooks são obrigatórios)
- [ ] Nunca push direto pro remote — sessão paterna faz merge e decide push

### 3.5. Reporte
Ao final, o chip responde no chat com:
- Título do(s) commit(s)
- Arquivos tocados + contagem de linhas
- Baseline antes/depois
- Débitos residuais identificados (candidatos a P-XX novos)

---

## 4. Regras arquiteturais não-negociáveis

### 4.1. Multi-tenancy — defesa em profundidade
Camada 1 (Prisma extension em `src/server/db/client.ts`) injeta `WHERE tenant_id`
automaticamente. Camada 2 (RLS PostgreSQL) bloqueia mesmo se camada 1 falhar.

**Ambas precisam ser bypassadas para haver vazamento.**

Fluxo obrigatório em qualquer request autenticada:
```
Clerk middleware extrai sessionClaims.public.tenantId → x-tenant-id header
   ↓
Route handler chama runWithTenant({tenantId, userId, role}, async () => ...)
   ↓
tRPC procedure roda dentro do AsyncLocalStorage
   ↓
Prisma extension injeta {where: {..., tenantId}} ou {data: {tenantId, ...}}
   ↓
PostgreSQL RLS aplica current_tenant_id() como segunda barreira
```

**Bug conhecido:** dentro de `fetchRequestHandler` do tRPC, o AsyncLocalStorage
escapa em callbacks assíncronos. **SEMPRE** passar `tenantIdOverride: ctx.tenantId`
em `audit()` dentro de procedures tRPC. Ver
[audit-trpc-context-loss](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/audit-trpc-context-loss.md).

### 4.2. Data Masking obrigatório antes de IA
NUNCA passar PII (nomes, emails, CPF/CNPJ, telefones, endereços, valores) direto
pra provider de IA. Usar `DataMaskingService`:

```typescript
import { masking } from '@/lib/ai/masking';

const { masked, map } = masking.mask(userText);
// enviar `masked` pro provider
const response = await dispatchChat('feature-name', tenantId, { messages: [{ role: 'user', content: masked }] });
const safe = masking.unmask(response.text, map);
```

Regressão coberta por `tests/unit/ai-masking-preserved.test.ts` (grep no source
verificando ordem `masking.mask` → `dispatchChat`).

### 4.3. Validação
- Servidor: Zod obrigatório em todo input
- Cliente: validação opcional (só UX), nunca fonte da verdade
- Erros Zod chegam ao cliente via `errorFormatter` em `trpc.ts` e são
  renderizados por `friendlyTrpcError` (helper em `src/lib/trpc/error-format.ts`)

### 4.4. Audit log
Toda ação sensível (create/update/delete/config change/permission grant/impersonation)
grava em `audit_logs` via `audit()`. Sempre com `tenantIdOverride: ctx.tenantId`
em procedures tRPC. Payloads sensíveis (secrets, tokens) devem ser redactados
antes de gravar.

### 4.5. RBAC granular (Sprint 15E)
- Roles são perfis padrão (`ADMIN`, `DIRETOR_COMERCIAL`, etc)
- Admin pode conceder/revogar permissions individuais via `permission_overrides`
- Endpoints usam `withPermission('resource:action')`
- Cascata: override individual > default do role
- Guard anti-escalada: só quem tem a permission pode delegá-la (Platform Owner
  isento)
- Cache em `users.cached_permissions` (2 colunas: valor + timestamp; NULL vs `[]`
  são distintos)
- Backfill obrigatório pós-migration via `npm run rbac:backfill-cache`

### 4.6. Feature flags
Toda mudança arquitetural com risco de rollback rápido usa feature flag em
`env.ts`. Padrões:
- `RBAC_GRANULAR_ENABLED` — Sprint 15E kill-switch
- `MULTI_AI_ENABLED` — Sprint 15F kill-switch
- Default: `false` até staging validar

### 4.7. Soft delete
Toda entidade tem `deleted_at DateTime?`. Queries filtram implicitamente. DELETE
real só em rota específica de LGPD (`/api/v1/gdpr/erase` — anonimização).

### 4.8. Mobile-first
Breakpoint base 375px. Bottom navigation em mobile. Tables → cards em < 768px.
Touch targets ≥ 44×44px.

### 4.9. Feature flags booleanas — `envBoolean` obrigatório
**NUNCA** usar `z.coerce.boolean()` para env vars. `z.coerce.boolean(v)` invoca
`Boolean(v)` em JS, e `Boolean("false") === true` (qualquer string não-vazia é
truthy). Isso silenciosamente **liga** flags que o admin escreveu como `"false"`.
Bug bombástico descoberto no P-60 — `RBAC_GRANULAR_ENABLED`, `MULTI_AI_ENABLED`
e `AXIOM_LOG_QUERIES` estavam sujeitos ao problema; um kill-switch escrito como
`false` no `.env` era interpretado como `true` sem qualquer alerta, invalidando
a promessa de rollback rápido.

Use sempre o helper `envBoolean(default)` de `src/lib/env.ts`:
- `"true" | "1" | "yes" | "on"` (case-insensitive, trim) → `true`
- `"false" | "0" | "no" | "off" | ""` → `false`
- `undefined`, `null` OU valor desconhecido → default

Todo novo kill-switch de release ou flag runtime que entra em `envSchema` deve
seguir esse padrão. Regressão coberta por
`tests/unit/env-schema-regression.test.ts` (grep estrutural em `src/lib/env.ts`)
+ `tests/unit/env-boolean-parsing.test.ts` (parsing case-a-caso).

---

## 5. Padrões de teste

### 5.1. Camadas

| Camada | Ferramenta | Quando |
|---|---|---|
| Unit | Vitest | Funções puras, services, hooks, componentes React isolados |
| Integration | Supertest | Procedures tRPC, endpoints REST, cross-tenant, RBAC |
| E2E | Playwright | Fluxos críticos de usuário (onboarding, pipeline, IA) |
| Visual | Playwright + screenshots | Baseline de 25 rotas × 3 viewports (P-03) |
| Accessibility | axe-core smoke | 5 rotas públicas + 4 autenticadas (Sprint 14) |

### 5.2. Baseline atual (2026-07-05, pós P-47)

Vitest carrega `.env` automaticamente (P-47 fix). Precedence
`.env.test → .env.local → .env` via `tests/env-setup.ts`. Zero
dependência de `source .env.local` manual antes de `npm test`.

Baseline canônico (sem variância — mesmo número em CI, worktree,
paterna, chip QA):

| Cenário | Passing / Failing / Skipped | Total |
|---------|------------------------------|-------|
| Env file presente (`.env.local` OU `.env`, com schema Zod válido) | **741 / 6 / 172** | 919 |
| Env file com `ANTHROPIC_API_KEY` real | **747 / 0 / 172** | 919 |
| Sem env file (CI que não injetou env vars via `env:` do GH Actions) | **693 / 10 / 172** | 875 |

- Os 6 failings do primeiro cenário são todos de
  `tests/unit/communication-summary-errors.test.ts` — dependem de
  `ANTHROPIC_API_KEY` real. Passam com chave real
- Os 10 failings do cenário CI vêm de 9 test files falhando no
  import por Zod ausência. Comportamento correto do fix — carrega
  só se .env existe
- 172 skipped inclui ~170 estáticos + 2 conditional (RBAC +
  tenant-isolation guardados por `DATABASE_URL_TEST`)
- Type-check: zero
- Lint: zero (paterna e worktrees)

**Histórico pré-P-47:** baseline oscilava 693/709/715/726/741
dependendo se o dev/CI/chip fazia `source .env.local` manual antes.
Todos eram o mesmo baseline verde subjacente — só a leitura variava.
Sem regressão de código real. Ver [CLAUDE.md §"Baseline de testes
atual"](../CLAUDE.md) pra fonte da verdade.

**Novo chip não pode piorar baseline.** Se piorar, chip volta pra
worktree com plano de correção do QA automation.

### 5.3. Cobertura mínima de novo procedure tRPC
Todo procedure novo deve ter:
1. Teste unit da função pura (se houver)
2. Teste do procedure com contexto autenticado + payload válido → success
3. Teste cross-tenant: user do Tenant A não vê/modifica dado do Tenant B → 404
4. Teste RBAC: user sem permission → 403
5. Teste audit: mutation deixa entrada em audit_logs com override correto
6. Se envolve IA: teste que masking preserva ordem (grep no source)

---

## 6. Padrões de migration Postgres

Ver [migration-pitfalls](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/migration-pitfalls.md).
5 padrões recorrentes:

1. **Cast enum_old[]→text[]→enum_new[]** — recriar enum via RENAME_old + cast
   coluna por coluna
2. **Sanitizar valores antes de DROP enum** — evita CHECK constraint failure
3. **Partial UNIQUE para coluna nullable** — `WHERE col IS NOT NULL` em vez de
   `NULLS NOT DISTINCT` (compat Postgres 14+)
4. **CHECK XOR + UNIQUE global = bloqueio dual identity** — usar partial
   UNIQUE + `@@unique([col, tenantId])` com nota SQL como fonte da verdade
5. **RLS default policy** para toda tabela nova com `tenant_id`

Testes obrigatórios em migrations:
- `tests/unit/rbac-migration-XXXX.test.ts` — fs scan do SQL confirmando shape
- Aplicação em Neon dev via `npx prisma migrate deploy` sem drift
- Rollback plan documentado no PR

---

## 7. Padrões de commit

### 7.1. Conventional Commits
```
feat(scope): add X
fix(scope): resolve Y
chore(scope): update Z
docs(scope): document W
refactor(scope): rename V
test(scope): cover U
```

### 7.2. Rodapé obrigatório
```
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

### 7.3. Nunca
- `--no-verify` (pre-commit hooks)
- `--amend` (cria commit novo)
- `push --force` em main
- `git reset --hard` sem justificativa

### 7.4. Sempre
- Um commit por unidade lógica
- Mensagem 1-2 sentenças focando no "porquê"
- HEREDOC para mensagens multi-linha
- Referenciar débito P-XX quando aplicável

---

## 8. Padrões de merge

### 8.1. Merge de chip → main
Sempre `--no-ff` para preservar histórico:
```bash
git merge claude/<worktree-name> --no-ff -m "Merge P-XX: descrição curta"
```

### 8.2. Conflitos esperados
Docs (Backlog, CLAUDE.md, HANDOFF) — padrão de resolver: **concatenar ambos**.

### 8.3. Ordem de merges paralelos
Do menor pro maior. Chips com áreas disjuntas: qualquer ordem.

### 8.4. Post-merge validation
```bash
npx tsc --noEmit && npm run lint && npm test
```
Baseline preservado ou plano de correção via QA automation.

---

## 9. Padrões de spawn de chip

### 9.1. Anatomia do prompt

```
## Missão
[1 parágrafo: o que + por que]

## Contexto obrigatório de leitura
1. CLAUDE.md
2. docs/Backlog_Pos_MVP.md (débito P-XX de referência)
3. [specs específicas]
4. [arquivos-chave]

## Escopo
Faça:
- [item 1]
- [item 2]

NÃO faça:
- [não escopo 1]
- [não escopo 2]

## Regras arquiteturais aplicáveis
[Chamar §4 do Metodologia_Desenvolvimento_Venzo.md — data masking,
tenant isolation, audit, RBAC — que se aplicam ao escopo]

## Checklist de fechamento (obrigatório)
[Copiar §3 verbatim ou linkar]

## Entrega
Commit único (ou N) na branch claude/<worktree>. NÃO PUSHE.
Ao fim responda no chat com: título commit(s), arquivos, linhas, débitos residuais.
```

### 9.2. Escopo cirúrgico
Cada chip resolve **1 débito ou 1 sub-tarefa de sprint**. Nunca 2 débitos no
mesmo chip — vira PR bagunçado, conflito de merge complicado, rollback difícil.

### 9.3. Chips paralelos ok se áreas disjuntas
Até 5-6 chips simultâneos toleráveis. Coordenar via git pull antes de mergir.

### 9.4. Após merge → QA automation (OBRIGATÓRIO)
Regra permanente 2026-07-04: **sempre spawnar chip QA automation após mergir
chip com código de app**. É comportamento default da sessão paterna, não
opcional — não requer confirmação do Fred, é parte do fluxo canônico §2.

**Exceções raras (justificar por escrito):**
- Docs-only: sem código app, nada a testar
- Tooling/infra sem impacto runtime: `.gitignore`, `Dockerfile.worker`, etc
- Config puramente declarativa: env.example update sem mudança de código

**Regra prática:** se ficar em dúvida se pula ou não → **NÃO pula, spawn o QA**.
Custo do chip QA (~20-40min local) < custo de deixar regressão passar.

### 9.5. Prompt canônico do chip QA (template)

Personalize apenas os 3 blocos marcados `<...>`; o resto fica fixo:

```
Execute a skill anthropic-skills:qa-automation contra o estado atual do main (@<commit>).

Contexto — últimos merges relevantes:
<listar 3-5 commits recentes com descrição curta>

Foco crítico: <arquivo(s) tocados pelo chip que acabou de mergir>

Fases obrigatórias:
1. Baseline pré (checkout do commit ANTES do último merge de código) — capturar counts npm test / tsc / lint
2. Baseline pós (main atual) — mesmos comandos
3. Diff pre vs post
4. Playwright se conseguir subir dev server
5. Cobertura das áreas tocadas (--coverage.include específico)
6. Análise de cada regressão com arquivo:linha + causa raiz + fix sugerido

Formato de entrega:
# QA Automation Report — main @ <commit>
## 1. Baseline (pré/pós/diff)
## 2. Type-check
## 3. Lint
## 4. Playwright
## 5. Cobertura das áreas tocadas
## 6. Regressões críticas (teste | file:line | erro | causa | fix | prioridade)
## 7. Débitos residuais candidatos P-XX
## 8. Recomendação final (OK seguir OU STOP spawn chip de fix)

Regras:
- Reporte é o único artefato — nenhum commit
- git só read-only (checkout/log/diff/status)
- Números exatos, sem arredondar
- Se algo travar (env var, porta, cred), documenta como P-XX candidato
- NÃO corrigir bugs — fixes vêm em chip separado
```

Task list mantém 1 task ativa por QA (padrão: "Aguardar QA automation pós-<X>").

Prompt padrão pro chip QA:
```
Rode a suite completa (npm test + npx tsc --noEmit + npm run lint + Playwright
quando aplicável). Analise falhas referenciando arquivo:linha. Devolva:
1. Baseline pré-mudança (main~1) vs pós-mudança (main)
2. Testes novos vs regressões
3. Cobertura das áreas tocadas
4. Plano de correção priorizado (crítico → nice-to-have) com arquivo:linha
   sugerido pro fix

Não corrija bugs — só reporte. Se sugerir fix, fix vem em chip separado.
```

---

## 10. Segurança operacional

### 10.1. Secrets
- Zero hardcode
- `.env*` NUNCA commitado (pattern amplo em .gitignore)
- Chaves IA criptografadas antes de `prisma.update` (`encryptField` /
  `decryptField` em `src/lib/crypto/field-encryption.ts`)
- Chave IA nunca em log, response tRPC ou audit payload

### 10.2. Rate limiting
Endpoints públicos (`/api/v1/inbound/*`, `/api/v1/consent`, `/api/v1/privacy-request`)
usam sliding window Redis via `src/lib/security/rate-limiter.service.ts`.

### 10.3. Security headers
Middleware Next.js aplica CSP + HSTS + X-Frame-Options DENY + Permissions-Policy
via `src/lib/security/headers.ts`.

### 10.4. Guards
- `assertCanAssignSuperAdmin` — só SUPER_ADMIN atribui SUPER_ADMIN
- Guard anti-escalada RBAC — só quem tem permission pode delegá-la
- Cross-tenant returns 404 (não 403) para evitar enumeration

### 10.5. Auditoria contínua
- Dependabot: npm semanal, GH Actions semanal, Docker mensal
- Semgrep + npm audit em CI
- OWASP ZAP baseline scan semanal
- Data subject requests com SLA 15d ANPD

---

## 11. Rollout e rollback

### 11.1. Rollout ordenado (padrão Sprint 15E)
1. Deploy código com feature flag = `false`
2. `npx prisma migrate deploy`
3. Backfill script obrigatório (se houver)
4. Ativar feature flag = `true` primeiro em staging
5. Monitorar audit_logs 24-72h
6. Ativar em prod
7. Monitorar 3-7 dias
8. Expandir para 100%

### 11.2. Rollback rápido
Toda mudança arquitetural com risco deve ter kill-switch runtime (feature flag).
Rollback = setar flag `false` no Vercel — sem redeploy.

### 11.3. Rollback pesado
Se schema breaking, migration reversa em `prisma/migrations/XXXX_revert/`.
Sempre testar em Neon dev antes.

---

## 12. Documentação obrigatória

### 12.1. Docs vivos
- `CLAUDE.md` — changelog resumido de sprints + instruções permanentes
- `docs/Backlog_Pos_MVP.md` — todos os débitos P-XX com status
- `docs/HANDOFF_Estado_Atual_YYYY-MM-DD.md` — snapshot de sessão
- `docs/Roteiro_QA_Homologacao_Staging.md` — cenários pass/fail pós-deploy
- `docs/Metodologia_Desenvolvimento_Venzo.md` — este doc

### 12.2. Specs de sprint
- `docs/Sprint_XX_Nome.md` — versionadas (v1, v2, v3) com histórico de correções
  do PO
- Aceite quando PO valida spec por escrito (comentário no doc ou aprovação em chat)

### 12.3. Runbooks operacionais
- `docs/Runbook_Staging.md` — troubleshooting operacional
- `docs/DEPLOY_Vercel_Guide.md` — procedimento deploy Vercel
- `docs/DEPLOY_Railway_Worker.md` — procedimento deploy worker BullMQ
- `docs/Observability.md` — Sentry + Axiom setup

### 12.4. Memórias (para próximas sessões)
Em `~/.claude/projects/…/memory/`. Escopo:
- `feedback_*` — regras de trabalho aprendidas por correção/confirmação
- `project_*` — decisões que afetam suggestions
- `reference_*` — apontadores pra sistemas externos
- `user_*` — perfil do Fred

---

## 13. Antipatterns (não fazer)

### 13.1. Código
- ❌ `findUnique` por `clerkId` (usar `findFirst` com `(clerkId, tenantId)` filter)
- ❌ `audit()` sem `tenantIdOverride` em procedures tRPC
- ❌ Chamar `dispatchChat` sem masking antes
- ❌ `withRoles(...)` para novo endpoint (usar `withPermission('resource:action')`)
- ❌ `console.log(user)` (PII leak)
- ❌ Hardcode de tenant IDs em teste (usar fixtures)
- ❌ DELETE real (usar soft delete)
- ❌ `z.coerce.boolean()` em env var (usar `envBoolean(default)` — ver §4.9)

### 13.2. Processo
- ❌ Chip que resolve 2 débitos ao mesmo tempo
- ❌ Push direto pro main sem merge
- ❌ `--no-verify` pra pular hooks
- ❌ Mergir sem rodar `npx tsc && npm run lint`
- ❌ Fechar débito sem atualizar `Backlog_Pos_MVP.md`
- ❌ Nova feature UX sem cenário no `Roteiro_QA_Homologacao_Staging.md`
- ❌ Spawn chip sem checklist de fechamento no prompt
- ❌ Merge de chip com código de app sem QA automation depois

### 13.3. Comunicação
- ❌ Assumir que PO revisa spec sem pedir explicitamente
- ❌ Deploy prod sem flag `false` primeiro
- ❌ Compartilhar credencial (Neon, Clerk, Anthropic) em chat sem rotação
  planejada
- ❌ Prometer feature no changelog antes do chip fechar

---

## 14. Referências rápidas

- **CLAUDE.md** (raiz) — instruções permanentes + changelog
- **docs/Backlog_Pos_MVP.md** — P-01 a P-36 com status
- **docs/HANDOFF_Estado_Atual_2026-07-01.md** — snapshot atual
- **docs/Roteiro_QA_Homologacao_Staging.md** — cenários pass/fail
- **docs/QA_Automation_Report_Sprint_15E.md** — 17 arquivos testes cobrindo 26 ACs
- **docs/Runbook_Staging.md** — troubleshooting
- **docs/DEPLOY_Vercel_Guide.md** + **docs/DEPLOY_Railway_Worker.md** — deploy
- **docs/Observability.md** — Sentry + Axiom

Specs de sprint em `docs/Sprint_*.md`.

Memórias em `~/.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/`.

---

## 15. Evolução desta metodologia

Sempre que uma nova regra de trabalho for validada (feedback do Fred, decisão
de rollout, incidente que virou padrão preventivo), adicionar aqui + memória
correspondente + link cruzado com o débito que originou.

**Reviews recomendados:** a cada 5 sprints ou quando 3+ chips consecutivos
falharem por não seguir alguma regra deste doc.
