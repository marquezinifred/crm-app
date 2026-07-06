# Metodologia de Desenvolvimento — Venzo CRM

> Documento único de padrões de trabalho. Consolida acordos operacionais + regras
> técnicas + padrão de fechamento de tarefa que evoluímos ao longo das Sprints
> 0–15F e da série de fixes P-01 a P-77.
>
> **Última atualização:** 2026-07-06 (reconstrução com feedbacks acumulados)
>
> **Fonte da verdade única.** Se algo neste doc conflita com CLAUDE.md ou
> `docs/Backlog_Pos_MVP.md`, este doc vence. CLAUDE.md continua sendo o changelog
> vivo das sprints; este doc é o processo.

---

## 1. Modelo mental — quem faz o quê

### 1.1. Sessão paterna (esta) — QA/gestor/arquiteto
Não escreve código de app. Responsabilidades:
- Planejar sprints/débitos
- Escrever specs e docs
- Spawnar chips (via `spawn_task`) para trabalho de código
- Revisar merges, aplicar decisões finais (mergir, resolver conflitos)
- Manter `Backlog_Pos_MVP.md`, `CLAUDE.md`, `HANDOFF_Estado_Atual_*`, este doc e o
  `Roteiro_QA_Homologacao_Staging.md` alinhados
- Coordenar chips paralelos (áreas disjuntas)
- **Gate de QA antes de deploy** — pré-requisito não-negociável (§11.4)

### 1.2. Chips (subagent + skill dev)
Escrevem código. Um chip = um débito P-XX ou uma sub-tarefa de sprint.
- Cada chip abre worktree isolado (branch `claude/<nome>`)
- Cada chip termina com commit(s) na sua branch e reporta título do commit +
  arquivos tocados no chat
- Chips paralelos podem coexistir se áreas de código são disjuntas — coordenar
  via `git pull` antes de mergir

### 1.3. QA Automation (chip especializado)
Após mergir chip com código de app, spawnar chip de QA automation via skill
`anthropic-skills:qa-automation`. Roda Vitest + tsc + lint + Playwright, analisa
falhas, referencia arquivo:linha, devolve **plano de correção**. Sessão paterna
consome esse plano e decide: aplicar direto (fix trivial), spawnar chip de fix
(fix complexo), ou registrar débito P-XX (baixa prioridade).

**Regra permanente:** QA automation é DEFAULT, não opcional. Nunca deploy sem QA.
Ver §9.4 (spawn) e §11.4 (gate deploy) e §16.1 (case study 2026-07-06).

---

## 2. Fluxo canônico de uma tarefa (do débito até deploy)

```
Débito identificado
   ↓
Registrar no Backlog_Pos_MVP.md com ID P-XX único + severidade + escopo
   ↓
[opcional] Debater com PO / atualizar spec / preparar amendments
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
Validação local: npx tsc --noEmit && npm run lint && npm test
(SMOKE — não substitui QA automation)
   ↓
Spawn chip QA Automation — skill anthropic-skills:qa-automation
(OBRIGATÓRIO — não opcional. Case study §16.1 mostra o custo de pular.)
   ↓
Consumir verdict do QA:
   • VERDE → task fecha
   • AMARELO → registra débito residual + fecha
   • VERMELHO (regressão real) → rollback + spawn chip de fix + loop
   ↓
Atualizar task list (TaskUpdate) marcando como completed
   ↓
Atualizar Backlog_Pos_MVP.md marcando débito como ✅ FECHADO com commit hash
   ↓
Atualizar CLAUDE.md changelog
   ↓
Se mudança tem impacto UX/funcionalidade em staging:
atualizar docs/Roteiro_QA_Homologacao_Staging.md com cenário pass/fail
   ↓
[Se autorizado pelo Fred] Deploy prod via vercel --prod
```

**Regra de ordenamento:** DEPLOY sempre APÓS QA verde. Ver §11.4.

---

## 3. Checklist de fechamento do chip (OBRIGATÓRIO)

Todo prompt de `spawn_task` **deve** conter este checklist verbatim ou uma
versão instruída ao chip:

### 3.1. Código
- [ ] Todo `.create`/`.upsert.create` passa `tenantId` explícito no payload
- [ ] Todo `.update`/`.upsert.update` — se declarar `tenantId` no data, ele
      DEVE bater com contexto (P-42 pattern: WHERE injection protege, backstop
      só bloqueia declaração conflitante — ver §4.10)
- [ ] Toda entrada de usuário validada com **Zod no servidor**
- [ ] Zero secret hardcoded
- [ ] Zero `console.log` com PII ou tokens
- [ ] Data masking obrigatório antes de chamar IA (`masking.mask()` → provider
      → `masking.unmask()`)
- [ ] `tenantIdOverride: ctx.tenantId` em toda chamada de `audit()` dentro de
      procedures tRPC (P-04 pattern — AsyncLocalStorage escapa em callbacks
      assíncronos do fetchRequestHandler)
- [ ] RBAC — endpoints usam `withPermission('resource:action')` (Sprint 15E)
      ou justificam por que ainda usam `withRoles`/`withCapability`
- [ ] Soft delete (`deleted_at`) em vez de DELETE real
- [ ] `envBoolean(default)` para novo kill-switch em `env.ts` — NUNCA
      `z.coerce.boolean()` (P-60 case study §16.3)

### 3.2. Testes
- [ ] Vitest unit test para toda função pura nova
- [ ] Testing Library (RTL) para forms com digitação e submit
- [ ] Supertest ou tRPC caller para procedures (cross-tenant, RBAC, erros)
- [ ] Playwright para fluxo E2E (se toca UI)
- [ ] Baseline preservado: `npx tsc --noEmit && npm run lint && npm test`
      com zero regressão vs baseline pré-chip
- [ ] Se pulou testes, justificativa por escrito no commit (ex: "infra sem
      código app", "doc-only change")
- [ ] Chip NÃO pode piorar baseline. Se piorar, chip volta pra worktree com
      plano de correção do QA

### 3.3. Documentação
- [ ] `docs/Backlog_Pos_MVP.md` — débito marcado como ✅ FECHADO com commit hash
- [ ] `CLAUDE.md` — nova seção no changelog com bullets do que foi entregue,
      testes, baseline
- [ ] `docs/Roteiro_QA_Homologacao_Staging.md` — **se afeta UX/funcionalidade
      em staging ou prod, ADICIONAR cenário pass/fail com passos executáveis.
      Nunca deixar cenário só em chat** (memory `feedback_chip_qa_homologacao`)
- [ ] Se cria doc novo, entrar na tabela §7 de `HANDOFF_Estado_Atual_*.md`
- [ ] Zero placeholders `TODO` ou `FIXME` residuais em docs commitados

### 3.4. Commit
- [ ] Conventional Commits: `feat:`, `fix:`, `chore:`, `test:`, `docs:`,
      `refactor:`
- [ ] `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` no rodapé
- [ ] Nunca `--no-verify` (pre-commit hooks são obrigatórios)
- [ ] Nunca push direto pro remote — sessão paterna faz merge e decide push
- [ ] Nunca `--amend` — sempre commit novo

### 3.5. Reporte
Ao final, o chip responde no chat com:
- Título do(s) commit(s)
- Arquivos tocados + contagem de linhas
- Baseline antes/depois (números exatos)
- Débitos residuais identificados (candidatos a P-XX novos)
- Confirmação: type-check zero, lint zero, testes esperados X passing / Y skipped

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

**Bug conhecido audit-context-loss:** dentro de `fetchRequestHandler` do tRPC,
o AsyncLocalStorage escapa em callbacks assíncronos. **SEMPRE** passar
`tenantIdOverride: ctx.tenantId` em `audit()` dentro de procedures tRPC. Ver
memory `audit-trpc-context-loss.md`.

### 4.2. Data Masking obrigatório antes de IA
NUNCA passar PII (nomes, emails, CPF/CNPJ, telefones, endereços, valores) direto
pra provider de IA. Usar `DataMaskingService`:

```typescript
import { masking } from '@/lib/ai/masking';

const { masked, map } = masking.mask(userText);
// enviar `masked` pro provider
const response = await dispatchChat('feature-name', tenantId, {
  messages: [{ role: 'user', content: masked }],
});
const safe = masking.unmask(response.text, map);
```

Regressão coberta por `tests/unit/ai-masking-preserved.test.ts` (grep no source
verificando ordem `masking.mask` → `dispatchChat`).

### 4.3. Validação
- Servidor: Zod obrigatório em todo input
- Cliente: validação opcional (só UX), nunca fonte da verdade
- Erros Zod chegam ao cliente via `errorFormatter` em `trpc.ts` e são
  renderizados por `friendlyTrpcError` (helper em `src/lib/trpc/error-format.ts`)
- Erros de tenant-isolation (P-46): backstop lança `Error("[tenant-isolation]...")`
  que é traduzido em `TRPCError` estruturado e renderizado como mensagem
  sanitizada em prod

### 4.4. Audit log
Toda ação sensível (create/update/delete/config change/permission grant/impersonation)
grava em `audit_logs` via `audit()`. Sempre com `tenantIdOverride: ctx.tenantId`
em procedures tRPC. Payloads sensíveis (secrets, tokens) devem ser redactados
antes de gravar.

### 4.5. RBAC granular (Sprint 15E)
- Roles são perfis padrão (`ADMIN`, `DIRETOR_COMERCIAL`, etc — 7 roles)
- Admin pode conceder/revogar permissions individuais via `user_permission_overrides`
- Endpoints usam `withPermission('resource:action')` — 61 permissions em 17 categorias
- Cascata: override individual > default do role
- Guard anti-escalada: só quem tem a permission pode delegá-la (Platform Owner
  isento)
- Cache em `users.cached_permissions` (2 colunas: valor + timestamp; NULL vs `[]`
  são distintos — NULL sinaliza "não computado")
- Backfill obrigatório pós-migration via `npm run rbac:backfill-cache`
- Kill-switch `RBAC_GRANULAR_ENABLED` runtime real (P-62) — default `true` pra
  preservar runtime, `false` volta ao path legado

### 4.6. Feature flags
Toda mudança arquitetural com risco de rollback rápido usa feature flag em
`env.ts`. Padrões:
- `RBAC_GRANULAR_ENABLED` — Sprint 15E kill-switch (default `true` pós-P-62)
- `MULTI_AI_ENABLED` — Sprint 15F kill-switch (default `false`, gradual rollout)
- `SALES_STRUCTURE_ENABLED` — Sprint 15G kill-switch (planejado, default `false`)
- Default depende do contexto: `false` pra features novas, `true` pra kill-switches
  de features já vivas em prod

**Regra P-62:** flag precisa **consumer runtime real**. Sem consumer, flag é
teatral e não protege rollback. Toda flag adicionada em `env.ts` DEVE ter pelo
menos 1 consumer em código de app + teste que valida ambos os paths.

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

Ver §16.3 (case study P-60).

### 4.10. Backstop tenant-isolation (P-42 reformado)
Semântica correta em `src/server/db/client.ts` (após P-42, 2026-07-05):

- **`create`**: `assertTenantWritePayload` exige `tenantId` no payload OU falha.
  Sem tenantId em `data` → engine erra (defesa contra bypass explícito).
- **`update`/`upsert.update`**: NÃO exige `tenantId` no payload. WHERE injection
  já bloqueia cross-tenant (row alvo é imutável). Backstop só bloqueia se
  payload DECLARAR `tenantId` DIFERENTE do contexto (tentativa deliberada de
  "mover" row entre tenants).
- **`createMany`** (P-45): itera cada row do array. Rows sem `tenantId` → erro
  no índice. Rows com `tenantId ≠ ctx` → erro no índice. Rows `null` no array
  são ignoradas defensivamente.

`assertTenantWritePayload(model, op, ctxTenantId, payload)` é função pura
exportada de `src/server/db/client.ts` — testável isoladamente. Extension Prisma
delega pra ela.

**NÃO reintroduzir `ALLOW_MISSING_TENANT_ON_WRITE`** — o backstop reformado
elimina a necessidade dessa lista.

Ver memory `tenant-backstop-lesson.md`.

### 4.11. Approvals são snapshot vs RBAC dinâmico (P-77 aberto)
Approval engine (`approval-engine.service.ts`) persiste `approverId` fixo no
momento da criação. Nem o path legado (`approver_roles → findFirst({role})`)
nem o novo (`approver_permission → findMany({cachedPermissions has 'X'})`)
re-avalia quando:

- Role do approver muda
- Rule é editada (mesmo com audit trail)
- User é desativado ou removido
- (Pós-Sprint 15G) User é movido de unidade organizacional

**Consequência:** approvals viram "fósseis" — `/approvals` do novo approver
correto fica vazio, PENDING antigos apontam pra users que já não devem aprovar.

**Solução planejada:** P-77 (Sprint 15H ou paralelo) — worker daily reconcile
OU re-execução ativa quando rule/user muda. Ver
`docs/chip-prompts/P-77_approvals_orfas.md` pra prompt do chip.

**Ação imediata quando fósseis aparecem:** rejeitar via UI logando como user
original (mantém audit trail); nova versão de proposta re-executa engine com
config atual.

---

## 5. Padrões de teste

### 5.1. Camadas

| Camada | Ferramenta | Quando |
|---|---|---|
| Unit | Vitest | Funções puras, services, hooks, helpers |
| Component (Testing Library) | Vitest + `@testing-library/react` + `user-event` + `jest-dom` (P-53) | Forms com digitação e submit, comportamento de mutation handlers, DOM assertions ergonômicas. `tests/component/**/*.test.tsx` (jsdom). Piloto: `tests/component/pipeline-new.test.tsx` |
| Integration | Supertest OU tRPC caller (P-44) | Procedures tRPC, endpoints REST, cross-tenant, RBAC. Fixture reusável `tests/integration/fixtures/authed-caller.ts` gated por `DATABASE_URL_TEST` |
| E2E | Playwright | Fluxos críticos de usuário (onboarding, pipeline, IA) |
| Visual | Playwright + screenshots | Baseline de 25 rotas × 3 viewports (P-03) |
| Accessibility | axe-core smoke | 5 rotas públicas + 4 autenticadas (Sprint 14) |

### 5.2. Baseline atual (2026-07-06, pós P-65 + P-66)

Vitest carrega `.env` automaticamente (P-47 fix). Precedence
`.env.test → .env.local → .env` via `tests/env-setup.ts`. Zero dependência de
`source .env.local` manual antes de `npm test`.

Baseline canônico após bloco H+I + P-65 + P-66 merged (main @ `b8be0de`):

| Cenário | Passing / Failing / Skipped | Total |
|---------|------------------------------|-------|
| Env file presente (`.env.local` OU `.env`, schema Zod válido) | **944 / 0 / 174** | 1118 |
| Env file com todas chaves (Anthropic, encryption, Stripe, etc) | **944 / 0 / 174** | 1118 |
| Sem env file (CI sem `env:` no workflow) | ~910 / 8 / 174 | ~1092 |

- Os failings do cenário CI vêm de test files falhando no import por Zod
  ausência (`DATABASE_URL`, `TENANT_FIELD_ENCRYPTION_KEY`). Comportamento
  correto do fix — carrega só se .env existe.
- 174 skipped inclui ~172 estáticos + 2 conditional (RBAC + tenant-isolation
  guardados por `DATABASE_URL_TEST`).
- Type-check: zero
- Lint: zero (paterna e worktrees)

**Histórico de baseline por milestone:**

| Milestone | Passing | Data |
|-----------|---------|------|
| Sprint 15E completo | ~615 | 2026-07-02 |
| Bloco A+B+C fechado | 764 | 2026-07-05 |
| Bloco G fechado | 816 | 2026-07-05 |
| Bloco H+I fechado | 927 | 2026-07-05 (fim dia) |
| P-65 + P-66 merged | **944** | 2026-07-06 |

**Novo chip não pode piorar baseline.** Se piorar, chip volta pra worktree
com plano de correção do QA automation. Se falhas são pré-existentes por
env vars, chip documenta explicitamente ("6 falhas de field-encryption
confirmadas idênticas no HEAD antes do fix via `git stash`").

### 5.3. Cobertura mínima de novo procedure tRPC
Todo procedure novo deve ter:
1. Teste unit da função pura (se houver)
2. Teste do procedure com contexto autenticado + payload válido → success
3. Teste cross-tenant: user do Tenant A não vê/modifica dado do Tenant B → 404
4. Teste RBAC: user sem permission → 403
5. Teste audit: mutation deixa entrada em `audit_logs` com override correto
6. Se envolve IA: teste que masking preserva ordem (grep no source)
7. Se envolve $transaction: teste ordem de writes (P-65 pattern —
   `expect(prismaCallsInOrder).toEqual([...]))`

### 5.4. Cobertura de UI (Testing Library — P-53)
Para forms com digitação:
1. Render inicial mostra elementos esperados (labels, buttons)
2. Digitação em campo controlado atualiza state
3. Máscara BRL/CNPJ/CEP funciona incremental
4. Submit dispara mutation com payload esperado
5. `onSuccess` → toast + navigation
6. `onError` → toast error via `friendlyTrpcError`

Padrão: mock `@/lib/trpc/client` capturando `onSuccess`/`onError`;
`ToastProvider` real; dispara handlers manualmente.

Débitos residuais (P-73, P-74, P-75, P-76): expandir RTL pra
`/companies`, `/contacts`, `/admin/users`, `/pipeline/[id]`.

---

## 6. Padrões de migration Postgres

Ver memory `migration-pitfalls.md`. 5 padrões recorrentes:

1. **Cast `enum_old[]→text[]→enum_new[]`** — recriar enum via RENAME_old + cast
   coluna por coluna. Nunca DROP + CREATE de enum enquanto colunas o usam.
2. **Sanitizar valores antes de DROP enum** — evita CHECK constraint failure.
3. **Partial UNIQUE para coluna nullable** — `WHERE col IS NOT NULL` em vez de
   `NULLS NOT DISTINCT` (compat Postgres 14+).
4. **CHECK XOR + UNIQUE global = bloqueio dual identity** — usar partial
   UNIQUE + `@@unique([col, tenantId])` com nota SQL como fonte da verdade
   (P-11 caso Platform Owner).
5. **RLS default policy** para toda tabela nova com `tenant_id`.

Testes obrigatórios em migrations:
- `tests/unit/rbac-migration-XXXX.test.ts` — fs scan do SQL confirmando shape
- Aplicação em Neon dev via `npx prisma migrate deploy` sem drift
- Rollback plan documentado no PR (ou migration reversa em `prisma/migrations/XXXX_revert/`)
- Backfill idempotente — roda 2× sem erro

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
- Commit direto no main em worktree — SEMPRE em branch `claude/<nome>`

### 7.4. Sempre
- Um commit por unidade lógica
- Mensagem 1-2 sentenças focando no "porquê"
- HEREDOC para mensagens multi-linha
- Referenciar débito P-XX quando aplicável
- Baseline antes/depois no corpo do commit (padrão canônico Venzo)

---

## 8. Padrões de merge

### 8.1. Merge de chip → main
Sempre `--no-ff` para preservar histórico:
```bash
git merge claude/<worktree-name> --no-ff -m "Merge P-XX: descrição curta"
```

### 8.2. Conflitos esperados
Docs (Backlog, CLAUDE.md, HANDOFF) — padrão de resolver: **concatenar ambos**.

### 8.3. Colisão de IDs P-XX
Descoberta 2026-07-06: quando múltiplos chips criam débitos residuais em
paralelo, IDs podem colidir. Ex: bloco P-53 residual usou P-65/66/67/68 pra
Testing Library ao mesmo tempo que chip descobria P-65/66/67 pra bugs de prod.

**Solução:**
1. Renumerar bloco antigo pros próximos slots livres (regra: novos bugs
   preservam ID mais baixo; débitos "residuais" migram)
2. Adicionar bloco "Renumeração YYYY-MM-DD" documentando a mudança
3. Grep pra referências cruzadas nos outros docs (HANDOFF, CLAUDE.md) — atualizar

### 8.4. Ordem de merges paralelos
Do menor pro maior. Chips com áreas disjuntas: qualquer ordem.

### 8.5. Post-merge validation (SMOKE — não QA)
```bash
npx tsc --noEmit && npm run lint && npm test
```
Isto é **smoke test da main session** — confirma que não quebrou nada óbvio.
**NÃO substitui QA automation.**

Após smoke verde → SEMPRE spawnar chip QA (§9.4).

---

## 9. Padrões de spawn de chip

### 9.1. Anatomia do prompt

```
## Missão
[1 parágrafo: o que + por que]

## Contexto obrigatório de leitura
1. CLAUDE.md
2. docs/Backlog_Pos_MVP.md (débito P-XX de referência)
3. docs/Metodologia_Desenvolvimento_Venzo.md §3 checklist
4. [specs específicas]
5. [arquivos-chave]

## Escopo
Faça:
- [item 1]
- [item 2]

NÃO faça:
- [não escopo 1]
- [não escopo 2]

## Regras arquiteturais aplicáveis
[Chamar §4 do Metodologia — data masking, tenant isolation, audit, RBAC —
que se aplicam ao escopo]

## Checklist de fechamento (obrigatório)
[Copiar §3 verbatim ou linkar]

## Entrega
Commit único (ou N) na branch claude/<worktree>. NÃO PUSHE. NÃO ABRA PR.
Ao fim responda no chat com: título commit(s), arquivos, linhas, débitos
residuais.
```

Prompts pré-escritos para sprints/débitos maiores ficam em `docs/chip-prompts/`
prontos pra copy-paste no `spawn_task` quando chegar prioridade.

### 9.2. Escopo cirúrgico
Cada chip resolve **1 débito ou 1 sub-tarefa de sprint**. Nunca 2 débitos no
mesmo chip — vira PR bagunçado, conflito de merge complicado, rollback difícil.

Exceção: "housekeeping" batch que junta 2-3 fixes triviais (docs typo, dead
config, comentário obsoleto) — mas então cada fix ainda é um commit separado
dentro do mesmo chip.

### 9.3. Chips paralelos ok se áreas disjuntas
Até 5-6 chips simultâneos toleráveis. Coordenar via git pull antes de mergir.

Áreas típicas disjuntas:
- Chip A: `src/server/services/x.service.ts`
- Chip B: `src/app/admin/y/page.tsx`
- Chip C: `docs/*.md`

Áreas que colidem (não paralelizar):
- 2 chips em `src/server/trpc/routers/opportunities.ts`
- 2 chips em `prisma/schema.prisma`
- 2 chips em `CLAUDE.md`

### 9.4. Após merge → QA automation (OBRIGATÓRIO)

Regra permanente desde 2026-07-04, reforçada em 2026-07-06 (case study §16.1):

**SEMPRE spawnar chip QA automation após mergir chip com código de app.** É
comportamento default da sessão paterna, **não opcional** — não requer
confirmação do Fred, é parte do fluxo canônico §2.

**Ordem correta:**
```
Chip finaliza → sessão paterna merge → sessão paterna SMOKE (tsc/lint/test)
    → spawn chip QA → QA verdict → [se verde] deploy prod → [se vermelho] rollback
```

**Ordem ERRADA (o que aconteceu em §16.1):**
```
Chip finaliza → merge → smoke → DEPLOY PROD (sem QA)
```

Smoke test é **da própria main session**, olhando o próprio código. QA
automation é chip independente com olhar externo — mesma medida de segurança
que fez o bloco H+I ser deployado com confiança.

**Exceções raras (justificar por escrito):**
- Docs-only: sem código app, nada a testar
- Tooling/infra sem impacto runtime: `.gitignore`, `Dockerfile.worker`, etc
- Config puramente declarativa: `env.example` update sem mudança de código

**Regra prática:** se ficar em dúvida se pula ou não → **NÃO pula, spawn o QA**.
Custo do chip QA (~20-40min local) << custo de regressão em prod.

### 9.5. Prompt canônico do chip QA (template)

Personalize apenas os 3 blocos marcados `<...>`; o resto fica fixo:

```
Execute a skill anthropic-skills:qa-automation contra o estado atual do main (@<commit>).

Contexto — últimos merges relevantes:
<listar 3-5 commits recentes com descrição curta>

Foco crítico: <arquivo(s) tocados pelo chip que acabou de mergir>

Fases obrigatórias:
1. Baseline pré (checkout do commit ANTES do último merge de código)
   — capturar counts npm test / tsc / lint
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
## 8. Verdict final (VERDE / AMARELO / VERMELHO)

Verdict:
- VERDE: zero regressão, baseline preservado ou melhorado. Recomenda seguir.
- AMARELO: débito residual identificado mas não bloqueia. Recomenda seguir
  com débito P-XX registrado.
- VERMELHO: regressão real. Recomenda ROLLBACK + spawn chip de fix.

Regras:
- Reporte é o único artefato — nenhum commit em src/
- git só read-only (checkout/log/diff/status)
- Números exatos, sem arredondar
- Se algo travar (env var, porta, cred), documenta como P-XX candidato
- NÃO corrigir bugs — fixes vêm em chip separado
- Persistir reporte em docs/qa-sessions/auto-report-<YYYY-MM-DD>-<escopo>.md
```

Task list mantém 1 task ativa por QA: "Aguardar QA automation pós-<X>".

---

## 10. Segurança operacional

### 10.1. Secrets
- Zero hardcode
- `.env*` NUNCA commitado (pattern amplo em `.gitignore`)
- Chaves IA criptografadas antes de `prisma.update` (`encryptField` /
  `decryptField` em `src/lib/crypto/field-encryption.ts`)
- Chave IA nunca em log, response tRPC ou audit payload
- `.env.example` NUNCA contém valor real — só dummy legível
- Rotação de secret compartilhado por engano no chat = task 🔴 imediata
  (padrão P-32)

### 10.2. Rate limiting
Endpoints públicos (`/api/v1/inbound/*`, `/api/v1/consent`,
`/api/v1/privacy-request`) usam sliding window Redis via
`src/lib/security/rate-limiter.service.ts`. Após P-29:
- IP-based (padrão Sprint 11)
- Sender email-based pra inbound (P-29, `SENDER_INBOUND_LIMIT`)

### 10.3. Security headers
Middleware Next.js aplica CSP + HSTS + X-Frame-Options DENY + Permissions-Policy
via `src/lib/security/headers.ts`.

### 10.4. Guards
- `assertCanAssignSuperAdmin` — só SUPER_ADMIN atribui SUPER_ADMIN
- Guard anti-escalada RBAC — só quem tem permission pode delegá-la
- Cross-tenant returns 404 (não 403) para evitar enumeration
- Backstop tenant-isolation P-42 — WHERE injection + backstop reformado (§4.10)

### 10.5. Auditoria contínua
- Dependabot: npm semanal, GH Actions semanal, Docker mensal
- Semgrep + npm audit em CI
- OWASP ZAP baseline scan semanal
- Data subject requests com SLA 15d ANPD

### 10.6. Never parse secrets (memory `feedback_never_parse_secrets`)

**Nunca** rodar `awk`/`sed`/`grep` com regex complexo em strings que contêm
secret embutido. Incidente 2026-07-04: senha do Neon vazou no output durante
troubleshooting de env vars.

**Padrão seguro:**
- `grep -q "PATTERN" file && echo "OK" || echo "MISSING"` (só exit code)
- `test -n "$VAR"` sem eco
- Redirect pra `/dev/null` quando só quer confirmar presença

**Padrão INSEGURO:**
- `grep "DATABASE_URL" .env` — imprime linha com senha
- `awk -F= '/PWD/{print $2}'` — imprime valor
- `echo "URL=$DATABASE_URL"` — vaza no log

Ver memory `feedback_never_parse_secrets.md`.

---

## 11. Rollout e rollback

### 11.1. Rollout ordenado (padrão Sprint 15E)
1. Deploy código com feature flag = `false`
2. `npx prisma migrate deploy`
3. Backfill script obrigatório (se houver)
4. Ativar feature flag = `true` primeiro em staging
5. Monitorar `audit_logs` 24-72h
6. Ativar em prod
7. Monitorar 3-7 dias
8. Expandir para 100%

### 11.2. Rollback rápido
Toda mudança arquitetural com risco deve ter kill-switch runtime (feature flag).
Rollback = setar flag `false` no Vercel — sem redeploy.

Regra P-62: flag precisa consumer runtime real, senão rollback é teatral.

### 11.3. Rollback pesado
Se schema breaking, migration reversa em `prisma/migrations/XXXX_revert/`.
Sempre testar em Neon dev antes.

### 11.4. Gate de QA antes de deploy prod (OBRIGATÓRIO)

**Deploy prod só depois de:**
1. Merge em main verde
2. Smoke test da paterna verde (tsc + lint + test)
3. **QA automation com verdict VERDE ou AMARELO**
4. Autorização humana (Fred)

**Nunca pular passo 3.** Case study §16.1 documenta o que acontece quando pula.

Se verdict AMARELO: registrar débito residual + seguir com deploy.
Se verdict VERMELHO: rollback via `vercel promote <deployment_anterior>` +
spawn chip de fix + repetir ciclo.

**Rollback prod pós-deploy:**
```bash
vercel promote <deployment_id_anterior>  # aliasing pro deployment anterior
# ou
vercel rollback  # se o CLI suportar rollback simples
```

Deploy IDs preservados no `docs/HANDOFF_Estado_Atual_*.md` pra rollback rápido.

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
- `docs/Sprint_XX_amendments.md` — emendas críticas pré-implementação (padrão
  15G/2026-07-06)
- Aceite quando PO valida spec por escrito (comentário no doc ou aprovação em
  chat)

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

Toda nova regra deste doc DEVE ter memory correspondente linkada com `[[nome]]`.

### 12.5. Chip prompts prontos
`docs/chip-prompts/*.md` — prompts self-contained pra spawnar via `spawn_task`
quando prioridade chegar. Padrão adotado 2026-07-06.

Cada prompt contém:
- Contexto obrigatório de leitura
- Escopo cirúrgico
- Regras arquiteturais aplicáveis (§4)
- Checklist de fechamento (link pra §3)
- Entrega + não-escopo

Atuais:
- `docs/chip-prompts/Sprint_15G_estrutura_comercial.md`
- `docs/chip-prompts/P-77_approvals_orfas.md`

### 12.6. Docs de review pré-implementação
Padrão descoberto 2026-07-06 (durante revisão da spec Sprint 15G do PO):
- `docs/<tema>_Mapa_YYYY-MM-DD.md` — 1 pager mapeando estado atual antes de
  discutir com PO
- `docs/Sprint_XX_amendments.md` — emendas identificadas pela paterna antes de
  autorizar chip

Exemplo:
- `docs/RBAC_OrgVisibility_Mapa_2026-07-06.md` (mapa)
- `docs/Sprint_15G_amendments.md` (emendas)

---

## 13. Antipatterns (não fazer)

### 13.1. Código
- ❌ `findUnique` por `clerkId` — usar `findFirst` com `(clerkId, tenantId)` filter
- ❌ `audit()` sem `tenantIdOverride` em procedures tRPC (P-04)
- ❌ Chamar `dispatchChat` sem masking antes
- ❌ `withRoles(...)` para novo endpoint — usar `withPermission('resource:action')`
- ❌ `console.log(user)` — PII leak
- ❌ Hardcode de tenant IDs em teste — usar fixtures
- ❌ DELETE real — usar soft delete
- ❌ `z.coerce.boolean()` em env var — usar `envBoolean(default)` (§4.9)
- ❌ Reintroduzir `ALLOW_MISSING_TENANT_ON_WRITE` (§4.10)
- ❌ `prisma.approval.create()` fora do engine — só engine cria approvals
- ❌ Editar rules assumindo que approvals antigas re-adjustam (§4.11)

### 13.2. Processo
- ❌ Chip que resolve 2 débitos ao mesmo tempo
- ❌ Push direto pro main sem merge
- ❌ `--no-verify` pra pular hooks
- ❌ Mergir sem rodar `npx tsc && npm run lint && npm test`
- ❌ Fechar débito sem atualizar `Backlog_Pos_MVP.md`
- ❌ Nova feature UX sem cenário no `Roteiro_QA_Homologacao_Staging.md`
- ❌ Spawn chip sem checklist de fechamento no prompt
- ❌ **Merge de chip com código de app sem QA automation depois (§9.4)**
- ❌ **Deploy prod sem QA automation prévio (§11.4)**
- ❌ Confiar no commit message do próprio chip como QA — chip é juiz suspeito
  da própria obra
- ❌ Colisão de IDs P-XX no backlog sem renumerar (§8.3)

### 13.3. Comunicação
- ❌ Assumir que PO revisa spec sem pedir explicitamente
- ❌ Deploy prod sem flag `false` primeiro em features novas
- ❌ Compartilhar credencial (Neon, Clerk, Anthropic) em chat sem rotação
  planejada (P-32)
- ❌ Prometer feature no changelog antes do chip fechar
- ❌ Parsear/logar strings com secret embutido (§10.6)

### 13.4. Documentação
- ❌ Placeholders `TODO`/`FIXME` residuais em docs commitados
- ❌ Baseline stale em §5.2 (P-71 pattern — atualizar sempre)
- ❌ Docs órfãos sem entry em `HANDOFF_Estado_Atual_*.md` §7 referências
- ❌ Sem link cruzado entre memory e regra da metodologia

---

## 14. Referências rápidas

- **CLAUDE.md** (raiz) — instruções permanentes + changelog
- **docs/Backlog_Pos_MVP.md** — P-01 a P-77 com status
- **docs/HANDOFF_Estado_Atual_2026-07-05.md** — snapshot mais recente
- **docs/RBAC_OrgVisibility_Mapa_2026-07-06.md** — mapa dos 3 eixos RBAC
- **docs/Sprint_15G_amendments.md** — emendas A1-A7 à spec do PO
- **docs/chip-prompts/** — prompts prontos pra spawn_task
- **docs/Roteiro_QA_Homologacao_Staging.md** — cenários pass/fail
- **docs/QA_Automation_Report_Sprint_15E.md** — 17 arquivos testes cobrindo 26 ACs
- **docs/qa-sessions/** — QA automation reports arquivados
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

**Última reconstrução:** 2026-07-06 (incorporou P-42 backstop, P-60 envBoolean,
P-62 kill-switch, P-77 approvals snapshot, case study QA pulado, chip-prompts,
docs de review pré-implementação).

---

## 16. Case studies (aprendizados)

### 16.1. Sessão 2026-07-06 pulou QA antes de deploy

**O que aconteceu:** paterna mergeou 2 chips (P-65 estimatedValue sync + P-66
gate PROPOSTA→NEGOCIACAO), rodou smoke (`tsc + lint + npm test`), viu baseline
verde 944/0/174 e deployou prod direto. **Pulou o passo de QA automation.**

**Como Fred detectou:** "Está no seu modus operandi disparar QA automation
para garantir a homologação dos desenvolvimentos? antes de seguir para deploy?"

**Diagnóstico:** paterna se apressou ao ver commit messages bem-formados dos
chips. Chip é juiz suspeito da própria obra — QA independente é a medida
de segurança.

**Ação de mitigação (2026-07-06):** QA automation retroativo spawnado pós-deploy.
Verdict serviu de validação retroativa; em caso VERMELHO, rollback via
`vercel promote <deployment_anterior>`.

**Regra derivada:**
- §11.4 gate QA antes de deploy explicitado como não-negociável
- §9.4 reforçado com este caso
- §13.2 antipattern novo: "Confiar no commit message do próprio chip como QA"
- Este case study §16.1

### 16.2. P-42 backstop reformado

**O que aconteceu:** backstop em `src/server/db/client.ts` lançava `Error("[tenant-isolation]
<Model>.<op> sem tenantId no payload")` pra qualquer `.update`/`.upsert` que não
passasse tenantId no data. Isso quebrou `/pipeline/<id>` em prod quando Fred
salvava campos por estágio.

**Diagnóstico:** WHERE injection do `runWithTenant` já bloqueia cross-tenant
em UPDATE (row alvo é imutável). Backstop original era paranoico demais.

**Solução:** função pura `assertTenantWritePayload(model, op, ctxTenantId, payload)`
com semântica refinada — create exige tenantId, update/upsert.update NÃO exigem,
só bloqueiam se declararem tenantId ≠ ctx.

**Regra derivada:** §4.10 backstop reformado; antipattern "Reintroduzir
`ALLOW_MISSING_TENANT_ON_WRITE`" em §13.1.

### 16.3. P-60 `z.coerce.boolean("false") === true`

**O que aconteceu:** todas as flags kill-switch (`RBAC_GRANULAR_ENABLED`,
`MULTI_AI_ENABLED`, `AXIOM_LOG_QUERIES`) usavam `z.coerce.boolean()` que
converte qualquer string não-vazia em `true`. Escrever `MULTI_AI_ENABLED=false`
no `.env` era interpretado como `true` sem alerta.

**Diagnóstico:** `z.coerce.boolean(v) === Boolean(v)`. Em JS, `Boolean("false") === true`.

**Solução:** helper `envBoolean(default)` interpreta strings literalmente.

**Regra derivada:** §4.9 envBoolean obrigatório; antipattern §13.1 `z.coerce.boolean()`
proibido; teste regressão `env-schema-regression.test.ts` bloqueia reintrodução.

### 16.4. P-62 kill-switch sem consumer runtime

**O que aconteceu:** `RBAC_GRANULAR_ENABLED` existia em `env.ts` desde Sprint
15E mas nenhum consumer runtime a lia. Comportamento era sempre granular,
invalidando promessa de rollback rápido do spec §5.4.

**Diagnóstico:** flag teatral. `hasPermission()` em `permissions.service.ts`
não tinha branch pra flag=false.

**Solução:** default flipado pra `true` (preservar runtime); branch pra
flag=false que usa `ROLE_DEFAULT_PERMISSIONS` (catálogo Sprint 15E) — NÃO
`ROLE_CAPABILITIES` legado (esse não tem os semantic splits do 15E).

**Regra derivada:** §4.6 "flag precisa consumer runtime real"; toda flag adicionada
em `env.ts` deve ter consumer + teste que valida ambos os paths.

### 16.5. P-67 approvals fósseis em acme-tech

**O que aconteceu:** Fred (DIRETOR_COMERCIAL em `acme-tech`) reportou que
`/approvals` mostrava vazio. Diagnóstico revelou 4 approvals PENDING apontando
pra ANALISTA e GESTOR, enquanto rules ativas apontavam pra DIRETOR_*.

**Diagnóstico:** approvals persistem `approver_id` fixo no momento da criação.
Nem role change, nem rule edit, nem soft delete de user re-avalia.

**Solução planejada:** P-77 (worker daily reconcile OU re-execução ativa).

**Regra derivada:** §4.11 "Approvals são snapshot vs RBAC dinâmico";
antipattern §13.1 "Editar rules assumindo que approvals antigas re-adjustam".

---

**Fim do documento.** Fluxo canônico: §2. Case studies: §16.
