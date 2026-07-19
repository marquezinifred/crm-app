# Roteiro QA — Homologação Staging

> **Doc executável.** PO/QA roda esse checklist após cada deploy em staging (Vercel + Railway) pra decidir se a release é aprovada.
>
> **Fonte da verdade única.** Se cenário não está aqui, não é obrigatório pra release. Se você encontrar caso novo que deveria bloquear, abra PR nesse doc primeiro, depois valide.
>
> **Não é:** runbook de troubleshooting (isso é o [`Runbook_Staging.md`](Runbook_Staging.md)) nem deploy guide (isso é o [`DEPLOY_Vercel_Guide.md`](DEPLOY_Vercel_Guide.md) e o [`DEPLOY_Railway_Worker.md`](DEPLOY_Railway_Worker.md)).
>
> **URL staging:** `https://crm-app-pi-eight.vercel.app`
> **Última atualização:** 2026-07-04

---

## Como usar

1. **Antes do deploy** — bater os checklists da §0.
2. **Durante o deploy** — seguir os guias linkados.
3. **Pós-deploy** — rodar §1 (smoke, 5min). Se falhar, rollback (§6).
4. Se §1 passa, rodar §2 (funcional, ~1h) + §3 (segurança).
5. §4 (degradado) é documentação — não bloqueia release.
6. §5 é referência do que já está automatizado.
7. §7 é sign-off do PO.

Cada checkbox tem **passo** + **critério pass/fail explícito**. Não vale "verificar que funciona".

---

## 0. Pré-deploy (bloqueadores)

Rodar antes de subir qualquer coisa em staging. Se um item falha, corrigir antes.

- [ ] **Baseline de testes verde**
  ```bash
  npm test
  ```
  Esperado (env dummy consistente — todo `xxx-dummy` no `.env.example`): `715 passing / 0 failing / 168 skipped (883 total)`. Com env vars parcialmente reais em setup de dev, ~709 é aceitável — 6 tests em `tests/unit/communication-summary-errors.test.ts` dependem de `ANTHROPIC_API_KEY` real. Se ultrapassar 10 falhas OU baixar de 709 passing, investigar antes de subir staging. Baseline atualizado em CLAUDE.md §"Baseline de testes atual (2026-07-04)"; snapshot histórico em [`QA_Automation_Report_Sprint_15E.md`](QA_Automation_Report_Sprint_15E.md) preservado como referência do Sprint 15E.
- [ ] **Type-check zero**
  ```bash
  npx tsc --noEmit
  ```
  Esperado: sem output (exit 0).
- [ ] **Lint zero**
  ```bash
  npm run lint
  ```
  Esperado: `✔ No ESLint warnings or errors`.
- [ ] **Senha do Neon staging rotacionada (P-32)**
  Neon dashboard → project → Roles → verificar que `password_last_rotated_at` do role principal é posterior à data em que o Fred colou connection string no chat (2026-07-XX). Se dúvida, rotacionar de novo — leva 5min.
- [ ] **Migrations aplicadas em Neon staging sem drift**
  ```bash
  DATABASE_URL="<staging>" npx prisma migrate status
  ```
  Esperado: `Database schema is up to date!`. Se aparecer "following migration(s) have not yet been applied", rodar `npx prisma migrate deploy` contra staging.
- [ ] **RBAC cache populado**
  ```bash
  DATABASE_URL="<staging>" npm run rbac:backfill-cache
  ```
  Idempotente. Se pular esse passo, `permissions.whoHas` retorna vazio e notificações inbound quebram.
- [ ] **Env vars conferidas** — ver Anexo A. Cada var em ✅ obrigatório precisa estar setada em Vercel e Railway (quando aplicável).
- [ ] **Feature flags conferidas antes do rollout**
  - `RBAC_GRANULAR_ENABLED=false` no 1º deploy (ligar só depois de §2.5 passar).
  - `MULTI_AI_ENABLED` casa em Vercel e Railway (mesmo valor).
  - **P-60 (2026-07-05):** parsing de booleanas agora interpreta literal
    (`"true|1|yes|on"` liga, `"false|0|no|off|""` desliga). Antes disso
    `z.coerce.boolean("false") === true` LIGAVA silenciosamente qualquer
    flag escrita como `=false`. Se subiu antes de 2026-07-05 com
    `MULTI_AI_ENABLED=false` esperando desligar, reveja o estado atual
    (o path novo pode ter ficado ligado).
- [ ] **Chaves Clerk reais em staging/prod (NUNCA dummies)** — o `.env.example`
  documenta dummies (`pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk` +
  `sk_test_dummy_do_not_use_in_prod`) só para dev/QA local em worktree —
  eles passam o parser do SDK e deixam `next dev` subir, mas qualquer
  chamada real ao Clerk API retorna `clerk_key_invalid`. Em Vercel e
  Railway, confirmar que as vars `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` e
  `CLERK_SECRET_KEY` apontam pra instância Clerk real
  (`guiding-bobcat-23.clerk.accounts.dev` em staging). Ver P-39 no
  [`Backlog_Pos_MVP.md`](Backlog_Pos_MVP.md) pra contexto.

---

## 1. Smoke pós-deploy (5min — bloqueia release se falhar)

Cenários mínimos que provam que o app subiu. Se qualquer um falhar, **rollback imediato** (§6).

### 1.1. Vercel app respondeu

- [ ] **App HTTP 200**
  ```bash
  curl -sI https://crm-app-pi-eight.vercel.app | head -1
  ```
  Esperado: `HTTP/2 200` ou `HTTP/2 307` (redirect pra /sign-in). Qualquer outro → falha.
- [ ] **Health endpoint OK**
  ```bash
  curl -s https://crm-app-pi-eight.vercel.app/api/v1/health
  ```
  Esperado: `{"status":"ok","checks":{"db":"ok"}}`. Se `db` != `ok`, banco fora.
- [ ] **Sign-in renderiza**
  Abrir `https://crm-app-pi-eight.vercel.app/sign-in` no browser anônimo.
  Esperado: form Clerk aparece, sem erro no console (F12).
  Falha: 500, "Invalid environment variables", erro CORS.

### 1.2. Railway worker vivo

- [ ] **6 queues BullMQ prontas** — Railway dashboard → Deployments → Logs (últimos 60s).
  Esperado (uma linha por queue):
  ```
  [workers] alerts-scan + email-send + import-run + ai-usage-rollup +
            health-score-rollup + inbound-lead-create rodando
  ```
  Falha: erro `ECONNREFUSED` (Redis não conectou), `Invalid environment variables`, `P1000/P1001` (Prisma → banco fora).
- [ ] **Redis Upstash com conexão ativa** — Upstash dashboard → Details → Metrics → gráfico "Connected Clients" mostra ≥ 1 (worker) + N clientes Vercel serverless (varia).
  Falha: 0 connected clients → worker morto ou Redis quebrado.

### 1.3. Logs sem erro fatal

- [ ] **Vercel Runtime Logs sem 5xx no último minuto**
  Vercel dashboard → Deployments → deploy atual → Runtime Logs → filtro "Errors".
  Esperado: vazio ou só erros esperados (ex: 401 de teste). Um único 500 já pede investigação antes de liberar §2.
- [ ] **Railway logs sem stack trace repetido** — logs do worker sem loop `Error: ... at ... at ...` a cada 10s.

---

## 2. Cenários funcionais (~1h — necessários pra aprovar release)

Roda depois de §1 verde. Cada bloco é independente — pode delegar pra testers diferentes se quiser paralelizar.

**Convenção:** login inicial como **admin do tenant marquezini** (Fred). Se cenário pedir outro role, marca explicitamente. Se pedir Platform Owner, seu user precisa ter dual identity configurada (memory `crm-app-setup-state`).

### 2.1. Onboarding + primeiro Tenant (5min)

**Só rodar se este deploy adicionou usuário Clerk novo.** Se sua conta já existe em staging, pular pro 2.2.

1. Sign-up novo pela `/sign-in` → "Create account" → completar cadastro Clerk.
2. Esperar redirect automático.
   - **Passa se:** cai em `/onboarding` com form "Complete seu cadastro".
   - **Falha se:** 500 ou tela em branco.
3. Preencher: nome completo + nome do tenant + salvar.
   - **Passa se:** redireciona pra `/onboarding/setup` com checklist de 9 passos.
   - **Falha se:** erro Zod cru na tela (bug P-21 regrediu — investigar).
4. Aguardar ~30s se necessário (Clerk dev delay documentado em Runbook_Staging.md).

**Bloqueia release se:** falhar consistentemente após sign out + sign in.

### 2.2. Fluxo Pipeline core (15min)

Cria uma opp end-to-end e move pelos 7 estágios respeitando validações.

1. **Criar Company**
   - `/companies` → clica "+ Nova empresa" → modal abre.
     - **Passa se:** cursor **não pula** ao digitar (bug P-12 fechado — regressão bloqueia release).
   - Preencher: razão social "QA Test SA", CNPJ válido (usar `00.000.000/0001-91` que é aceito), Tipo=Cliente → salvar.
     - **Passa se:** toast Venzo verde "Empresa criada." + linha aparece na tabela.
     - **Falha se:** JSON cru aparece no lugar de mensagem legível (bug P-21 regrediu).
2. **Criar Contact**
   - `/contacts` → "+ Novo contato" → nome "QA Test", email "qa+test@venzo.com", vincular à "QA Test SA".
     - **Passa se:** contato salva + aparece na tabela.
3. **Criar Opportunity**
   - `/pipeline/new` → selecionar Company "QA Test SA" (autocomplete deve mostrar), título "Deal QA #1", data prevista +30d.
   - **Máscara Valor estimado (P-50 fechado 2026-07-05):** digitar `289311` no campo "Valor estimado (R$)".
     - **Passa se:** input mostra `289.311` (separador milhar `.` pt-BR) ao digitar. Continuar digitando `,50` → mostra `289.311,50`.
     - **Falha se:** input mostra `289311` cru sem separador, ou aceita apenas dígitos (bug P-50 regrediu).
   - Salvar.
     - **Passa se:** redireciona pra `/pipeline/<id>` com header "Deal QA #1" + badge "LEAD" + valor destacado como `R$ 289.311,50` (Sprint 14.5 `formatBRL`). Payload da mutation `opportunities.create` (Network tab) devolve `estimatedValue: 289311.5` (número puro, não string). Se digitou só `289311`, payload = `289311`.
   - **Cross-check edição:** ainda em `/pipeline/<id>`, avançar até estágio OPORTUNIDADE. Campo "Valor estimado (R$)" no form do estágio deve exibir o mesmo valor com máscara pt-BR. Digitar `500000,75` → mostra `500.000,75`. Salvar → payload `opportunities.update` devolve `estimatedValue: 500000.75`.
4. **Salvar campos por estágio (regressão P-42 fechada 2026-07-05)**
   - Ainda no estágio LEAD do `/pipeline/<id>`, preencher os campos do estágio:
     - `meetingScheduledAt` = data/hora futura qualquer
     - `meetingHappened` = false (ou o checkbox correspondente)
   - Clicar "Salvar alterações" (ou o botão que persiste os campos por estágio).
     - **Passa se:** toast Venzo verde de sucesso + campos persistem após F5 (`meetingScheduledAt` aparece preenchido). Network tab mostra `POST /api/trpc/opportunities.update?batch=1` com HTTP **200**.
     - **Falha se:** modal/toast danger com "Unable to transform response from server" OU Network tab mostra **500** com body `Error: [tenant-isolation] Opportunity.update sem tenantId no payload`. Nesse caso, P-42 regrediu — reverter e reabrir o débito.
   - Repetir o mesmo padrão em OPORTUNIDADE (campo `briefing`) e PROPOSTA (`proposalPresentedAt` + `decisionExpectedAt`) — todo `.update` de opp deve responder 200. Vale ampliar spot-checks em `/companies/<id>` "Editar", `/contacts/<id>` "Editar", `/admin/products` edição e `/admin/alerts` update de config: todos passam pelo mesmo backstop reformado, o padrão de falha é idêntico.

4.b. **Feedback de Salvar + desbloqueio da IA (regressão P-54 fechada 2026-07-05)**
   - Ainda no estágio LEAD, editar de novo `meetingScheduledAt` (mudar pra outra data). O botão "Salvar alterações" deve **aparecer** no rodapé do card de estágio (aparece só quando há edições pendentes).
   - Clicar "Salvar alterações":
     - **Passa se:** (a) toast Venzo verde "Alterações salvas." aparece no canto inferior direito; (b) botão "Salvar alterações" **desaparece** imediatamente após o sucesso (dirty state limpo).
     - **Falha se:** tela fica muda sem toast E botão "Salvar alterações" continua visível — bug P-54 regrediu (dirty state não foi limpo no `onSuccess`).
   - Rolar até a seção "Receptor de comunicações" (`CommunicationIntake`):
     - **Passa se:** botão "Resumir com IA" está **habilitado** (sem alerta amarelo "Salve a reunião antes de resumir com IA."). Colar texto ≥10 chars → botão fica ativo.
     - **Falha se:** mensagem amarela "Salve a reunião antes de resumir com IA." aparece mesmo após salvar — bug crítico P-54 regrediu (`stageHasDirtyChanges=true` bloqueia IA indefinidamente).
   - **Loop Edit → Save → Edit:** editar campo de novo → botão Salvar reaparece → salvar → botão some + toast dispara. Repetir 3x; sem toast em cadeia empilhado (max 3 visíveis via `ToastProvider`).
   - **Erro de Salvar (opcional):** simular payload inválido via DevTools OU forçar 500 no server; toast Venzo vermelho aparece com mensagem legível vinda de `friendlyTrpcError` (não é JSON cru).
5. **Avançar pelos 7 estágios**
   Para cada transição, clicar botão "Avançar →" na `/pipeline/<id>`:
   - **LEAD → OPORTUNIDADE:** pede briefing preenchido.
     - **Passa se:** botão fica desabilitado até você preencher o campo `Briefing`.
   - **OPORTUNIDADE → PROPOSTA:** só avança.
   - **PROPOSTA → NEGOCIACAO:** exige ≥ 1 ProposalVersion.
     - Rodar: seção Propostas → "+ Nova proposta" → adicionar versão v1 com valor total e margem → salvar → tentar avançar.
     - **Passa se:** avança. **Falha se:** modal "Não foi possível avançar" com mensagem sobre versão faltando aparece mesmo com versão criada.
   - **NEGOCIACAO → ACEITE:** exige zero approvals em PENDING/REJECTED/CHANGES_REQUESTED.
     - Se aparecer approval pendente (regra em `/admin/approval-rules`), avançar antes.
   - **ACEITE → CONTRATO:** exige Document `category=ACEITE_CLIENTE`.
     - Seção Documentos → "+ Anexar documento" → upload real de arquivo (não digita SHA-256 à mão — bug P-19 fechado, regressão bloqueia).
     - Após upload, definir categoria = "Aceite do cliente".
     - **Passa se:** avança pra CONTRATO com toast + contract handoff email disparado (checar `/admin/contracts` — contrato aparece).
6. **Cancelar opp** (fluxo alternativo — criar uma opp descartável pra isso).
   - Clicar "Cancelar" → modal pede motivo (lossReason).
   - **Passa se:** salva com status LOST, opp some do kanban.

**Bloqueia release se:** qualquer transição valida quebra ou a validação de estágio deixa passar sem exigir o campo (regressão de RBAC/validador).

### 2.3. IA end-to-end (~15min)

Cobre 3 áreas: `/admin/ai` 4 Cards (P-23 + refino), drilldown Platform Owner `/platform/tenants/[id]/ai` (P-06 telas 1+2) e consumo real. Variações derivadas do código atual (`src/app/admin/ai/page.tsx`, `src/lib/ai/admin-alerts.ts`, `src/app/platform/tenants/[id]/ai/**`).

#### 2.3.a. /admin/ai — 8 variações (~10min, todo tenant admin)

**Pré-requisito:** logado como admin do tenant marquezini. Ter uma chave Anthropic válida à mão.

1. **V1 — Card A abre com chave já cadastrada**
   - `/admin/ai` → Card A "Configuração padrão".
   - **Passa se:** provider preselecionado (default ANTHROPIC), modelo em dropdown, campo "Chave API" com helper `Atual: sk-…XXXX. Preencha para substituir.` e placeholder `(deixe vazio para manter)`.
   - **Falha se:** placeholder é `sk-…` (regressão — card não detectou chave existente via `hasApiKey`).

2. **V2 — Testar chave válida (crítico segurança)**
   - Card A → colar chave válida no campo → "Testar chave".
   - **Passa se:** aparece caixa verde `✓ Chave válida — resposta em <N>ms.` E abrir F12 → Network → response do `/api/trpc/aiConfig.testKey` só tem `{ok:true, latencyMs:<N>}` — **sem** campo com valor da chave.
   - **Falha (crítico):** payload de response contém o valor da chave em qualquer campo (inclusive `input` ou `error`) → **bloqueio release imediato**.

3. **V3 — Testar chave inválida**
   - Card A → colar `sk-xxxxxx-invalida` → "Testar chave".
   - **Passa se:** caixa vermelha `✗ Chave inválida — <motivo>` aparece. `<motivo>` deve ser mensagem estruturada (P-15: `chave inválida, atualize em /admin/ai` para 401/403). NÃO deve ser "Unable to transform response from server".

4. **V4 — Trocar provider muda modelos disponíveis**
   - Card A → dropdown Provider → selecionar OPENAI.
   - **Passa se:** dropdown Modelo repopula com opções OpenAI (`gpt-4o-mini`, `gpt-4o`, `gpt-4.1`), primeiro pré-selecionado. Estado `testResult` limpo (banner some se estava lá).

5. **V5 — Card B: modal de feature abre com 3 fieldsets + costAlert**
   - Card B → clicar linha de qualquer feature (ex: `communication-summary`) → modal abre.
   - **Passa se:** modal tem:
     - Checkbox "Feature ativa para este tenant"
     - Fieldset **Provider e modelo** — toggle + selects Provider/Modelo quando ligado
     - Fieldset **Chave API** — toggle + input password + botão "Testar chave" desabilitado quando input vazio
     - Fieldset **Fallback** — toggle + 3 inputs (provider/modelo/chave fallback)
     - Campo "Alerta de custo (R$/mês)" com helper "Opcional. Deixe vazio…"
   - **Falha se:** cursor pula ao digitar (bug P-12 regrediu) ou qualquer fieldset falta.

6. **V6 — Card C: breakdown primary vs fallback com barras (P-23 refino)**
   - Card C → depois de gerar consumo real (executar V7 antes, se card estiver vazio).
   - **Passa se:** vê legenda "Primary · Fallback" no topo direito; 4 tiles (Total tokens, Custo USD, Tokens fallback, Custo fallback USD); lista com barras horizontais duas cores (info + warning) proporcionais ao maior custo da tela.
   - **Passa mesmo sem uso fallback:** só barra azul aparece; barra warning omitida quando `fallbackRequests=0`.
   - **Falha se:** só uma barra brand-primary aparece (regressão pra pré-refino de P-23).

7. **V7 — Card D: 4 alertas possíveis (spec `src/lib/ai/admin-alerts.ts`)**
   - Cenário CIRCUIT_OPEN: derrubar 3+ requests IA em <1min contra provider errado → Card D deve mostrar alerta 🔴 "Circuit breaker aberto — <PROVIDER>" com botão "Limpar".
     - **Passa se:** clicar "Limpar" abre `AlertDialog` (não `confirm()` nativo) com texto "As próximas chamadas ao <PROVIDER> voltam a tentar…"; após confirmar, toast "Circuit breaker limpo."
   - Cenário MISSING_KEY: apagar chave global (Card A → salvar vazio) e ter feature em `INCLUDED` sem chave própria → alerta 🔴 "Feature sem chave — <feature>".
     - **Passa se:** alerta some quando cadastra a chave de volta.
   - Cenário FALLBACK_FREQUENT (P-23 refino): forçar 3+ requests com used_fallback=true em 24h para uma mesma feature (chave primary errada + fallback OK) → alerta 🟡 "Feature caindo em fallback — <feature>".
     - **Passa se:** alerta severity yellow aparece; threshold é `FALLBACK_ALERT_THRESHOLD = 3`.
   - Cenário COST_ABOVE_THRESHOLD (P-23 refino): setar `costAlertBrlMonthly=1` em uma feature ativa que já teve consumo → alerta 🟡 "Custo acima do limite — <feature>".
     - **Passa se:** alerta some quando remove o threshold.

8. **V8 — Card D sem alertas mostra empty state**
   - Estado: chave válida global cadastrada + nenhum circuit aberto + nenhuma feature ativa sem chave + nenhum fallback frequente + nenhum cost overshoot.
   - **Passa se:** texto "Nenhum alerta ativo." aparece; sem lista `<ul>` renderizada.

#### 2.3.b. /platform/tenants/[id]/ai — 6 variações (~5min, Platform Owner only)

**Pré-requisito:** logado como Platform Owner Fred (dual identity — memory `crm-app-setup-state`). Ter um tenant seed (`acme` ou `beta`) com histórico de consumo IA.

1. **V1 — Entrypoints e header do drilldown**
   - `/platform/tenants` → clicar num tenant → em `/platform/tenants/[id]`, header tem 2 botões novos "IA" e "Features IA" (adjacentes a "Impersonar admin").
   - Clicar "IA" → cai em `/platform/tenants/[id]/ai`.
   - **Passa se:** header mostra `IA · <tenant.name>` + slug em fonte mono + badge de plano. Nav "← Voltar para <tenant.name>" no topo.
   - **Falha se:** botões não aparecem (regressão P-06 — entrypoints removidos).

2. **V2 — Card A: 3 MetricTiles + progress bar condicional**
   - Card "Limites e uso do mês" mostra 3 tiles (Tokens consumidos / Requests / Custo estimado em BRL).
   - Progress bar só aparece se `monthlyTokenLimit != null`.
     - **Passa se com limit=100k e uso=40k:** barra brand-primary a 40% + `aria-valuenow="40"`.
     - **Passa se com uso≥80% e <100%:** barra warning.
     - **Passa se com uso≥100%:** barra danger. Percentual pode passar de 100% na dica mas o width fica capped.
   - Custo em BRL aparece na variante compacta com tooltip mostrando valor completo.

3. **V3 — Editar limites (details colapsável + submit)**
   - Card A → `<details>` "Editar limites e models pinados" fechado por default.
   - Expandir → grid 5 campos (monthlyTokenLimit / dailyRequestLimit / pinnedModelHaiku / pinnedModelSonnet / anomalyThresholdMultiplier default 3).
   - **Passa se ao limpar `monthlyTokenLimit` e submeter:** valor persiste como `null` (banco → `NULL`, não `0`). Depois de refresh, campo aparece vazio.
   - **Passa se ao setar `monthlyTokenLimit=5000000`:** persiste como número; progress bar recalcula.
   - Feedback: `p.success` "Limites atualizados." aparece; `p.danger` para erro.

4. **V4 — Card B: breakdown por (provider, model) com barras**
   - Card "Breakdown por provider / model (mês)" com grid `180px 1fr 100px`.
   - **Passa se:** provider em cabeçalho + model em fonte mono truncado (title=modelo full); barra brand-primary proporcional ao maior tokens da tela; custo BRL em brand-accent tabular-nums.
   - Empty state: "Nenhum uso registrado neste mês."

5. **V5 — Card C: histórico diário 30d (chart + tabela) + Card E anomalias**
   - Card "Histórico diário (últimos 30d)" mostra chart de barras (aria-hidden) + tabela abaixo com Data/Provider/Model/Reqs/Tokens/Custo R$.
   - **Passa se:** barras têm altura proporcional; hover em cada barra mostra `<data> · <N> tk`. Tabela tem no máximo 30 linhas.
   - Empty state: "Sem consumo no período."
   - Card E "Anomalias detectadas (últimas 20)" com colunas Tipo/Detalhes/Detectada/Status/Ações.
   - **Passa se anomalia ATIVA:** badge "Ativa" warning + botão "Reconhecer" ghost. Clicar → mutation `acknowledgeAlert` → após revalidação badge muda pra "Reconhecida" success e botão some.

6. **V6 — Tela 2 `/features`: agrupamento por categoria + Select alterna status**
   - Botão "Gerenciar Features IA →" no header (ou link direto `/platform/tenants/[id]/ai/features`).
   - **Passa se:** header mostra `Features IA · <tenant.name>` + badge "N/M ativas" (ex: `3/5 ativas`).
   - Uma section por `AiFeatureCategory` (Sumarização / Scoring / Busca semântica / Classificação / Geração / Extração). Cada tabela mostra Feature (name+desc+code mono) / Provider default / Add-on R$/mês / Status atual (badge) / Select alterar / Add-on ativado em.
   - **Passa se:** alterar Select DISABLED→INCLUDED dispara `tenantAccessSet` sem erro; badge status atualiza após revalidação; erro renderiza como `role="alert"` no topo.

**Bloqueia release se:** V2 (chave IA vazamento) falha, drilldown não abre pra Platform Owner (regressão P-11 dual identity), ou consumo real (V7 abaixo) falha silenciosamente.

#### 2.3.c. Consumo real (~2min)

Fecha o loop — prova que a IA que os cards mostram funciona ponta a ponta.

1. Voltar pra tenant marquezini como admin → abrir opp em `/pipeline/<id>`.
2. Seção "Registrar comunicação" → colar texto de reunião (≥50 chars) → "Resumir com IA".
   - **Passa se:** preview com 4 blocos (resumo/próximos passos/objeções/tarefas sugeridas). Card C de `/admin/ai` incrementa `Total de tokens` em ~1k-5k.
   - **Falha estruturado (P-15):** se conta Anthropic sem créditos, mensagem deve ser `PRECONDITION_FAILED` com link `console.anthropic.com/settings/billing` — **não** "IA indisponível" genérico.
   - **Falha 401/403:** mensagem `UNAUTHORIZED chave inválida, atualize em /admin/ai`.
   - **Falha 429:** `TOO_MANY_REQUESTS` honrando `retry-after` se presente.
   - **Falha 5xx:** payload volta com `aiGenerated: false` e UI cai em modo manual (comportamento esperado).

### 2.4. Inbound Marketing end-to-end (~25min — Sprint 15D)

Cobre 9 variações do fluxo completo: config webhook → 5 matchers do parser → blacklist → low confidence → rate limit por IP → rate limit por sender email → fila → alocação. Derivado de `src/server/services/inbound-parser.service.ts` (5 matchers: webhook JSON / Typeform / RD Station / HTML table / plain key:value) e `src/server/services/inbound-lead-creator.service.ts` (`MIN_CONFIDENCE=0.4`, 5 reasons: `parse_error`, `no_signal`, `blacklisted_domain`, `low_confidence`, `rate_limited_per_sender`).

**Pré-requisito:**
- Ativar tab "Forms de captura" em `/admin/email-inbound` → toggle "webhookEnabled" ligado + salvar
- Copiar URL do webhook e secret pra variável de shell:
```bash
export WEBHOOK_URL="https://crm-app-pi-eight.vercel.app/api/v1/inbound/lead"
export SECRET="<cole-o-secret-daqui>"
```
- Ter Railway worker vivo (§1.2 verificado)
- Ter no mínimo 2 vendedores ativos no tenant marquezini pra testar alocação

1. **V1 — Configuração + rotação de secret**
   - `/admin/email-inbound` → tab "Forms de captura" abre 3 cards (Webhook / Notificação / Blacklist).
   - Card Webhook mostra URL completa + botão "Copiar" + botão "Regenerar secret".
   - **Passa se:** clicar "Regenerar" abre `AlertDialog` danger com aviso "Isso quebra qualquer integração que ainda use o secret antigo".
   - Confirmar → toast success + secret novo aparece (prefixo `whs_`).
   - **Falha (crítico segurança):** value do secret aparece em `audit_logs` (checar `SELECT after FROM audit_logs WHERE action='tenant.inbound.regenerateSecret' ORDER BY created_at DESC LIMIT 1;` — deve mostrar só `rotatedAt`, nunca `webhookSecret`).

2. **V2 — Matcher `webhook-custom-json` (confidence 0.99)**
   ```bash
   curl -sf -X POST "$WEBHOOK_URL?secret=$SECRET" \
     -H 'content-type: application/json' \
     -d '{"contact":{"fullName":"Marina QA","email":"marina.qa+v2@venzo.com","phone":"+55 11 98765-4321"},"company":{"razaoSocial":"Aurora Digital SA","cnpj":"00.000.000/0001-91"},"source":"webhook-custom","message":"Interessada em plano Enterprise"}'
   ```
   - **Passa se:** retorna `202 {"status":"queued"}` E Railway log mostra `[inbound-lead-create]` E card aparece em `/inbox/prospects` em ≤10s com badge `IA · 99%` **em roxo** (variant primary — matcher webhook-custom-json usa confidence 0.99 e o UI marca como IA quando `parsedBy` começa com `ai:`; matchers regex usam `regex:*` e ficam success/verde).
   - Nota: matcher webhook-custom-json na verdade tem `parsedBy='regex:webhook-custom-json'` — badge deve ser **verde `regex · 99%`**. Confidence 99% ainda passa MIN_CONFIDENCE.

3. **V3 — Matcher `typeform-v1` (confidence 0.95)**
   ```bash
   curl -sf -X POST "$WEBHOOK_URL?secret=$SECRET" \
     -H 'content-type: application/json' \
     -d '{"form_response":{"form_id":"typeform-test","answers":[{"field":{"ref":"name"},"text":"Pedro QA"},{"field":{"ref":"email"},"email":"pedro.qa+v3@venzo.com"},{"field":{"ref":"empresa"},"text":"Beta Ind Ltda"}]}}'
   ```
   - **Passa se:** card aparece com badge `regex · 95%` + source `typeform`.
   - Se seu payload real for diferente, cheque `src/server/services/inbound-parser.service.ts:175` (matcher `typeformMatcher`) pra formato exato aceito.

4. **V4 — Matcher `plain-key-value` (confidence 0.85 — mínimo pra passar cascata regex)**
   ```bash
   curl -sf -X POST "$WEBHOOK_URL?secret=$SECRET" \
     -H 'content-type: text/plain' \
     -d $'Nome: Carla QA\nEmpresa: Delta Serviços Ltda\nEmail: carla.qa+v4@venzo.com\nTelefone: (11) 91234-5678\nMensagem: Quer conversar sobre integracao'
   ```
   - **Passa se:** card aparece com badge `regex · 85%`. Empresa dedup se já existir "Delta Serviços Ltda".
   - Testa o KEY_ALIASES do parser (aceita "nome/empresa/telefone" em pt-BR).

5. **V5 — Fallback IA (confidence 0.65) quando nenhum matcher bate ≥ 0.85**
   ```bash
   curl -sf -X POST "$WEBHOOK_URL?secret=$SECRET" \
     -H 'content-type: text/plain' \
     -d 'Oi tudo bom, aqui é o Ricardo QA da empresa Omega Tecnologia, gostaria de agendar uma reunião. Meu email é ricardo.qa+v5@venzo.com'
   ```
   - **Passa se com feature `inbound-lead-parser` ativa (ADDON_ACTIVE ou INCLUDED):** card aparece com badge **`IA · 65%`** (roxo/primary — parsedBy=`ai:...`). Confidence 0.65 passa `MIN_CONFIDENCE=0.4`.
   - **Passa se feature DESATIVADA:** o parser cai em `no_signal` (regex não pegou nada útil) → vai pra `inbound_leads_rejected` (não aparece na fila).
   - **Falha (crítico masking):** logar payload no Anthropic dashboard não deve mostrar "ricardo.qa+v5@venzo.com" em claro (deve estar mascarado como `[EMAIL_1]` — `DataMaskingService` preservado no dispatchChat).

6. **V6 — Blacklist bloqueia (reason=blacklisted_domain)**
   - `/admin/email-inbound` → card Blacklist → adicionar `spam-test.com` na textarea → salvar.
   - Disparar:
   ```bash
   curl -sf -X POST "$WEBHOOK_URL?secret=$SECRET" \
     -H 'content-type: application/json' \
     -d '{"contact":{"fullName":"Bot","email":"bot@spam-test.com"},"company":{"razaoSocial":"Spam SA"},"message":"Ganhe dinheiro fácil!"}'
   ```
   - **Passa se:** retorna 202 (endpoint aceita) MAS card NÃO aparece na fila. Rodar SQL:
     ```sql
     SELECT reason, raw_payload->>'email' FROM inbound_leads_rejected ORDER BY created_at DESC LIMIT 1;
     ```
     Esperado: `reason=blacklisted_domain`.
   - Tab "Histórico" em `/admin/email-inbound` mostra a rejeição com badge danger.

7. **V7 — Low confidence rejeitado (reason=low_confidence)**
   - Disparar com texto que o parser regex não pegue E feature IA DESLIGADA (Card B em `/admin/ai` → editar `inbound-lead-parser` → desmarcar "Feature ativa"):
   ```bash
   curl -sf -X POST "$WEBHOOK_URL?secret=$SECRET" \
     -H 'content-type: text/plain' \
     -d 'algo sem estrutura nem email'
   ```
   - **Passa se:** SQL retorna `reason IN ('no_signal', 'parse_error', 'low_confidence')` (depende de quão pouco sinal — sem email/CNPJ nenhum matcher passa 0.85 e sem IA cai em `no_signal`).
   - Reativar feature IA depois desta variação (senão V5 quebra).

8. **V8 — Rate limit por IP (`PUBLIC_FORM_LIMIT` — 10/min)**
   ```bash
   for i in $(seq 1 12); do
     curl -s -o /dev/null -w "req $i: %{http_code}\n" -X POST "$WEBHOOK_URL?secret=$SECRET" \
       -H 'content-type: application/json' \
       -d "{\"contact\":{\"fullName\":\"Load $i\",\"email\":\"load+$i@venzo.com\"},\"company\":{\"razaoSocial\":\"Load $i SA\"},\"message\":\"teste $i\"}"
   done
   ```
   - **Passa se:** requests 1–10 respondem `202`; requests 11–12 respondem `429` (rate limited).
   - Aguardar 60s antes de rodar outra variação (janela do rate limiter).

9. **V9 — Rate limit por sender email (`SENDER_INBOUND_LIMIT` — 10/h — P-29)**
   ```bash
   # 11 requests com o MESMO email; janela por hora, IP não mais o limitador.
   SAME_EMAIL="spam+sender@venzo.com"
   for i in $(seq 1 11); do
     curl -s -o /dev/null -w "req $i: %{http_code}\n" -X POST "$WEBHOOK_URL?secret=$SECRET" \
       -H 'content-type: application/json' \
       -d "{\"contact\":{\"fullName\":\"Sender $i\",\"email\":\"$SAME_EMAIL\"},\"company\":{\"razaoSocial\":\"Sender Co\"},\"message\":\"spam $i\"}"
     sleep 7  # espaça o suficiente pra não bater `PUBLIC_FORM_LIMIT` (10/min) e isolar sender limit
   done
   ```
   - **Passa se:** os 11 requests retornam `202` (o webhook enfileira ANTES do rate limit do sender, que só age no worker).
   - **Verifica no DB (depois de ~30s):**
     ```sql
     SELECT reason, COUNT(*) FROM inbound_leads_rejected
     WHERE tenant_id = '<TENANT>'::uuid
       AND received_at > now() - interval '5 minutes'
       AND reason = 'rate_limited_per_sender'
     GROUP BY reason;
     ```
     → conta **1** (as 10 primeiras viraram opp; a 11ª rejected).
   - Confirmar em `SELECT COUNT(*) FROM opportunities WHERE tenant_id='<TENANT>'::uuid AND is_inbound=true AND client_contact_id IN (SELECT id FROM contacts WHERE email = '$SAME_EMAIL')` = **10**.
   - **Falha se:** 11ª vira opp (rate limit por sender não ativou) ou nenhuma vira opp (rate limit deu falso positivo).
   - Aguardar 1h antes de rerun ou usar email diferente.

**Após 9 variações, testar alocação na fila:**

10. **Alocar vendedor**
    - `/inbox/prospects` → em qualquer card, botão "Alocar" → Popover Radix com vendedores ordenados por `activeOpps asc`.
    - Clicar num vendedor.
    - **Passa se:** toast success "Lead alocado." + card some da fila. Verificar SQL: `SELECT owner_id FROM opportunities WHERE id='<opp_id>';` → owner_id preenchido.

**Bloqueia release se:**
- V2/V3/V4 falham (parser regex quebrou — perde leads reais)
- V5 vaza PII em masking (crítico LGPD)
- V6 deixa passar blacklist (spam vira opp)
- V8 permite mais de 10 req/min (rate limit por IP não bloqueia bot)
- V9 permite 11+ leads do mesmo email numa hora (rate limit por sender inativo — P-29 regressão)

**Após 8 variações + alocação, revisar leads rejeitados:**

10. **P-30 — Revisão de leads rejeitados em `/admin/inbound-rejected`**
    - Sidebar → Admin → "Inbound rejeitados" (gate `inbound:configure`, aparece só pra ADMIN e outros users com permission granted).
    - **Passa se:** tela abre com PageHeader + 2 Selects (motivo/status). Se rodou V6 e V7 acima, cards de `blacklisted_domain` e `low_confidence`/`no_signal` aparecem.
    - Filtro por motivo: escolher "Domínio bloqueado" → só cards `blacklisted_domain`. Escolher "Erro de parse" → casa `parse_error:X` (startsWith).
    - Expandir card (clicar no botão): mostra `<pre>` do **raw payload cru** + parsed JSON lado a lado. Útil pra debugar por que o parser não pegou.
    - **P-30 promoção manual (bypass do confidence + blacklist):**
      - Num card `low_confidence`, botão "Promover" → `AlertDialog` "Promover lead?" primary → confirmar.
      - **Passa se:** toast success "Lead promovido. Oportunidade <id>… criada." + card muda status pra "Promovido" (badge success) + botões somem.
      - SQL: `SELECT id, status FROM opportunities WHERE tenant_id=<X> AND is_inbound=true ORDER BY created_at DESC LIMIT 1;` → nova opp existe.
      - SQL: `SELECT status FROM inbound_leads_rejected WHERE id='<rej_id>';` → `promoted`.
      - **Falha (crítico dados):** promover mesmo com `parsedJson=null` → BAD_REQUEST esperado. Se conseguir promover sem parsed, criou opp sem dados de contato.
    - **P-30 retry parser:**
      - Num card `no_signal` (V7 acima), botão "Retry parser".
      - **Passa se:** toast success "Parser re-executado." + seção "Novo resultado do parser" aparece embaixo do parsed original, mostrando novo output do parser atual (útil quando prompt IA foi atualizado). Card **não muda de status** — só é preview.
      - Se novo confidence ≥ 0.4, toast diz "Confiança suficiente pra promover." → clicar "Promover" completa o fluxo.
    - **P-30 descarte:** botão "Descartar" → `AlertDialog` danger → confirmar → status vira "Descartado" (badge default). Não é reversível.
    - **P-30 RBAC:** logar como user com `inbound:view_queue` MAS sem `inbound:configure`.
      - **Passa se:** consegue abrir a lista (view_queue basta pro `rejectedList`) MAS botões Promover/Retry/Descartar disparam 403 FORBIDDEN quando clica.
      - Sidebar não mostra o item pra esse user (gate é `inbound:configure`).
    - **Falha se:**
      - Alterar registro sem passar por audit (SQL `SELECT * FROM audit_logs WHERE action LIKE 'inbound.rejected.%' ORDER BY created_at DESC LIMIT 3;` deve ter linha por ação com `tenant_id_override` batendo o tenant atual)
      - Cross-tenant: acessar `/admin/inbound-rejected` no tenant A e promover ID de rejected do tenant B (via API direta) → deve retornar NOT_FOUND
      - `confirm()` nativo em vez de `AlertDialog` Venzo

### 2.5. RBAC Granular (~10min — Sprint 15E)

**Só rodar se `RBAC_GRANULAR_ENABLED=true` no ambiente.** Caso contrário, RBAC segue path legado — testes automatizados de §5 cobrem.

1. **Login como ADMIN de tenant** (Fred).
2. `/admin/users` → escolher user com role DIRETOR_COMERCIAL → clicar "Permissões".
3. Página `/admin/users/[id]/permissions` carrega.
   - **Passa se:** cabeçalho mostra nome + role + email; contagem "efetivo = defaults + granted − revoked" transparente; permissions agrupadas em `<details>` colapsáveis; cada linha com emoji + badge (Padrão/Concedida/Revogada) + histórico inline.
4. **Conceder permission** — escolher `audit:read` (que DIRETOR_C não tem por default) → botão "Conceder" → confirmar com motivo "Auditoria QA 2026-07-04".
   - **Passa se:** badge muda pra "Concedida", histórico inline mostra "concedida por Fred em <hoje> — Auditoria QA 2026-07-04".
5. **Revogar permission** — escolher `opportunity:read_others` (que DIRETOR_C tem por default) → botão "Revogar" → `AlertDialog` aparece.
   - **Passa se:** confirmar dispara mutation e badge muda pra "Revogada".
   - **Falha se:** aparece `confirm()` nativo em vez de AlertDialog Venzo.
6. **Restaurar padrão** — clicar "Restaurar padrão" na permission revogada.
   - **Passa se:** volta pro estado default (badge "Padrão", sem histórico ativo).
7. **Guard anti-escalada (crítico segurança)** — como ADMIN que NÃO tem `audit:read_platform` (Platform Owner only), tentar conceder `audit:read_platform` a outro user.
   - **Passa se:** mutation retorna 403 com mensagem clara sobre anti-escalada.
   - **Falha (crítico):** conseguir delegar → bug de segurança, bloqueia release.
8. **Sidebar respeitando permissions** — logar como user sem `inbound:view_queue`.
   - **Passa se:** item "Fila inbound" **não aparece** na sidebar.

> Os passos 9 e 10 abaixo **independem** de `RBAC_GRANULAR_ENABLED` — o gate de
> UI usa `hasPermissionByRole` (role default) e a mensagem FORBIDDEN vale em
> qualquer path. Rodar sempre.

9. **Gate de permissão na página /more (P-97)** — logar como **ANALISTA** (ou
   qualquer não-ADMIN). Abrir `/more` (índice mobile — use viewport < 768px ou
   URL direta).
   - **Passa se:** a lista **não** mostra nenhum item admin gated que o role não
     tem (Usuários, Produtos, Plano e cobrança, Identidade, Alertas, IA, Taxas
     de conversão, Regras de aprovação, Contratos, Parceiros, Templates, E-mail
     Inbound, Inbound rejeitados, Solicitações LGPD).
   - **Passa se:** items sem gate continuam visíveis (Empresas, Contatos,
     Relatórios, Contratos, Aprovações). ANALISTA vê "Estrutura comercial"
     (tem `sales_structure:read`) mas **não** "Importação" (sem `import:run`).
   - **Passa se:** a lista de /more bate 1:1 com a Sidebar (mesma permission por
     rota — P-88/P-88b).
   - **Falha (regressão P-97):** ANALISTA vê itens admin no /more.
   - Como ADMIN, `/more` mostra todos os itens (sanity).

10. **Mensagem genérica de acesso negado (P-98)** — como user sem uma permission,
    disparar uma ação que retorna FORBIDDEN (ex.: ANALISTA tentando salvar em
    `/admin/conversion-rates`, ou qualquer mutation admin barrada).
    - **Passa se:** o toast/erro mostra exatamente **"Seu perfil não tem acesso
      a esta operação."** — sem expor o role do usuário nem o requisito técnico
      (allowed roles / `resource:action` / permission).
    - **Passa se:** as mensagens são **consistentes** entre telas (withRoles /
      withCapability / withPermission produzem o mesmo texto).
    - **Falha (regressão P-98):** aparece "Perfil ANALISTA não tem acesso
      (requer um de: ADMIN)" ou "Sem permissão: X" — vazamento de detalhe.
    - O detalhe técnico continua disponível pra suporte/debug no `cause` do
      TRPCError (server-side, não serializado pro cliente).

**Bloqueia release se:** guard anti-escalada quebra, UI de permissions não
carrega, /more vaza item admin pra não-ADMIN, ou a mensagem FORBIDDEN volta a
expor role/requisito.

### 2.6. Command Palette ⌘K (~5min)

9 variações derivadas do código real (`src/components/search/CommandPalette.tsx`, `src/server/trpc/routers/search.ts`). Cobre: atalho global, debounce, 4 buckets, teclado + mouse, RBAC gracioso, empty/hint/loading, rotas públicas.

**Pré-requisito:** logado como admin marquezini. Dados de teste da §2.2 já criados (Company "QA Test SA", Contact "QA Test", Opportunity "Deal QA #1"). Ter também 1+ user no admin (ex: você mesmo).

1. **V1 — Atalho global abre em rota autenticada**
   - Em `/dashboard` → pressionar `⌘K` (macOS) ou `Ctrl+K` (Linux/Win).
   - **Passa se:** overlay `role="dialog" aria-modal="true" aria-label="Busca global"` aparece; scroll do body trava (`document.documentElement.style.overflow=hidden`); input com placeholder "Busque empresas, contatos, oportunidades…" ganha foco.
   - **Passa se:** clicar no botão "Buscar…" da topbar abre também.
   - **Falha se:** nada acontece (regressão P-16 — atalho não wired ao `document`).

2. **V2 — Hint state (< 2 chars)**
   - Overlay aberto, campo vazio.
   - **Passa se:** texto "Digite ao menos 2 caracteres para buscar." aparece centralizado. Digitar 1 char não muda estado; digitar o 2º char troca pra loading/results.

3. **V3 — Debounce 200ms + Network única**
   - Overlay aberto → F12 → Network → filter `search.global`.
   - Digitar "quali" rapidamente (5 chars em <200ms).
   - **Passa se:** só **1 request** a `/api/trpc/search.global` sai (não 5). Últimos 200ms sem tecla → dispara.
   - **Falha se:** múltiplos requests por keystroke (debounce quebrou).

4. **V4 — Loading skeleton**
   - Enquanto request em flight (rede lenta ajuda; ou throttle Slow 3G no DevTools).
   - **Passa se:** 3 barras de skeleton `bg-hover animate-pulse` aparecem + `<span class="sr-only">Buscando...</span>` pra a11y.

5. **V5 — 4 buckets agrupados na ordem esperada**
   - Digitar "qa" (assumindo dados da §2.2).
   - **Passa se:** grupos aparecem na ordem Oportunidades → Empresas → Contatos → Pessoas do time. Só grupos com resultados aparecem (RBAC gracioso — bucket vazio some).
   - Cada grupo tem heading uppercase tracking-wide + itens com ícone SVG + primário + secundário truncado.
   - Cada bucket limita a **top 5** resultados (ver `src/server/trpc/routers/search.ts`).

6. **V6 — Navegação teclado ↑/↓ + Enter**
   - Digitar "qa" → resultados carregam.
   - Pressionar ↓ 2 vezes → highlight muda pra 3º item (className `bg-hover`).
   - Pressionar ↑ 1 vez → volta pro 2º.
   - Pressionar Enter no bucket Empresas item "QA Test SA".
   - **Passa se:** overlay fecha + rota muda pra `/companies/<id>`.
   - Roteamento esperado por bucket: `companies:X` → `/companies/X`; `contacts:X` → `/contacts/X`; `opportunities:X` → `/pipeline/X` (não `/opportunities/X`); `users:X` → `/admin/users`.

7. **V7 — Mouse hover + click (mouseEnter atualiza highlight)**
   - Digitar "qa" → passar mouse sobre 3º item.
   - **Passa se:** highlight visual muda pra 3º (mouseEnter → setHighlight). Clicar → navega mesmo destino que Enter.

8. **V8 — Empty state + ESC + click fora**
   - Digitar "xyzabcdefinexistente" → esperar debounce + response.
   - **Passa se:** texto `Nenhum resultado para "xyzabcdefinexistente".` + sub-texto "Tente outro termo — nome, e-mail ou CNPJ."
   - Pressionar ESC → overlay fecha; scroll do body destrava.
   - Reabrir com ⌘K → clicar no backdrop preto (fora do card branco) → fecha (stopPropagation no card impede fechar clicando dentro).

9. **V9 — Atalho não abre em rota pública**
   - Sign out → em `/sign-in`, pressionar ⌘K.
   - **Passa se:** nada acontece (topbar não é renderizada em rota HIDDEN_ON — atalho não wired).
   - Testar também em `/`, `/privacy`, `/terms`, `/p/<slug>/contact`.
   - **Falha se:** overlay abre → tentativa de bater `search.global` retorna UNAUTHORIZED (não crítico mas é UX ruim).

**Passa como bônus:**
- RBAC gracioso — logar como PARCEIRO (sem `company:read`) → digitar "qa" → bucket "Empresas" não aparece (bucket vazio ao invés de 403 global). Testado em `search-router.test.ts:AC-P16-06`.
- Debounce respeita query.length < 2 — apagar tudo depois de já ter digitado deve voltar pro hint state em vez de rodar uma última query.

**Bloqueia release se:** V1 quebra (feature morta) ou V6 quebra (navegação por teclado é acessibilidade obrigatória — AC-P16-06). V2, V3, V8 são polish e valem regressão registrar como P-XX.

### 2.7. Estrutura Comercial (~15min — Sprint 15G)

6 cenários derivados do código real (`prisma/seed.ts` seed demo,
`src/server/db/repositories/sales-unit.repository.ts` A7,
`src/server/services/sales-structure.service.ts` A4/A5/kill-switch,
`src/server/trpc/routers/sales-structure.ts`). Cobre CRUD de tipos e
units, alocação de membros, `resolveOpportunityScope` respeitando
role + subtree + PARCEIRO row-level.

**Pré-requisito:** seed rodado (`npm run db:seed` OU
`npx prisma migrate reset` inclui seed automático). Tenant
`acme-tech` traz 3 tipos ("Diretoria", "Regional", "Equipe") + 4
units ("Diretoria Sul", "Regional SP", "Equipe Enterprise",
"Equipe Mid-Market") + membros por role vinculados via
`SalesStructureService.addMember`. `SALES_STRUCTURE_ENABLED=true`
em staging pra exercitar o path novo.

1. **V1 — Admin cria tipo de unidade**
   - Login: ADMIN do tenant `acme-tech`.
   - Navegar: `/admin/commercial-structure` → aba "Tipos".
   - Clicar "+ Novo nível" → preencher `name="Filial"`, `level=4`,
     `color="#EC4899"`, `icon="briefcase"`. Salvar.
   - **Passa se:** linha nova na tabela + toast "Nível criado" +
     badge de level "4" com a cor rosa aplicada.
   - **Falha esperada:** repetir com `level=1` → CONFLICT
     (`UNIQUE(tenant, level)` da migration 0031 §A1); friendlyTrpcError
     mostra "Já existe um tipo neste nível.".

2. **V2 — Admin cria unidade raiz (respeitando A7)**
   - Continuando V1. Aba "Organograma" → "+ Nova unidade".
   - Selecionar `typeId="Filial"`, `name="Filial Nordeste"`,
     `parentId="(nenhum — nó raiz)"`. Salvar.
   - **Passa se:** nó "Filial Nordeste" aparece na árvore com badge
     "Filial" cor rosa; `path` no banco começa com `root.<shortId>`;
     `depth=1`.
   - **Falha esperada:** parentId de outro tenant → NOT_FOUND (defesa
     cross-tenant do Repository). Tenta INSERT direto via Prisma (sem
     Repository) → CHECK `sales_units_path_not_empty` viola (A7).

3. **V3 — Admin adiciona membro a uma unit (A5)**
   - Continuando V2. Clicar em "Diretoria Sul" (do seed) → sheet lateral
     abre com breadcrumb "Diretoria Sul".
   - "+ Adicionar membro" → selecionar user `DIRETOR_COMERCIAL@acme-tech`
     → role `MANAGER` → `isPrimary=true`. Salvar.
   - **Passa se:** badge "1 gerente" no card + membro listado no sheet;
     row antiga do backfill A1 em "Padrão" (se existia) tem `isPrimary`
     virado pra `false` — transação A5 desmarca outras primary do user.
   - **Verificação SQL de sanidade:**
     ```sql
     SELECT unit_id, is_primary FROM sales_unit_members
     WHERE user_id = '<DIRETOR_COMERCIAL_id>'
       AND tenant_id = '<tenant_id>';
     ```
     Só 1 row com `is_primary=true`. Partial UNIQUE
     `sales_unit_members_one_primary_per_user` garante isso mesmo sob
     write concorrente.
   - **Falha esperada:** userId de outro tenant → NOT_FOUND (guard
     cross-tenant do Service). Duplicar addMember mesma (user, unit) →
     upsert atualiza role/isPrimary (não gera row duplicada).

4. **V4 — GESTOR vê equipe no /pipeline (kill-switch ON, subtree)**
   - `SALES_STRUCTURE_ENABLED=true` (config env do Vercel; ver Anexo A).
   - Login: user `GESTOR@acme-tech` do seed (vinculado a "Regional SP"
     como MANAGER pelo seedCommercialStructure).
   - Navegar: `/pipeline`.
   - **Passa se:** ScopeSwitcher aparece no topbar do pipeline com
     opções "Minhas oportunidades" (default OWN) e "Minha equipe"
     (TEAM). Trocar pra "Minha equipe" → lista mostra opps de TODOS
     users em "Equipe Enterprise" + "Equipe Mid-Market" (subtree
     descendente via ltree `<@`). Não mostra opps de outras
     regionais/diretorias.
   - **Verificação SQL de sanidade:**
     ```sql
     SELECT DISTINCT owner_id
     FROM opportunities
     WHERE tenant_id = '<tenant_id>'
       AND owner_id IN (
         SELECT user_id FROM sales_unit_members
         WHERE tenant_id = '<tenant_id>'
           AND unit_id IN (
             SELECT id FROM sales_units
             WHERE tenant_id = '<tenant_id>'
               AND path <@ (
                 SELECT path FROM sales_units
                 WHERE name = 'Regional SP' AND tenant_id = '<tenant_id>'
               )
           )
       );
     ```
     Bate 1:1 com o que aparece na UI.
   - **Falha esperada:** mostra opps de outras regionais (bug de
     `SalesUnitRepository.getSubtreeMemberIds` — falha no filtro `<@`).

5. **V5 — DIRETOR_COMERCIAL vê tudo (ALL)**
   - Login: user `DIRETOR_COMERCIAL@acme-tech` do seed (Fase 4c
     vinculado a "Diretoria Sul" como MANAGER).
   - Navegar: `/pipeline`.
   - **Passa se:** ScopeSwitcher com "Toda a empresa" (ALL) default.
     Lista mostra opps de TODO o tenant (todas regionais + diretorias
     + times), independente de estrutura hierárquica. DIRETOR tem
     `opportunity:read_all` — precede `read_team` no
     `resolveOpportunityScope`.
   - **Falha esperada:** DIRETOR_FINANCEIRO tem `read_all` mas NÃO
     tem `read_team` (matriz Sprint 15G Fase 1b) — vê tudo do tenant
     também mas não aparece o toggle "Minha equipe" (só 1 escopo).

6. **V6 — PARCEIRO preservado (A4 — row-level rígido)**
   - Login: user `PARCEIRO@acme-tech` do seed. Este user tem
     `partnerCompanyId` seteado + engajamento aprovado numa
     Opportunity específica.
   - Navegar: `/pipeline`.
   - **Passa se:** ScopeSwitcher NÃO aparece (early return no
     `resolveOpportunityScope` — `scope.type === 'PARTNER'`, não
     `TEAM`/`ALL`/`OWN`). Lista mostra APENAS opps onde:
     `partnerCompanyId = user.partnerCompanyId` E existe
     `PartnerEngagement` com status `APPROVED`.
   - **Falha esperada:** vê opps sem engajamento aprovado, OU vê opps
     de outras partnerCompanies (A4 quebrado — regressão do Sprint 7
     debt closer). PARCEIRO sem `partnerCompanyId` cadastrado → `type='NONE'`
     retorna filter `{id: '00000000-...', tenantId}` (sentinela) →
     lista vazia sem erro.

**Passa como bônus:**
- Kill-switch runtime: setar `SALES_STRUCTURE_ENABLED=false` no
  Vercel + redeploy → GESTOR volta pra fallback binário pré-15G
  (qualquer permission `read_team|read_all` destrava visão tenant-wide).
  Estrutura de units persiste no DB — flag OFF só ignora ela em
  runtime, sem migração. Religar flag restaura visão hierárquica.
- Seed idempotente: rodar `npm run db:seed` 2× seguidas sem erro
  (Fase 4c usa pré-check por `UNIQUE(tenant, name)` em types + units).
- Cross-tenant guard: tentar `salesStructure.createUnit` do tenant B
  com `parentId` de tenant A → NOT_FOUND (cross-tenant defense do
  Repository), não CONFLICT.

**Bloqueia release se:** V4 mostra opps fora da subtree (vazamento
horizontal via `<@` quebrado), V5 GESTOR consegue ver diretoria acima
(escalação vertical), OU V6 PARCEIRO vê opps de outra partnerCompany
(regressão A4). V1/V2/V3 são CRUD admin — bugs registrar como P-XX
mas não bloqueiam release.

### 2.8. Rota /companies/new + erros amigáveis em rotas de operação (~10min — P-94/P-95)

Cenários derivados do bug reproduzido em prod (Fred, 2026-07-17):
link `/companies/new` em `/admin/partners` caía em `[id]` com
`id="new"` e o array Zod cru (`[{"validation":"uuid",...}]`)
renderizava em vermelho na tela. Cobre a rota estática nova
(`src/app/companies/new/page.tsx`) e o sweep de `friendlyTrpcError`
nas rotas de operação (`CompanyDetailContent`, `ContactDetailContent`,
`/companies`, `/pipeline` kanban/mobile/detalhe, `/inbox`,
`/approvals`, `/reports/inbound-vs-outbound`, `/dashboard`).

1. **W1 — /companies/new renderiza form de criação (P-94)**
   - Login: qualquer role com `company:create` (ADMIN/ANALISTA).
   - Navegar direto pra `/companies/new` (deep link, URL na mão).
   - **Passa se:** PageHeader "Nova empresa" + form completo
     (CNPJ com auto-fill, Razão social, endereço, território) +
     breadcrumb "← Voltar para empresas". ZERO texto vermelho com
     JSON.
   - **Falha se:** tela de detalhe com erro `Invalid uuid` (regressão
     — Next voltou a matchear `[id]`).

2. **W2 — Link de /admin/partners deixa de quebrar (P-94)**
   - Login: ADMIN. Navegar `/admin/partners` → clicar no link
     textual `/companies/new`.
   - Preencher Razão social `"Parceira QA Ltda"` + Tipo `Parceiro`.
     Criar.
   - **Passa se:** toast "Parceira QA Ltda adicionada ao seu
     portfólio." + redirect pra `/companies/<uuid>` da empresa criada
     (full-page de detalhe carrega).

3. **W3 — Detalhe com id inválido mostra erro amigável (P-95)**
   - Navegar direto pra `/companies/abc-nao-uuid` e
     `/contacts/abc-nao-uuid`.
   - **Passa se:** ErrorState do design system ("Algo saiu errado."
     + mensagem legível + botão "Tentar novamente"). O array Zod cru
     (`"validation"`, `path`, `code`) NUNCA aparece no body.
   - Repetir com uuid válido inexistente
     (`/companies/00000000-0000-4000-8000-000000000000`) →
     **Passa se:** "Empresa não encontrada." / "Contato não
     encontrado." sem botão de retry, sem `NOT_FOUND` cru.

4. **W4 — Mutations de operação com toast danger (P-95)**
   - `/approvals`: com uma approval pendente, derrubar a rede
     (DevTools offline) e clicar "Aprovar".
   - `/inbox`: mesma técnica em "Vincular" / "Rejeitar".
   - Detalhe de empresa → "Desativar empresa" offline.
   - **Passa se:** toast vermelho com mensagem legível via
     `friendlyTrpcError` em cada caso. Sem falha silenciosa, sem
     JSON.

5. **W5 — Erros de query em listas de operação (P-95)**
   - Simular 500 (parar o backend OU token expirado) e carregar
     `/companies`, `/inbox`, `/approvals`,
     `/reports/inbound-vs-outbound`, `/dashboard`, `/pipeline`.
   - **Passa se:** cada tela mostra mensagem em `role="alert"` legível
     (não `TRPCClientError:` cru, não JSON). `/pipeline/<uuid-inexistente>`
     mostra "Oportunidade não encontrada.".

**Automatizado:** `tests/component/companies-new-page.test.tsx` (5
casos) + `tests/component/detail-error-friendly.test.tsx` (5 casos)
cobrem W1/W2/W3 em nível de componente. W4/W5 são manuais (dependem
de rede degradada).

**Bloqueia release se:** W1 regride (link quebrado volta) OU W3
mostra JSON cru (P-95 é a promessa de que erro Zod nunca chega ao
usuário em rota de operação).

### 2.9. Feedback de erro nas telas /admin (~10min — P-92)

Contexto: bug em prod (2026-07-17) — mutations admin falhando com
FORBIDDEN sem nenhum feedback. Pior caso: `/admin/conversion-rates`
aparentava salvar e os valores voltavam ao recarregar. Padrão canônico
pós-P-92: **toda mutation admin tem toast de erro via
`friendlyTrpcError` + toast de sucesso**.

Pré-condição: usuário ANALISTA **sem** overrides de permission admin
(um ANALISTA "cru" — o backend deve responder FORBIDDEN nas mutations
abaixo).

- [ ] **F1 — Conversion rates (o caso crítico original)**
  Logado como ANALISTA, abrir `/admin/conversion-rates`, editar um
  valor, clicar Salvar.
  Esperado: toast vermelho com mensagem legível de permissão (ex:
  "Perfil ANALISTA não tem acesso…"). **NUNCA** silêncio + aparência
  de sucesso.
- [ ] **F2 — Approval rules**
  Como ANALISTA, tentar criar regra e desativar regra existente em
  `/admin/approval-rules`.
  Esperado: toast de erro em ambas. Como ADMIN: toasts "Regra criada."
  / "Regra atualizada." / "Regra removida.".
- [ ] **F3 — Sucesso vira toast (ADMIN)**
  Como ADMIN, salvar em `/admin/conversion-rates` ("Taxas de conversão
  salvas."), `/admin/alerts` ("Configurações de alertas salvas."),
  `/admin/contracts` ("Configurações de contratos salvas.") e publicar
  tema em `/admin/branding` ("Tema publicado.").
  Esperado: toast de sucesso em cada; sair e voltar mostra valor
  persistido.
- [ ] **F4 — Banners inline improvisados removidos**
  Forçar erro em `/admin/alerts` e `/admin/branding` (ex: como
  ANALISTA). Esperado: feedback vem como toast — sem parágrafo
  vermelho cru embutido no form (padrão antigo). Estados de UX
  legítimos (preview de upload, aviso de override WCAG ativo)
  continuam inline.
- [ ] **F5 — Smoke demais telas**
  1 mutation falhando em cada: `/admin/privacy` (rejeitar com
  justificativa curta), `/admin/listas` (excluir item em uso),
  `/admin/products` (desativar sem permissão), `/admin/templates`
  (criar sem permissão), `/admin/email-inbound` (regenerar slug sem
  permissão), `/admin/partners` (salvar config sem permissão),
  `/admin/billing` (upgrade com Stripe indisponível).
  Esperado: toast de erro legível em todas — zero silent failure.

Automatizado: `tests/component/admin-error-feedback.test.tsx`
(13 casos — 2 críticas a fundo + smoke alerts/contracts/privacy).

**Bloqueia release se:** F1 ou F2 falham em silêncio (regressão do
bug original). F3–F5 registrar como P-XX se divergirem, sem bloquear.

### 2.10. AlertDialog em ações destrutivas (~5min — P-96)

Contexto: débito P-12 — `confirm()` nativo do browser é proibido pelo
design system (quebra focus trap e tokens). O P-96 zerou o último foco
de `confirm()` nativo em `src/`. Padrão canônico: botão "Remover" abre
`AlertDialog` Venzo (tom danger, título + descrição, loading durante a
mutação), confirmar dispara a mutation + toast, cancelar fecha sem
efeito.

Login: ADMIN do tenant marquezini.

- [ ] **G1 — Approval rules**
  `/admin/approval-rules` (ter ≥1 regra; criar se preciso) → clicar
  "Remover" numa regra.
  Esperado: abre `AlertDialog` "Remover regra?" com o nome da regra na
  descrição — **não** o popup nativo do browser. Confirmar → toast
  "Regra removida." + linha some. Cancelar → nada acontece, dialog
  fecha.
- [ ] **G2 — Produtos**
  `/admin/products` → "Remover" num produto.
  Esperado: `AlertDialog` "Remover produto?" → confirmar → toast
  "Produto desativado.".
- [ ] **G3 — Contatos**
  `/contacts` → "Remover" numa linha (o clique não deve abrir o
  detalhe — `stopPropagation` preservado).
  Esperado: `AlertDialog` "Remover contato?" → confirmar → toast
  "Contato desativado.".
- [ ] **G4 — Zero confirm() nativo residual**
  Spot-check visual: nenhum popup cinza do browser em ação
  destrutiva. (Backstop automatizado: `grep -rn "confirm(" src/` só
  retorna comentários.)

Automatizado: `tests/component/approval-rules-remove.test.tsx`
(5 casos — abre dialog, confirma, cancela, onSuccess, onError).

**Bloqueia release se:** qualquer botão destrutivo abrir `confirm()`
nativo em vez do AlertDialog (P-12 regrediu).

---

### 2.11. Error state das QUERIES nas telas /admin (~10min — P-92b)

Contexto: complemento do P-92. Depois do P-91, várias queries de config
admin viraram `adminOnlyProcedure` (ou `withPermission`) → retornam 403
pra não-admin. O P-92 cobriu `onError` de **mutations**; faltava tratar
o estado de erro das **queries**. Sem isso, ANALISTA acessando a tela
via **URL direta** travava em **"Carregando…" infinito** (caso confirmado:
`/admin/conversion-rates`) OU via lista/tabela vazia silenciosa. Padrão
pós-P-92b: **query em erro → `ErrorState` do design system com a mensagem
via `friendlyTrpcError` + botão "Tentar novamente"**.

Pré-condição: usuário ANALISTA **sem** overrides de permission admin,
acessando as rotas por **URL direta** (a sidebar já esconde os itens
via RBAC — P-88/P-88b; o ponto aqui é o acesso por link/bookmark).

- [ ] **E1 — Conversion rates (o caso crítico original)**
  Como ANALISTA, abrir `/admin/conversion-rates` digitando a URL.
  Esperado: bloco de erro centralizado ("Não foi possível carregar as
  taxas de conversão." + "Perfil ANALISTA não tem acesso…") com botão
  **Tentar novamente**. **NUNCA** "Carregando…" que nunca resolve.
- [ ] **E2 — Approval rules**
  Como ANALISTA, abrir `/admin/approval-rules` via URL.
  Esperado: `ErrorState` amigável no lugar da lista + form vazios; o
  título "Regras de aprovação" continua visível (contexto preservado).
- [ ] **E3 — Smoke demais telas** (URL direta como ANALISTA)
  `/admin/alerts`, `/admin/contracts`, `/admin/branding`, `/admin/ai`,
  `/admin/templates`, `/admin/partners`, `/admin/products`,
  `/admin/privacy`, `/admin/billing`, `/admin/email-inbound` (tabs
  E-mail/Forms/Histórico) e `/admin/inbound-rejected`.
  Esperado: cada uma mostra `ErrorState` legível — nenhuma trava em
  "Carregando…" nem exibe empty state enganoso ("cadastre o primeiro…").
- [ ] **E4 — Loading legítimo preservado**
  Como ADMIN, abrir as mesmas telas com rede lenta (F12 → throttling).
  Esperado: "Carregando…" aparece brevemente e resolve para o conteúdo
  — o branch de erro não sequestra o loading normal.

Automatizado: `tests/component/admin-query-error.test.tsx`
(8 casos — conversion-rates a fundo incl. loading/sucesso/JSON-cru,
approval-rules, smoke alerts/products).

**Bloqueia release se:** E1 ou E2 travam em "Carregando…" infinito ou
mostram JSON cru (regressão do bug original). E3/E4 registrar como P-XX
se divergirem, sem bloquear.

---

## 3. Cenários de segurança (bloqueia release se falhar)

Rápidos (~10min total) mas críticos.

- [ ] **Sem `.env*` no git**
  ```bash
  git log --all --pretty=format:%H -- '.env*' | head -5
  git ls-files '.env*'
  ```
  Esperado: só `.env.example` aparece; nunca `.env.local`, `.env.staging`, `.env.production`.
  Falha: arquivo com secrets no history → **rotacionar tudo imediatamente** (Neon senha, Anthropic key, Clerk secret, encryption key).

- [ ] **Chave IA nunca vaza em response**
  - Cadastrar chave em `/admin/ai` (Card A).
  - `curl -X POST` para `/api/trpc/aiConfig.testKey` (ou clicar botão na UI e olhar Network tab F12).
  - Verificar body da resposta.
  - **Passa se:** só `{ok, latencyMs, reason?}` — nenhum campo com valor da chave.
  - **Falha (crítico):** chave real aparece em qualquer campo.

- [ ] **audit_logs preenchido em mutations sensíveis** (spot-check 5)
  Rodar 5 ações no app (criar company, mudar role de user, aprovar proposta, revogar permission, editar tenant config) e conferir no banco:
  ```sql
  SELECT id, action, tenant_id, actor_id, created_at
  FROM audit_logs
  WHERE created_at > NOW() - INTERVAL '10 minutes'
  ORDER BY created_at DESC LIMIT 10;
  ```
  Esperado: 5 linhas com `tenant_id` preenchido e `action` correspondendo. Bug P-04 (audit silencioso perdendo contexto tRPC) foi fechado — regressão = release blocker.

- [ ] **Multi-tenancy: usuário Tenant A não vê dados de Tenant B**
  Se tiver 2 tenants em staging (marquezini + seed), logar como admin marquezini.
  ```bash
  # Substituir <ID_OPP_TENANT_B> por um id de opp que existe SÓ no tenant B (via SQL direto no Neon).
  curl -H "Cookie: <cookie da sessão marquezini>" \
    https://crm-app-pi-eight.vercel.app/api/trpc/opportunities.byId?input=%7B%22id%22%3A%22<ID_OPP_TENANT_B>%22%7D
  ```
  Esperado: `NOT_FOUND` (não `FORBIDDEN` — princípio Sprint 15A: cross-tenant vira 404 pra evitar enumeration).
  Falha: 200 com dados do tenant B → **stopping bug**, rollback obrigatório.

- [ ] **Rate limit em endpoint público**
  Ver §2.4 passo 8 — 11ª request em 60s pro `/api/v1/inbound/lead` retorna 429.
  Já validado em §2.4 se rodou. Marcar aqui só como confirmação.

- [ ] **Rate limit por sender email (P-29)**
  Ver §2.4 passo 9 — 11º lead do mesmo email em 1h vira `inbound_leads_rejected` com `reason='rate_limited_per_sender'`.
  Bloqueia release se sender consegue mandar 11+ leads/h (bot com IPs rotativos passa).

- [ ] **Guard anti-escalada RBAC**
  Ver §2.5 passo 7 — ADMIN sem X não delega X.
  Já validado em §2.5 se `RBAC_GRANULAR_ENABLED=true`.

**Bloqueia release se:** qualquer item aqui falhar. Segurança não negocia.

---

## 4. Cenários degradados (documentar, não bloqueia)

Comportamentos esperados quando algo cai. Bom validar de vez em quando pra garantir que graceful degradation continua funcionando.

- [ ] **IA fallback funciona quando primary indisponível** (P-15 helper)
  - Configurar em `/admin/ai` Card B feature "communication-summary" com primary provider inválido (chave errada) + fallback válido.
  - Resumir uma comunicação em `/pipeline/<id>`.
  - **Passa se:** resposta chega via fallback (Card C do `/admin/ai` mostra +1 request com `usedFallback=true`).
  - **Documenta se falha:** ver [`Runbook_Staging.md`](Runbook_Staging.md).

- [ ] **401 do middleware faz reload da página** (P-13 session-guard)
  - Deixar sessão expirar (Clerk dev instance tem JWT curto — aguardar ou apagar cookie manualmente).
  - Fazer qualquer ação na app.
  - **Passa se:** console.warn com mensagem "Sessão expirada" + página recarrega automaticamente em ~800ms.
  - **Passa se pop-up cru:** vai pra sign-in.

- [ ] **Zod error renderiza mensagem legível** (P-21 friendlyTrpcError)
  - Tentar criar company com CNPJ inválido "123".
  - **Passa se:** mensagem "CNPJ inválido" limpa aparece.
  - **Falha se:** JSON cru `[{"code":"custom","message":"CNPJ inválido","path":["cnpj"]}]` aparece — regressão P-21.

- [ ] **Modal não rouba foco a cada keystroke** (P-12)
  Já validado em §2.2 passo 1.

- [ ] **Upload persiste** (só se S3 configurado; staging usa fallback `/tmp` que perde depois de ~1min entre invocations serverless)
  - Se S3 não configurado, esperado: upload funciona mas arquivo some. Documentado em [`Runbook_Staging.md`](Runbook_Staging.md).

---

## 5. Cenários automatizados (referência)

Não precisa refazer manualmente. Roda no CI.

**Suite Vitest (`npm test`)** — 715 passing / 0 failing / 168 skipped (883 total) com env dummy consistente. Com env vars parcialmente reais, ~709 (6 tests de `communication-summary-errors` dependem de `ANTHROPIC_API_KEY`). Ver CLAUDE.md §"Baseline de testes atual (2026-07-04)".

**Suite Playwright (`npm run test:e2e`):**
- [`tests/e2e/axe-smoke.spec.ts`](../tests/e2e/axe-smoke.spec.ts) — a11y smoke (axe-core) em 5 rotas públicas + 4 autenticadas. Excluí `iframe` das AxeBuilder chains (P-52 2026-07-05) porque axe reportava `html-has-lang` contra subframe injetado pelo Clerk. Se em staging aparecer nova violação `html-has-lang` em iframe próprio (nosso, não terceiro), reverter o exclude e adicionar `lang` no iframe local.
- [`tests/e2e/rbac-permissions-ui.spec.ts`](../tests/e2e/rbac-permissions-ui.spec.ts) — 10 tests UI RBAC (Sprint 15E, AC-20).
- [`tests/e2e/pipeline-7-stages.spec.ts`](../tests/e2e/pipeline-7-stages.spec.ts) — pipeline end-to-end (skip condicional se `E2E_TEST_TENANT_ID` ausente).
- [`tests/e2e/smoke.spec.ts`](../tests/e2e/smoke.spec.ts) — home + health endpoint + form público.

**Relatórios detalhados:**
- [`QA_Automation_Report_Sprint_15E.md`](QA_Automation_Report_Sprint_15E.md) — 17 arquivos cobrindo 26 ACs RBAC.
- [`Sprint_15E_RBAC_Granular.md`](Sprint_15E_RBAC_Granular.md) — spec + matriz de permissions.

**Não coberto por automação (rodar manual):**
- Upload real de arquivo (drag-drop no browser).
- Consumo real de IA (billing na Anthropic).
- Push notifications (VAPID web push).
- Fluxos Stripe checkout (rota externa).
- Impersonação Platform Owner (JWT cookie manual).

---

## 6. Rollback

Se checklist falhar em §1 (smoke) ou §3 (segurança), rollback obrigatório.

**Opção 1 — Desligar flag problemática** (mais rápido):
```bash
vercel env rm RBAC_GRANULAR_ENABLED production
vercel env add RBAC_GRANULAR_ENABLED production
# valor: false
vercel --prod
```

**Opção 2 — Reverter pra deploy anterior:**
Vercel dashboard → Deployments → clicar num deploy verde anterior → menu "…" → "Promote to Production".

**Opção 3 — Reverter workers:**
Railway dashboard → Deployments → escolher versão anterior → **Redeploy** (1-click, sem downtime).

**Opção 4 — Rebuild com commit anterior:**
```bash
git revert <SHA_QUEBRADO>
git push origin main   # Vercel auto-deploya
```

**Após rollback:** documentar sintoma + horário + URL no comentário do PR e/ou WhatsApp/Slack pro Fred + reabrir a task no backlog.

Ver também [`Runbook_Staging.md`](Runbook_Staging.md) pra sintomas conhecidos.

---

## 7. Sign-off

Depois que §0-§3 estão verde:

```
Release: <tag ou SHA>
Data: <YYYY-MM-DD HH:MM BRT>
Rodado por: <Nome>
Notas: <observações relevantes; deixar em branco se nada>

Assinatura PO: ______________________
```

Colar no PR merge comment ou release notes.

---

## Anexo A — Env vars obrigatórias por ambiente

Legenda: ✅ obrigatório · 🟡 recomendado · ⬜ opcional · — não aplicável.

| Var | Vercel | Railway | Origem/Valor |
|---|:-:|:-:|---|
| `DATABASE_URL` | ✅ | ✅ | Neon staging (pooled connection) — **mesma nos dois** |
| `NEXT_PUBLIC_APP_URL` | ✅ | 🟡 | URL Vercel (`https://crm-app-*.vercel.app`) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ | ✅ | Clerk dashboard → API keys |
| `CLERK_SECRET_KEY` | ✅ | ✅ | Clerk dashboard → API keys |
| `CLERK_WEBHOOK_SECRET` | ✅ | — | Clerk dashboard → Webhooks → signing secret |
| `REDIS_URL` | ✅ | ✅ | Upstash TCP endpoint (`rediss://...`) — **não** REST URL |
| `TENANT_FIELD_ENCRYPTION_KEY` | ✅ | ✅ | `openssl rand -base64 32` — **mesma nos dois**; nunca reusar dev |
| `INBOUND_WEBHOOK_SECRET` | ✅ | — | `openssl rand -hex 24` |
| `ANTHROPIC_API_KEY` | 🟡 | 🟡 | Anthropic console (chave da Plataforma para fallback global) |
| `ANTHROPIC_MODEL_HAIKU` | ⬜ | ⬜ | Default `claude-haiku-4-5-20251001` |
| `ANTHROPIC_MODEL_SONNET` | ⬜ | ⬜ | Default `claude-sonnet-4-6` |
| `OPENAI_API_KEY` | 🟡 | 🟡 | Só se semantic-search precisar de embeddings |
| `PERPLEXITY_API_KEY` | ⬜ | ⬜ | Só se feature IA usar |
| `RESEND_API_KEY` | 🟡 | ✅ | Sem isto, e-mails ficam em dry-run |
| `RESEND_FROM` | 🟡 | 🟡 | Domínio verificado (`noreply@dominio.com`) |
| `USD_BRL_RATE` | 🟡 | 🟡 | Default `5.1` — rollup de custo IA em BRL |
| `AI_PLATFORM_MARGIN` | 🟡 | 🟡 | Default `0.20` — margem da Plataforma sobre IA |
| `MULTI_AI_ENABLED` | 🟡 | 🟡 | **Mesmo valor nos dois** (default `false`; ligar após rollout §2.3) |
| `RBAC_GRANULAR_ENABLED` | 🟡 | 🟡 | **Mesmo valor nos dois** (default `false`; ligar após backfill + §2.5) |
| `STRIPE_SECRET_KEY` | ⬜ | — | Só se testar billing |
| `STRIPE_WEBHOOK_SECRET` | ⬜ | — | Só se testar billing |
| `STRIPE_PRICE_STARTER/PRO/ENTERPRISE` | ⬜ | — | Só se testar billing |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` | ⬜ | ⬜ | Push notifications; sem isto, feature desliga silenciosamente |
| `SENTRY_DSN` | ⬜ | ⬜ | Pós-Sprint 16 (P-35 aberto) |
| `AXIOM_TOKEN` + `AXIOM_DATASET` | ⬜ | ⬜ | Pós-Sprint 16 (P-35 aberto) |
| `NEXT_PUBLIC_MAINTENANCE_MESSAGE` | ⬜ | — | Banner de manutenção quando setado |
| `NODE_ENV` | ⬜ | ✅ | Railway = `production`; Vercel gerencia sozinho |

Origem completa da lista: `src/lib/env.ts` (Zod schema).

---

## Anexo B — Endpoints públicos com rate limit

| Endpoint | Método | Limite | Origem | Validação |
|---|---|---|---|---|
| `/api/v1/inbound/lead` | POST | 10 req/min por IP | `PUBLIC_FORM_LIMIT` (Sprint 11) | §2.4 passo 8 |
| Worker `inbound-lead-create` (após parse) | — | 10 leads/hora por sender email | `SENDER_INBOUND_LIMIT` (P-29) | §2.4 passo 9 |
| `/api/v1/privacy-request` | POST | 10 req/min por IP | `PUBLIC_FORM_LIMIT` | Rate limit testado em `tests/unit/rate-limiter.test.ts` |
| `/api/v1/consent` | POST | 10 req/min por IP | `PUBLIC_FORM_LIMIT` | idem |
| `/api/v1/inbound/email` | POST | sem rate limit explícito (auth via secret) | webhook Postmark/Resend | validação de assinatura |
| `/p/[tenantSlug]/contact` | POST | 10 req/min por IP | `PUBLIC_FORM_LIMIT` | form público |
| `/sign-in` | POST via Clerk | 5 login/15min por IP | `LOGIN_LIMIT` | Clerk enforce + backup local |
| `/api/trpc/*` | POST | 1000 req/min por tenant | `API_LIMIT_PER_TENANT` | limits em `src/server/services/rate-limiter.service.ts` |

Origem: `src/server/services/rate-limiter.service.ts` (constants `LOGIN_LIMIT`, `PUBLIC_FORM_LIMIT`, `SENDER_INBOUND_LIMIT`, `API_LIMIT_PER_TENANT`).

---

## Anexo C — Referências rápidas

- **Deploy Vercel:** [`DEPLOY_Vercel_Guide.md`](DEPLOY_Vercel_Guide.md)
- **Deploy Railway (worker):** [`DEPLOY_Railway_Worker.md`](DEPLOY_Railway_Worker.md)
- **Troubleshooting (sintomas conhecidos):** [`Runbook_Staging.md`](Runbook_Staging.md)
- **Estado atual + task list:** [`HANDOFF_Estado_Atual_2026-07-01.md`](HANDOFF_Estado_Atual_2026-07-01.md)
- **Backlog vivo (P-01 … P-36):** [`Backlog_Pos_MVP.md`](Backlog_Pos_MVP.md)
- **Automação Sprint 15E:** [`QA_Automation_Report_Sprint_15E.md`](QA_Automation_Report_Sprint_15E.md)
- **Matriz RBAC:** [`permission-matrix.md`](permission-matrix.md) (65 permissions × 7 roles)
- **CLAUDE.md changelog:** raiz do repo (`CLAUDE.md`) — histórico dos 24 sprints

---

**Manutenção deste doc:** quando um cenário virar caso comum de release-blocker, promover pra §3. Quando cenário automatizar, mover pra §5 e apagar da §2. Quando surgir feature nova em release, adicionar em §2 antes do merge da spec.
