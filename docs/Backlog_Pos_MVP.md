# Backlog Pós-MVP — CRM B2B Venzo

Estado: MVP completo (Sprints 0–14.5), 262 testes passando, 0 débitos
abertos formalmente no CLAUDE.md. **Mas há débitos identificados em
uso real** e roadmap estratégico que não cabe num único sprint.

Esse doc consolida tudo o que ficou na bagagem após os 15 sprints e
serve de fonte da verdade pra próximos planejamentos.

Mantido em sincronia com `CLAUDE.md` e memory `MEMORY.md`.

---

## 🔥 Pendências de curto prazo (próximas 2 semanas)

### ~~P-01. Fix `/companies` + `/contacts` CRUD 404~~ ✅ FECHADO
**Resolvido em 2026-06-30 pelo commit `54dab90`.** Modal inline
para criar/editar empresa e contato; DetailSheet via intercepting
routes pro detalhe. CompanyForm também ganhou auto-fill via
CNPJ no chip `ff8cf85`. Sprint 15C reforçou com máscara visual
+ CEP auto-fill (commit `fa84be6`).

### P-02. PageHeader em 13 rotas /admin restantes
**Severidade:** Média. Cosmético — 🟡 do Sprint 14.5 item 4.
Refactor mecânico aplicando padrão consistente:

```tsx
<PageHeader title="X" description="Y" primaryAction={<Button>+ Novo</Button>} />
```

Rotas: `/admin/ai`, `/admin/alerts`, `/admin/approval-rules`,
`/admin/contracts`, `/admin/conversion-rates`, `/admin/email-inbound`,
`/admin/partners`, `/admin/privacy`, `/admin/products`,
`/admin/templates`, `/admin/users`, `/admin/branding` (verificação
leve), `/admin/billing` (verificação leve).

**Esforço:** ~3h. **Status:** spec em
`Sprint_14_5_Polish.md` item 4. Não verificado se Sprint 15C
fechou parcialmente — auditoria recomendada.

### P-03. Visual baseline capturado
**Severidade:** Baixa. 🟡 do Sprint 14.5 item 9. Script
`scripts/visual-baseline.ts` existe. Procedimento em
`tests/visual/README.md`.

**Esforço:** ~1.5h. **Bloqueador:** depende app rodando local +
seed E2E.

### ~~P-04. Bug do audit log em outros sprints (não só theme.update)~~ ✅ FECHADO
**Resolvido em 2026-06-30.** Refactor mecânico em 19 routers tRPC:
todas as 54 chamadas `audit({...})` sem `tenantIdOverride` receberam
`tenantIdOverride: ctx.tenantId,` como último campo. Arquivos tocados:
`activities`, `ai-config`, `alerts`, `approval-rules`, `companies`,
`contacts`, `contracts`, `documents`, `imports`, `inbox`,
`opportunities`, `partner-engagements`, `partners`, `privacy`,
`products`, `proposals`, `reports`, `users`. `search.ts` só tinha
comentário (`* Read-only, alto volume — NÃO chama audit()`),
skipado.

**Regressão:** `tests/unit/audit-context-loss.test.ts` novo com
4 cenários: (1) audit dentro de `runWithTenant` sem override usa
ALS, (2) contexto perdido + override grava com override — o fix,
(3) sem contexto e sem override descarta com warn (documenta o
bug histórico como assert), (4) override tem precedência sobre
contexto. Total 437 passing (baseline 433 + 4 novos), 2 skipped,
4 pré-existentes.

**Débito adjacente identificado:** services em `src/server/services/*`
que chamam `audit()` também podem estar afetados. Escopo desse
fix foi rigidamente `src/server/trpc/routers/*.ts` conforme spec.
Ver P-20 se levantamento aplicável for feito.

### P-05. Lighthouse audit em CI
**Severidade:** Média. 🟡 do Sprint 14.5 item 8. Script + workflow
prontos. Bloqueador: `vars.STAGING_URL` no GitHub Secrets.

**Esforço:** ~3h (quando staging existir).

### P-06. Drilldowns AI por tenant (Sprint 15B residual)
**Severidade:** Baixa. Routers tRPC `platform.aiOps.byTenant` e
`platform.aiMarketplace.tenantAccess.*` estão prontos do Sprint 15B
mas as 2 telas drilldown faltam:
- `/platform/tenants/[id]/ai` — form pra editar `tenant_ai_limits`,
  uso vs limite, provider breakdown, histórico, modelos pinados,
  anomalies do tenant
- `/platform/tenants/[id]/ai/features` — gerenciamento dos 3
  estados (DISABLED/INCLUDED/ADDON_ACTIVE) por tenant

### ~~Platform Owner setup~~ ✅ FECHADO
**Resolvido em 2026-06-30** após migration `0026_clerk_id_per_scope`:
- JWT Template Clerk inclui `platformRole`
- Public metadata do user Fred tem `platformRole: PLATFORM_OWNER`
- Seed `prisma/seed-platform.ts` rodado; criou 2ª row do mesmo
  Clerk ID com `tenantId=NULL, platformRole=PLATFORM_OWNER`
- Dual identity validada (1 row tenant marquezini + 1 row Platform)

### ~~P-11. Middleware não injetava headers Platform em dual identity~~ ✅ FECHADO
**Resolvido em 2026-06-30 pelo commit `7d60192`.** Sintoma: usuário Fred com dual identity
(admin tenant marquezini + Platform Owner, mesmo `clerk_id`) abria
`/platform/dashboard` e via mensagem vermelha "Acesso restrito a
Platform Owners." Causa: `src/middleware.ts` no branch final (com
tenantId) injetava só `x-tenant-id`/`x-user-clerk-id`/`x-user-role`,
omitindo `x-platform-user-clerk-id`/`x-platform-role` mesmo quando
`platformRole=PLATFORM_OWNER` estava no JWT. `platformProcedure`
no tRPC enxergava `ctx.platformUser=null` → FORBIDDEN.

**Fix:** helper local `injectPlatformHeadersIfOwner(headers,
userId, platformRole)` chamado em paralelo aos headers tenant nos
2 branches relevantes (API sem tenant + branch final com tenant).
Idempotente, no-op quando `platformRole` é null. Tenant pure
(seeds acme/beta/gamma) não recebe headers Platform.

4 testes unitários novos em `tests/unit/middleware-auth.test.ts`
cobrindo: inject quando PLATFORM_OWNER, no-op quando null, no-op
em string inválida (ex: futuro `PLATFORM_SUPPORT`), e coexistência
com headers tenant existentes. Total 372 passing (368 baseline +
4 novos), zero regressão.

### P-07. Migration pitfalls — lições aprendidas
**Severidade:** Documental. Bug do `UNIQUE(clerk_id)` na migration
0016 (Sprint 15A) e bug do cast `_UserRole_old → _UserRole` direto
sem rota via `text[]` (descoberto durante deploy do 0016 também)
mostraram 2 padrões recorrentes em migrações de enum + arrays no
Postgres. Salvar memory `migration-pitfalls.md` com:

- Sempre fazer cast `enum_old[] → text[] → enum_new[]` (rota
  intermediária)
- Sanitizar VALORES inválidos no array ANTES do cast
- `NULLS NOT DISTINCT` em UNIQUE index falha se seed populou NULLs
  duplicados; preferir partial `WHERE col IS NOT NULL` pra colunas
  opcionais
- CHECK constraints em users do tipo XOR (tenant_id IS NOT NULL XOR
  platform_role IS NOT NULL) precisam de UNIQUE composta, não
  global

**Esforço:** ~30min (escrever memory). Recomendado pra evitar 4ª
ocorrência do mesmo padrão.

### P-06. Drilldowns AI por tenant (Sprint 15B residual)
**Severidade:** Baixa. Routers tRPC `platform.aiOps.byTenant` e
`platform.aiMarketplace.tenantAccess.*` estão prontos do Sprint 15B
mas as 2 telas drilldown faltam:
- `/platform/tenants/[id]/ai` — form pra editar `tenant_ai_limits`,
  uso vs limite, provider breakdown, histórico, modelos pinados,
  anomalies do tenant
- `/platform/tenants/[id]/ai/features` — gerenciamento dos 3
  estados (DISABLED/INCLUDED/ADDON_ACTIVE) por tenant

Sem essas telas o Platform Owner só vê agregação cross-tenant em
`/platform/ai-ops` — pra ajustar tenant específico precisa fazer
via Prisma Studio.

**Esforço:** ~2h. **Status:** mecânico, chip de sustentação resolve.

### ~~P-08. Logout missing no AppShell~~ ✅ FECHADO
**Resolvido em 2026-06-30** — `<UserButton afterSignOutUrl="/sign-in"/>`
do Clerk inserido no `Topbar` à direita do `ThemeToggle`. Dropdown
nativo do Clerk cobre Manage account + Sign out em todas as rotas
autenticadas.

### ~~P-09. Mensagem "IA indisponível" enganosa~~ ✅ FECHADO
**Resolvido em 2026-06-30.** Backend separa erros reais por código
tRPC: `summarize` carrega a oportunidade primeiro e lança
`NOT_FOUND`/`PRECONDITION_FAILED`; `summarizeCommunication`
re-lança `FeatureNotAvailableError`/`AiLimitExceededError` (em vez
de engolir) e a procedure traduz pra `PRECONDITION_FAILED`/
`TOO_MANY_REQUESTS`. Falhas reais de provider (Anthropic 5xx/
timeout/circuit aberto) continuam caindo no payload com
`aiGenerated: false` — UI cai no modo manual. Frontend ganhou
prop `stageHasDirtyChanges`: bloqueia o botão antes da chamada
tRPC com mensagem "Salve a reunião antes de resumir com IA."
3 testes novos cobrindo provider 5xx vs feature gate vs limit.

### ~~P-10. Rename "CAMPOS DO ESTÁGIO ATUAL (LEAD)"~~ ✅ FECHADO
**Resolvido em 2026-06-30.** Novo `src/lib/constants/pipeline-stages.ts`
com `STAGE_INTENT_LABEL` para os 7 valores do enum
`OpportunityStage`. Título do card no `/pipeline/[id]` mudou de
"CAMPOS DO ESTÁGIO ATUAL (X)" pra rótulo semântico
("Agendamento de reunião" em LEAD, "Briefing e qualificação" em
OPORTUNIDADE etc.) com sub-rótulo discreto "Estágio: X". Outras
telas (kanban column, breadcrumb, conversion-rates) seguem usando
`STAGE_LABELS` curto; os dois mapas são intencionalmente
separados. 3 testes novos validando cobertura completa do enum.

### ~~P-12. Modal rouba foco a cada keystroke~~ ✅ FECHADO
**Resolvido em 2026-06-30.** Sintoma: em qualquer modal de criação/
edição (12 callers no app — `/platform/tenants`, `/companies`,
`/admin/users`, etc.), a cada tecla digitada o cursor pulava pro
primeiro input. Forms intestáveis.

**Causa raiz:** `src/components/ui/modal.tsx` linhas 34-63 tinha
`onClose` nas deps do `useEffect` que faz focus inicial + listener
de Tab trap/ESC. Callers passam `onClose={() => setOpen(false)}`
inline — cada render do parent (disparado por `setForm` a cada
keystroke) criava nova closure, mudando a identidade de `onClose`,
disparando o cleanup+setup do effect por completo, com
`focusables[0].focus()` roubando o foco.

**Fix:** capturar `onClose` em `onCloseRef` e remover das deps do
effect principal. Effect agora depende só de `[open]`, roda uma
única vez ao abrir e desmonta ao fechar. ESC continua funcionando
via `onCloseRef.current()`. Tab trap intacto.

**Escopo:** único arquivo modificado. Fix no `Modal` propaga
automaticamente pros 12 callers sem tocar em nenhum deles.

**Testes:** `tests/unit/modal.test.tsx` novo com 3 casos:
(1) re-render do parent com `onClose` inline não rouba foco do
input ativo — reproduz o bug via 5 re-renders forçados;
(2) ESC continua fechando o modal;
(3) Tab trap continua ciclando (Shift+Tab do primeiro → último,
Tab do último → primeiro). Baseline 378 → 381 passing.
Verificação cruzada: reverter só o modal.tsx faz o teste (1)
falhar, confirmando que ele captura o bug real.

### ~~P-14. IA usa env global em vez de key por tenant~~ ✅ FECHADO
**Resolvido em 2026-06-30 pelo commit `a80564f`.** Sintoma: Fred
cadastrou chave Anthropic em `/admin/ai` (salva encriptada em
`tenants.ai_api_key_encrypted`), mas todo consumo de IA (resumo de
comunicação, comparação de docs, sugestão de conversão, etc.) saía
da conta da Plataforma via `env.ANTHROPIC_API_KEY`. Custo e rate
limit misturados entre tenants.

**Causa raiz:** `src/lib/ai/claude.ts` expunha só `getAnthropic()`
— singleton global sem contexto de tenant.

**Fix:** novo `getAnthropicForTenant(tenantId)` decripta
`aiApiKeyEncrypted` via `decryptField` e retorna client dedicado.
Cache Map com TTL 10min por tenant (evita re-decrypt em rajada, com
risco cross-tenant nulo). Fallback pra `env.ANTHROPIC_API_KEY` com
warn quando tenant sem key; throw claro apontando `/admin/ai` quando
ambos ausentes. Cache invalidado automaticamente quando Admin troca
a key via `ai-config.updateConfig`.

**Consumidores migrados (5):** communication-summary, document-compare,
conversion-rate-suggestion, semantic-search, email-link. `getAnthropic()`
legacy mantido como `@deprecated`.

**Testes:** `tests/unit/claude-per-tenant.test.ts` novo com 6 casos:
key do tenant usada, tenants distintos → clients distintos, cache
hit, fallback + warn, throw apontando /admin/ai, invalidate força
re-fetch. Total 387/393 passing (baseline 381 + 6 novos).

### ~~P-15. Mensagem "IA indisponível" engole erros estruturados~~ ✅ FECHADO
**Resolvido em 2026-06-30 pelo commit `be5f244`.** Sintoma: quando a
conta Anthropic ficava sem créditos, HTTP 400 com corpo `{"error":
{"type":"invalid_request_error","message":"Your credit balance is
too low..."}}`. Service capturava como Error genérico → UI mostrava
"IA indisponível no momento" e o usuário ficava tateando.

**Causa raiz:** `communication-summary.service.ts` catch tratava só
`FeatureNotAvailableError`/`AiLimitExceededError`; qualquer outro
erro caía em `aiGenerated:false`. Ignorava `Anthropic.APIError` do
SDK que expõe `.status` e `.message` estruturados.

**Fix:** helper reusável `mapAnthropicError(err)` em
`src/lib/ai/anthropic-errors.ts` converte `Anthropic.APIError` em
`TRPCError` acionável:
 - 400 "credit balance" → `PRECONDITION_FAILED` com link
   `https://console.anthropic.com/settings/billing`
 - 402 → `PRECONDITION_FAILED` "sem créditos"
 - 401/403 → `UNAUTHORIZED` "chave inválida, atualize em /admin/ai"
 - 429 → `TOO_MANY_REQUESTS` com header retry-after se presente
 - 5xx → `null` (mantém fallback silencioso + circuit breaker)

**Escopo:** aplicado nos 3 serviços user-facing (communication-summary,
document-compare, conversion-rate-suggestion). email-link (background
worker) e semantic-search (degrade gracioso) seguem no fallback
silencioso — sem UI aguardando resposta.

**Testes:** +5 casos em `communication-summary-errors.test.ts`
(400 credit, 401, 429 sem/com retry-after: 30, 5xx silencioso).
Instancia `Anthropic.APIError` direto (sem mock HTTP). Total
392/398 passing.

### ~~P-16. Busca global (Command Palette ⌘K) sem handler~~ ✅ FECHADO
**Resolvido em 2026-06-30.** Sintoma: botão "Buscar…" com atalho
`⌘K` visível na Topbar em toda rota autenticada (linhas 67-77 de
`src/components/layout/Topbar.tsx`), mas era `<button>` sem
`onClick` — placeholder morto desde o Sprint 14.

**Fix:**
- Router tRPC novo `src/server/trpc/routers/search.ts` com
  procedure `global` (Zod input `{query: min 2, max 100}`) que
  retorna 4 buckets (companies/contacts/opportunities/users),
  top 5 cada, via `ILIKE '%q%'` no Prisma. Tenant isolation via
  `WHERE tenantId = ctx.tenantId` explícito. RBAC gracioso: user
  sem `<entity>:read` recebe array vazio no bucket (não erro
  global). CNPJ tolera máscara (extrai dígitos antes do LIKE).
- Fica sob a key tRPC `search` mesclada com `searchNaturalRouter`
  do Sprint 6 (semantic query) — cliente consome como
  `trpc.search.global` e `trpc.search.natural` sem confusão.
- Componente `src/components/search/CommandPalette.tsx` — overlay
  standalone (não usa `<Modal>` pra evitar conflito entre
  Tab-trap + navegação por setas). Debounce 200ms via setTimeout,
  ↑/↓ movem highlight, Enter navega, ESC fecha, clique também
  navega. Empty/loading/hint states. RBAC parcial vira bucket
  omitido no render (sem heading nem lista).
- Roteamento por bucket: `companies` → `/companies/<id>`,
  `contacts` → `/contacts/<id>`, `opportunities` → `/pipeline/<id>`,
  `users` → `/admin/users` (sem tela de detalhe — abre a lista).
- `Topbar.tsx` — botão ganhou `onClick={setPaletteOpen(true)}` +
  atalho global via `useEffect` que escuta `(Cmd|Ctrl)+K` no
  `document` (respeitando `HIDDEN_ON` das rotas públicas).

**Escopo:** 2 arquivos novos (router + componente) + 3
modificações mínimas (`_app.ts` merge, `inbox.ts` rename export,
`Topbar.tsx` wire). Sem migration, sem mudança em RBAC catálogo.

**Testes:** 18 novos.
- `tests/unit/search-router.test.ts` (9): Zod input rejeita
  query <2/>100 chars, extrai dígitos-only pra LIKE de CNPJ,
  não roda LIKE de CNPJ sem ≥2 dígitos, RBAC parcial vira
  bucket vazio.
- `tests/unit/command-palette.test.tsx` (9): não renderiza
  fechado, input recebe foco, hint <2 chars, ESC → onClose,
  empty state, resultados agrupados por bucket com heading,
  setas ↑/↓ movem highlight + Enter navega, skeleton loading
  visível, href correto por bucket (opportunity → /pipeline/).
- Baseline 381 → 399 passing. Mesmas 4 falhas pré-existentes
  (env vars ausentes em field-encryption/rate-limiter/ai-pricing/
  document-compare/summary-parser) + 2 skipped seguem iguais.

**Débito residual → novo P- futuro:** fuzzy match / typo tolerance
+ tsvector PT-BR pra full-text search. `ILIKE '%q%'` é suficiente
enquanto tenant tem <100k contatos. Escala vira P-XX se surgir
demanda.

### ~~P-17. Tabelas sem ordenamento clicável~~ ✅ FECHADO
**Resolvido em 2026-06-30 pelos commits `e269325` (infra) +
`7e4949f` (rollout).** Sintoma: as 8 tabelas do app mostravam
dados na ordem que o backend devolveu. Clicar no header não
fazia nada.

**Causa:** `src/components/ui/table.tsx` — `TH` era wrapper mudo
de `<th>` sem prop `sortable`. Consumidores mostravam apenas
título sem controle de ordem.

**Fix:**
1. **`src/components/ui/table.tsx`** — `TH` ganhou `sortable`,
   `sortState`, `onSort`. Chevron dupla (null), single up (asc),
   single down (desc). `aria-sort`, `role="columnheader"`,
   `tabIndex={0}`, Enter/Space dispara `onSort()`. Focus ring
   Venzo. Comportamento sem `sortable` inalterado — não regride
   consumidores existentes
2. **`src/lib/hooks/useTableSort.ts`** — Hook com toggle
   asc → desc → null (volta ordem original). Null-safe
   (null/undefined ao fim em asc, ao início em desc). Strings
   usam `localeCompare('pt-BR', {sensitivity:'base', numeric:true})`.
   Accessor pode ser `keyof T` OU função pra valor computado
   (ex: `(t) => t._count.users`). Helpers puros expostos
   (`compareSortValues`, `resolveValue`, `nextSortState`) para
   testabilidade sem `@testing-library`
3. **`src/lib/trpc/client.ts`** — expõe `RouterOutputs` via
   `inferRouterOutputs<AppRouter>` para tipar linhas nas pages
   sem redeclarar

**Rollout aplicado em 7 tabelas + 1 lista de cards:**
- `/companies`: Razão social, Tipo, CNPJ, Cidade/UF
- `/contacts`: Nome, E-mail, Cargo, Área, Relacionamento
- `/admin/users`: Nome, E-mail, Papel, Último login, Status
- `/admin/products`: Nome, Tipo, SKU, Margem mín., Status
- `/admin/partners`: card list — select "Ordenar por" (Nome,
  Comissão, Contratos abertos), mesma matemática via helpers
  puros. Não é tabela; conversão pra tabela seria mudança maior
  fora do escopo P-17
- `/platform/tenants`: Nome, Plano, Status, Users, Opps, Criado
- `/platform/trials`: Tenant, Source, Termina em, Setup,
  Estendido

`/contacts`, `/admin/users` e `/admin/products` também migradas
de raw HTML `<table>` para `Table/THead/TH/TR/TD` do design
system Venzo por consistência visual.

**Testes:** 23 novos (15 em `use-table-sort.test.ts` cobrindo
helpers puros; 8 em `table-th-sortable.test.tsx` cobrindo
click/keyboard/aria-sort/chevrons via react-dom + act).
Baseline 381 → 404 passing. Type-check zero. Lint zero.

**Fora do escopo (registrar como P-18 se necessário):**
- Dashboard não tem `<table>` — usa `<ul>` de alertas
- Outras tabelas platform (`/platform/audit`, `/platform/broadcasts`,
  `/platform/ai-marketplace`, `/platform/ai-ops`, `/platform/privacy`)
  usam design-system Table mas não estavam listadas na P-17;
  aplicar em rollout separado se pedido
- Server-side sort para listas > 200 rows — nenhuma detectada
  neste rollout; adicionar `sortBy`/`sortDir` na query tRPC
  quando surgir

### P-22. Convite de usuário sem indicação do tenant de destino
**Severidade:** 🔴 Alta (risco de convite pro tenant errado em
impersonação). Identificado em 2026-06-30 por Fred: "como sei
para qual tenant estou convidando o usuário?".

**Comportamento atual:** o backend `users.invite` pega
`ctx.tenantId` da sessão ativa e convida sem exibir isso ao
Admin. Em cenário de impersonação (Platform Owner logado como
outro tenant), o convite vai pro tenant impersonated — nada
indica isso na UI.

**Impacto real:**
- Admin de tenant único (99% dos casos) confia que é sempre o
  próprio — OK.
- **Platform Owner impersonando** pode convidar erradamente pra
  tenant X quando ainda achava que estava fora do modo
  impersonate. Convite disparado, senha configurada, acesso
  garantido — reverter exige remover user à mão.

**Fix (~30min):**
1. Modal de convite em `src/app/admin/users/page.tsx:99` adiciona
   linha abaixo do título:
   ```
   Convidando usuário para: {tenantName}
   ```
   com `tenantName` vindo de `trpc.tenants.current.useQuery()` (já
   existe, retorna nome do tenant ativo).
2. Se `ctx.impersonatedFrom` (Sprint 15A) estiver setado, mostrar
   badge amarelo "⚠ Modo impersonação — verifique o destino
   antes de enviar".
3. Analogamente: aplicar em todos os outros modais de "criar
   entidade que vira do tenant" (create company, create contact,
   create partner) — mesma linha discreta.

**Esforço:** ~30min pra usuários + ~1h se propagar pra todas as
telas de criação.

### P-21. Erro Zod renderizado como JSON cru na UI
**Severidade:** Média (UX). Identificado em 2026-06-30 no
`/admin/users` — convidar usuário com email inválido mostra:

```
[ { "code": "custom", "message": "E-mail inválido", "path": [ "email" ] } ]
```

em vez de apenas "E-mail inválido".

**Causa raiz:** `src/app/admin/users/page.tsx:51` — `onError: (e) =>
setInviteError(e.message)` renderiza `e.message` cru. Do
`TRPCClientError`, `e.message` de erros Zod vem como JSON.stringify
do `zodError.flatten()`.

**Fix (~1h):** helper `src/lib/trpc/error-format.ts` novo:
```ts
export function friendlyTrpcError(err: TRPCClientErrorLike<AppRouter>): string {
  const zod = err.data?.zodError?.fieldErrors;
  if (zod) {
    const first = Object.values(zod).flat()[0];
    if (first) return String(first);
  }
  return err.message;
}
```

E aplicar em todos os formulários com Zod input:
```bash
grep -rn "onError.*e\.message\|setError(e\.message)" src --include="*.tsx"
```

**Padrão consistente:** todo `.useMutation({onError})` deve usar
`friendlyTrpcError(e)` em vez de `e.message`.

**Esforço:** ~1h — helper + refactor de ~10-15 callers + 1 teste.

### ~~P-20. Tarefas na oportunidade sem criar/editar/deletar~~ ✅ FECHADO
**Resolvido em 2026-06-30 pelo commit `030a9de`.** Backend ganhou
`tasks.update` e `tasks.delete` (soft delete via `deletedAt`) com
filtro por `tenantId` no `findFirst` (defesa em profundidade),
audit com `tenantIdOverride` e RBAC via
`withCapability('opportunity', 'update')`. Frontend extraído para
`src/components/pipeline/TasksSection.tsx` com Modal do design
system (form: título, descrição, prazo, prioridade, responsável),
botão "+ Nova tarefa", clique na linha abre modal em modo edit,
botão × dispara `AlertDialog` de confirmação. Toasts Venzo em
todas as mutações. `ActivitiesTimeline` extraído inline no page.tsx
como componente separado. +10 testes em
`tests/unit/tasks-router.test.ts`. 443/449 passing (4 falhas + 2
skipped pré-existentes por env vars).

### P-19. Upload de documentos + templates é placeholder manual
**Severidade:** 🔴 Alta (feature quebrada). Identificado em
2026-06-30 por Fred: "os campos de anexar documentos devem
permitir clicar e abrir a janela de seleção de arquivo".

**Sintoma real (bem pior que o descrito):** dois pontos da UI
pedem o gestor **digitar manualmente**:
- **`/pipeline/[id]` → Anexar documento**
  (`src/components/pipeline/DocumentsSection.tsx`): usuário
  digita URL/path do arquivo, tamanho em bytes e SHA-256 hex
  de 64 chars. Não tem `<input type="file">`.
- **`/admin/templates`** (`src/app/admin/templates/page.tsx`):
  idem — `storageKey` textual manual.

Referência de código que funciona: `/admin/branding`
(`src/app/admin/branding/page.tsx:747`) tem dropzone
funcional com `<input type="file" hidden>` + ref + drop
handler + `handleFile()` que faz upload via tRPC.

**Backend já existe** em `src/server/services/storage-s3.service.ts`:
- `uploadObject(key, body, contentType)` — upload server-side
- `presignDownload(key, expires)` — URL temporária
- `s3Enabled()` — check credenciais
- Fallback pra inline base64 quando S3 não configurado (dev)

**Falta:** `presignUpload(key, contentType, expires)` para PUT
direto do cliente (opcional — pode usar upload via backend).

**Fix escopo cheio (end-to-end):**
1. Adicionar `presignUpload()` ao `storage-s3.service.ts` (opcional
   — decisão do implementador)
2. Router tRPC novo `documents.getUploadIntent` (retorna
   `{storageKey, uploadUrl?}` ou `{storageKey, mode: 'proxy'}`)
3. Componente `<FileDropzone>` reusável em
   `src/components/ui/file-dropzone.tsx` (extraído do padrão
   Branding) com: click abre picker, drag-drop, progress bar,
   validação size/mime, cálculo SHA-256 via Web Crypto API
4. Refactor `DocumentsSection.tsx`: substitui form manual por
   `<FileDropzone>`; após upload, chama `documents.confirmUpload`
   com `{storageKey, filename, sizeBytes, sha256, category}`
5. Refactor `/admin/templates`: idem, categoria fixa TEMPLATE
6. Fallback dev sem S3: aceita upload direto no backend + salva
   em `/tmp/venzo-uploads/<tenant>/<uuid>` (só dev; produção
   exige S3)

**Escopo:**
- 2 componentes novos (`FileDropzone`, tRPC `documents.getUploadIntent`)
- Refactor de 2 telas (`DocumentsSection`, `admin/templates`)
- 1 método novo no service S3 (opcional)
- Testes: dropzone renderiza, click dispara picker, mime/size
  validation, SHA-256 calculado, fallback dev sem S3

**Esforço:** ~1.5-2 dias.

**Débitos residuais possíveis:** upload em outros lugares
(anexos em Activity? Attachments em Contract? Investigar durante
o refactor e listar como P-20+ se surgirem).

### ~~P-13. 401 do middleware vira "Unable to transform response from server"~~ ✅ FECHADO
**Resolvido em 2026-06-30 pelo commit `4fcf4f6`.** Custom
`sessionAwareFetch` em `src/lib/trpc/session-guard.ts` intercepta
responses no `httpBatchLink`; num HTTP 401, loga `console.warn`
com a mensagem do body e chama `window.location.reload()` em
800ms. Flag `handling401` estática garante que batch tRPC com
N procedures só dispara um reload. No-op em rotas públicas
(`/sign-in`, `/sign-up`, `/onboarding`, `/privacy`, `/terms`,
`/p/…`, `/`). +17 testes em `tests/unit/session-guard.test.ts`.
Middleware `src/middleware.ts` não foi tocado — formato JSON
custom preservado pra facilitar debug em Network tab.

### P-18. IA multi-provider por feature + fallback (Sprint 15F)
**Severidade:** 🔴 Alta — design arquitetural. Identificado em
2026-06-30 por Fred: "a tela de IA cadastra apenas 1 serviço, mas
o design era várias IAs, cada uma específica pra um caso, com
fallback quando uma falha".

Spec completa: [Sprint_15F_IA_Multi_Provider.md](Sprint_15F_IA_Multi_Provider.md).

**Escopo:** cascata de resolução `TenantAiFeature.override →
AiFeature.default → Tenant.global`, provider adapters unificados
(Anthropic/OpenAI/Google/Perplexity), `callAiWithFallback()`,
circuit breaker por-(provider, tenant), UI `/admin/ai` refactor
em 4 cards, Platform Marketplace edit, feature flag rollout
gradual.

**Depende de:** P-14 fechado (per-tenant AI key). ✅ Já fechado.

**Esforço:** 5–7 dias. Sprint dedicado.

---

## 📅 Sprints planejados (próximas 4–6 semanas)

### Sprint 15A — Platform Console
Spec: `docs/Sprint_15A_Platform_Console.md`
**5–7 dias.** Renomeação SUPER_ADMIN → PLATFORM_OWNER, `/platform/*`
shell, CRUD de tenants, impersonação com audit trail, audit
cross-tenant, privacy cross-tenant, feature flags Unleash.

**Pré-requisito de OPERAÇÃO.**

### Sprint 15B — AI Operations + Plataforma Estratégica
Spec: `docs/Sprint_15B_AI_Ops_Platform.md`
**4–5 dias.** AI Ops Center (limits, anomaly, model pinning, custo R$),
AI Marketplace (catálogo `ai_features` 3 estados), Tenant Health
Score, Trial Pipeline, Broadcast genérico.

**Pré-requisito de ESCALA.** Depende de 15A.

### Sprint 15C (proposto) — CRUD UI Completo
**3–4 dias.** Fechar buracos de UI que ficaram:

- P-01 (`/companies` + `/contacts` CRUD) — se não fechado antes
- CRUD de **territórios** (sem UI dedicada hoje, só seed)
- CRUD de **segmentos** (sem UI dedicada hoje, só seed)
- Polish do CRUD de **produtos** (modal existe mas pode ter gaps)
- Padronizar todos os admin pages com PageHeader + EmptyState
  consistentes (P-02)

**Status:** sem spec dedicada; criar quando alocar.

---

## 🚀 Roadmap médio prazo (Sprints 16–20)

### Sprint 16 — Hardening de Produção
**5–7 dias.** Pré-requisito pra **production launch**.

Trabalho:
- **Sentry wiring real:** DSN configurado, sourcemaps no build,
  release tracking, breadcrumbs, profiling. Substitui o stub
  do Sprint 0 que só tem `SENTRY_DSN` no env mas não inicializado.
- **Axiom wiring real:** structured logging, log shipping,
  dashboards de queries lentas / erros por endpoint / latência
  por tenant. Hoje é stub.
- **Lighthouse em CI:** workflow + threshold + STAGING_URL
  (resolve P-05)
- **k6 load test:** cenários documentados no
  `Arquitetura_e_Plano_Implantacao_CRM.docx` §6.5:
  - Base: 200 simultâneos, p95 < 300ms
  - Pico: 1000 simultâneos, p95 < 800ms, erro < 0.1%
  - Stress por módulo: pipeline list, reports, busca semântica
- **Smoke E2E contra staging:** Playwright + fixtures, login com
  Clerk real (não bypass), test pack mínimo (login → criar opp →
  avançar estágio → fechar)
- **Cloudflare WAF:** configurar regras OWASP Top 10 (Sprint 11
  spec'd, infra não setup)
- **Documentar runbooks operacionais:** restore de backup Neon,
  incident response, rotacionar PAT/credentials

### Sprint 17 — Comissões Automáticas End-to-End
**4–5 dias.** Sprint 7 entregou parceiros + comissão por vínculo,
mas falta fluxo de pagamento:

- Cálculo de comissões devidas (por contrato fechado / por mês)
- Conciliação manual (Platform Owner marca "pago")
- Integração com sistema financeiro externo (export para Omie/Conta
  Azul/Sage) via webhook ou export
- Dashboard de comissões pendentes / pagas por parceiro
- Carteira de comissões: histórico, declaração mensal pra IRPJ

### Sprint 18 — WhatsApp Business Integração Nativa
**5–7 dias.** Hoje é colar texto pra IA resumir. Próximo passo:

- WhatsApp Business API (Cloud API Meta)
- Mensagens entram via webhook automático (sem colar)
- Vinculação por número de telefone do contato
- Resposta inline na app (admin escreve, sistema envia via WhatsApp)
- Threading: agrupa mensagens por contato + opportunity
- Cost tracking: WhatsApp cobra por conversação (24h window)

### Sprint 19 — Marketplace de Templates de Proposta
**4–5 dias.** Templates de proposta hoje são por tenant. Próximo:

- Marketplace público de templates compartilháveis entre tenants
- Tenant Enterprise pode publicar template como "público"
- Outros tenants podem importar
- Sistema de rating + comentários
- Curadoria pelo Venzo (templates oficiais)
- Substituição de variáveis (nome do cliente, valores, datas)

### Sprint 20 — Agente Autônomo de Prospecção (Beta)
**7–10 dias.** Feature pesada de IA com modelo agentic:

- Input: ICP do cliente (Ideal Customer Profile)
- Agente busca empresas no LinkedIn/CNPJ Receita Federal
- Score de match com o ICP
- Sugere first-touch message personalizada
- Trial fechado pra clientes ENTERPRISE
- Cost: per-prospect (Stripe Metered Billing)

---

## 🌅 Roadmap longo prazo (Sprint 21+)

### Stripe Metered Billing (add-ons usage-based)
Cobrança por uso (tokens IA, prospects buscados, broadcasts enviados).
Hoje é só subscription mensal flat. Depende do AI Marketplace
(Sprint 15B) estar maduro.

### Customer Portal Stripe customizado
Self-service de billing pelos tenants (mudar plano, atualizar cartão,
ver invoices, cancelar). Sprint 12 entregou o link pro Stripe Portal
default; customizar com branding Venzo + recovery flows.

### Calendar Sync bidirecional (Google + Outlook)
Conectar agenda do vendedor com tarefas/atividades do CRM.
Notificações no celular via push (Sprint 10) + email.

### Voice / Audio: meetings via Whisper
Upload de áudio de reunião → transcrição via Whisper → resumo
estruturado via Claude → tarefas no CRM. Substitui receptor de texto
do Sprint 4.

### Mobile native app
PWA cobre 95% hoje. Mobile native (React Native ou Capacitor)
adiciona:
- Notificações nativas mais ricas
- Acesso à câmera pra fotos de cartão de visita / OCR
- Offline-first mais robusto que PWA
- Push token nativo (não Web Push)

Decisão: avaliar custo vs benefício após 12 meses de PWA em produção.

### Open API + GraphQL (opcional)
REST já entregue Sprint 12. Avaliar GraphQL pra integrações complexas
com SAP/Salesforce/HubSpot que querem fetch agregado.

### Compliance avançado
- SOC 2 Type II (auditoria externa, ~6 meses)
- ISO 27001
- Penetration test trimestral
- Bug bounty program (HackerOne)
- WCAG AAA (atualmente AA)

---

## 🤔 Decisões de arquitetura pendentes

### D-01. framer-motion?
**Contexto:** Sprint 14.5 item 6 evitou swipe-down do bottom sheet
por não ter framer-motion. Hoje só CSS transitions. Quando precisar
de mais microinterações (drag-drop do kanban, animação de página,
swipe sheet), framer-motion vira candidato.

**Decisão pendente:** adotar oficialmente ou ficar em CSS puro?
~130kb gzipped não é trivial.

### D-02. Storybook standalone?
**Contexto:** Sprint 14 entregou design system mas sem Storybook.
Componentes documentados em código.

**Decisão pendente:** investir em Storybook (manutenção contínua,
hospedagem, integração CI) ou aceitar docs in-code? Vale se time
crescer pra > 5 devs.

### D-03. i18n?
**Contexto:** App 100% pt-BR. Voz Venzo em português.

**Decisão pendente:** quando começar i18n (next-intl ou react-i18next)?
Recomendado **após** primeiro cliente fora do Brasil ou interesse
concreto de expansão LATAM.

### D-04. PWA vs Mobile native?
Ver roadmap longo prazo. Decisão pós-12 meses em produção.

### D-05. Hospedagem de produção
**Atual:** assumido Vercel + Neon (mencionado em CLAUDE.md como
"hosted").

**Decisão pendente:** confirmar Vercel ou avaliar:
- AWS ECS + RDS PostgreSQL (mais controle, +ops)
- Render / Fly.io (mais barato pequena escala)
- Cloudflare Pages + D1 (edge-first, mas requer reescrita Prisma)

Para MVP: Vercel + Neon é o caminho de menor atrito. Decidir antes
do Sprint 16 (hardening prod).

### D-06. Tier de plano e pricing
**Atual:** enum `TenantPlan` tem TRIAL/STARTER/PRO/ENTERPRISE mas
preços não definidos em código (só `STRIPE_PRICE_*` env stubs).

**Decisão pendente:** preços finais por plano + matriz de features
incluídas (a entrada de catálogo do Sprint 15B `default_inclusion`
JSONB precisa ser preenchida com dados reais).

---

## 🐛 Débitos técnicos identificados

### T-01. Audit log silencioso em vários routers
Ver P-04 (curto prazo). Memory `audit-trpc-context-loss.md`.

### T-02. PWA não rodando local
Sprint 14 dev log mostra `(serwist) Serwist is disabled` —
Service Worker desabilitado em desenvolvimento. Em produção precisa
verificar manualmente após Sprint 16 (hardening) que ele inicializa
corretamente.

### T-03. `MAINTENANCE_WINDOW` vs broadcasts
Sprint 14.5 implementou `NEXT_PUBLIC_MAINTENANCE_MESSAGE` como
env. Sprint 15B substitui por broadcasts targeting. Migrar
deprecando o env após 15B (não breaking — só remover o
componente quando todos os tenants tiverem o novo).

### T-04. Sentry/Axiom stubs
Sprint 0 incluiu env vars mas não inicialização real. Sprint 16
resolve.

### T-05. Seed scripts vs produção
`prisma/seed.ts` popula 3 tenants pra dev. Em produção não roda
(corretamente). Mas falta `prisma/seed-platform.ts` (Sprint 15A) e
`prisma/seed-ai-features.ts` (Sprint 15B) que **precisam** rodar uma
vez na produção como migration de dados.

### T-06. Permissões ANALISTA não cobertas pela suite de teste
Sprint 5 menciona visibilidade ANALISTA em reports (só vê própria
linha + média anônima), mas E2E `pipeline-7-stages.spec.ts` testa só
ADMIN. Suite de teste de RBAC por role faltando — risco de
regressão silenciosa em permissões.

### T-07. Backup do Neon
Neon faz backup automático mas não há **export externo** programado.
Sprint 16 documenta no runbook + cria worker `daily-backup-export`
(dump pra S3 + retenção 90d).

---

## 📊 Visão consolidada

| Categoria | Itens | Esforço aprox |
|---|---|---|
| **Curto prazo** (P-01 a P-05) | 5 fixes | ~13h (~2 dias) |
| **Sprint 15A** | Platform Console operacional | 5–7 dias |
| **Sprint 15B** | AI Ops + Estratégico | 4–5 dias |
| **Sprint 15C** (proposto) | CRUD UI completo | 3–4 dias |
| **Sprint 16** | Hardening produção | 5–7 dias |
| **Sprint 17–20** | Features estratégicas | 5–10 dias cada |
| **Longo prazo** | Compliance, mobile, etc | 12+ meses |
| **Decisões pendentes** | 6 decisões arquiteturais | revisão |
| **Débitos técnicos** | 7 itens (T-01 a T-07) | distribuído |

**Próximo ciclo prioritário sugerido:**
1. **Curto prazo P-01 + P-02 + P-03 + P-04** (~2 dias) — fecha
   débitos mais imediatos
2. **Sprint 15A** (5–7d) — habilita operação de produto
3. **Sprint 16** (5–7d) — hardening prod antes do go-live público
4. **Sprint 15B** (4–5d) — habilita escala de IA
5. Decisão D-05 (hospedagem) antes do go-live
6. Sprint 15C / 17+ conforme demanda

Total ciclo prioritário: **~4–6 semanas** até produção robusta.
