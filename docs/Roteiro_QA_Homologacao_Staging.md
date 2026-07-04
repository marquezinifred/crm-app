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
  Esperado: `609 passing / 10 failed (pré-existentes: env vars ausentes em field-encryption, rate-limiter, ai-pricing, document-compare, summary-parser, communication-summary-errors) / 2 skipped`. Se subir de 10 falhas, investigar. Baseline documentado em [`QA_Automation_Report_Sprint_15E.md`](QA_Automation_Report_Sprint_15E.md).
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
   - `/pipeline/new` → selecionar Company "QA Test SA" (autocomplete deve mostrar), título "Deal QA #1", valor R$ 10.000, data prevista +30d → salvar.
     - **Passa se:** redireciona pra `/pipeline/<id>` com header "Deal QA #1" + badge "LEAD" + valor destacado.
4. **Avançar pelos 7 estágios**
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
5. **Cancelar opp** (fluxo alternativo — criar uma opp descartável pra isso).
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

Cobre 8 variações do fluxo completo: config webhook → 5 matchers do parser → blacklist → low confidence → rate limit → fila → alocação. Derivado de `src/server/services/inbound-parser.service.ts` (5 matchers: webhook JSON / Typeform / RD Station / HTML table / plain key:value) e `src/server/services/inbound-lead-creator.service.ts` (`MIN_CONFIDENCE=0.4`, 4 reasons: `parse_error`, `no_signal`, `blacklisted_domain`, `low_confidence`).

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

**Após 8 variações, testar alocação na fila:**

9. **Alocar vendedor**
   - `/inbox/prospects` → em qualquer card, botão "Alocar" → Popover Radix com vendedores ordenados por `activeOpps asc`.
   - Clicar num vendedor.
   - **Passa se:** toast success "Lead alocado." + card some da fila. Verificar SQL: `SELECT owner_id FROM opportunities WHERE id='<opp_id>';` → owner_id preenchido.

**Bloqueia release se:**
- V2/V3/V4 falham (parser regex quebrou — perde leads reais)
- V5 vaza PII em masking (crítico LGPD)
- V6 deixa passar blacklist (spam vira opp)
- V8 permite mais de 10 req/min (rate limit não bloqueia bot)

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

**Bloqueia release se:** guard anti-escalada quebra ou UI de permissions não carrega.

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
  Ver §2.4 passo 6 — 11ª request em 60s pro `/api/v1/inbound/lead` retorna 429.
  Já validado em §2.4 se rodou. Marcar aqui só como confirmação.

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

**Suite Vitest (`npm test`)** — 609 passing / 10 pré-existentes / 2 skipped.

**Suite Playwright (`npm run test:e2e`):**
- [`tests/e2e/axe-smoke.spec.ts`](../tests/e2e/axe-smoke.spec.ts) — a11y smoke (axe-core) em 5 rotas públicas + 4 autenticadas.
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
| `/api/v1/inbound/lead` | POST | 10 req/min por IP | `PUBLIC_FORM_LIMIT` (Sprint 11) | §2.4 passo 6 |
| `/api/v1/privacy-request` | POST | 10 req/min por IP | `PUBLIC_FORM_LIMIT` | Rate limit testado em `tests/unit/rate-limiter.test.ts` |
| `/api/v1/consent` | POST | 10 req/min por IP | `PUBLIC_FORM_LIMIT` | idem |
| `/api/v1/inbound/email` | POST | sem rate limit explícito (auth via secret) | webhook Postmark/Resend | validação de assinatura |
| `/p/[tenantSlug]/contact` | POST | 10 req/min por IP | `PUBLIC_FORM_LIMIT` | form público |
| `/sign-in` | POST via Clerk | 5 login/15min por IP | `LOGIN_LIMIT` | Clerk enforce + backup local |
| `/api/trpc/*` | POST | 1000 req/min por tenant | `API_LIMIT_PER_TENANT` | limits em `src/server/services/rate-limiter.service.ts` |

Origem: `src/server/services/rate-limiter.service.ts` (constants `LOGIN_LIMIT`, `PUBLIC_FORM_LIMIT`, `API_LIMIT_PER_TENANT`).

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
