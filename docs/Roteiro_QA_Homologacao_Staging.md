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

**Roteiro detalhado das 8 variações do Card /admin/ai e das 6 variações do drilldown foi preparado pelo PO em conversa de 2026-06-30/2026-07-01** (task #22 e #23 do HANDOFF). Fred cola aqui quando abrir sessão de teste.

<!-- PLACEHOLDER: cole aqui as 8 variações /admin/ai (P-23 + refino) preparadas em conversa. -->
<!-- PLACEHOLDER: cole aqui as 6 variações /platform/tenants/[id]/ai (P-06) preparadas em conversa. -->

Enquanto placeholders não estão preenchidos, rodar o smoke abaixo:

#### 2.3.a. /admin/ai smoke (5min)

1. `/admin/ai` → tela abre com 4 cards.
   - **Passa se:** Card A "Configuração padrão", Card B "Features de IA" agrupado por categoria, Card C "Uso e custo do mês" com breakdown, Card D "Alertas" (vazio ou com alertas).
2. Card A → botão "Testar chave" com chave Anthropic válida cadastrada.
   - **Passa se:** retorna `{ok: true, latencyMs: <número>}` sem echar a chave em resposta nem em Network tab.
   - **Falha (crítico segurança):** se resposta ou Network mostrar valor real da chave.
3. Card B → clicar em qualquer linha de feature → modal "Editar feature" abre.
   - **Passa se:** modal tem 3 inputs primary (provider/model/key) + 3 fallback + input `costAlertBrlMonthly`.
4. Card D → se aparecer alerta `CIRCUIT_OPEN`, clicar "Limpar circuit".
   - **Passa se:** AlertDialog do design system aparece (não `confirm()` nativo).

#### 2.3.b. Drilldown por tenant (5min — só Platform Owner)

1. `/platform/tenants` → clicar num tenant → header ganhou botões "IA" e "Features IA".
2. Botão "IA" → `/platform/tenants/[id]/ai` abre com 5 seções (métricas, breakdown, histórico 30d, modelos pinados, anomalias).
   - **Passa se:** progress bar aparece com `aria-valuenow` correto quando `monthlyTokenLimit` configurado.
3. Anomalia aparecendo → clicar "Reconhecer".
   - **Passa se:** ack persiste (recarregar não traz de volta a mesma anomalia).
4. Botão "Features IA" → `/platform/tenants/[id]/ai/features` abre com features agrupadas por categoria.
   - **Passa se:** `<Select>` alternar DISABLED/INCLUDED/ADDON_ACTIVE dispara toast de sucesso.

#### 2.3.c. Consumo real (5min)

1. Voltar pra tenant marquezini como admin → abrir uma opp em `/pipeline/<id>`.
2. Seção "Registrar comunicação" → colar texto de reunião (>50 chars) → "Resumir com IA".
   - **Passa se:** aparece preview com 4 blocos (resumo/próximos passos/objeções/tarefas sugeridas).
   - **Falha se:** mensagem "IA indisponível" enganosa aparece com chave configurada (bug P-15 regrediu — a mensagem deveria distinguir credit_balance / 401 / 429 / 5xx).

**Bloqueia release se:** chave IA vaza em resposta, drilldown não abre, ou consumo real falha silenciosamente sem mensagem estruturada.

### 2.4. Inbound Marketing end-to-end (~25min — Sprint 15D)

**Roteiro detalhado das 8 variações Sprint 15D preparado pelo PO em conversa de 2026-06-30/2026-07-01**. Fred cola aqui.

<!-- PLACEHOLDER: cole aqui as 8 variações Inbound (Sprint 15D) preparadas em conversa. -->

Enquanto placeholder não é preenchido, rodar smoke abaixo:

1. **Configurar webhook**
   - `/admin/email-inbound` → tab "Forms de captura".
   - Copiar URL do webhook + secret.
   - **Passa se:** botão "Regenerar secret" abre `AlertDialog` do design system.
2. **Disparar webhook curl (staging URL)**
   ```bash
   curl -X POST "https://crm-app-pi-eight.vercel.app/api/v1/inbound/lead?secret=<SECRET>" \
     -H 'content-type: application/json' \
     -d '{"name":"Lead Teste","email":"lead+teste@venzo.com","company":"Empresa Teste","message":"Interesse em X"}'
   ```
   - **Passa se:** retorna `202 {"status":"queued"}`.
   - **Falha se:** 401 (secret errado), 403 (webhook desativado), 429 (rate limit — aguarda 60s), 500.
3. **Aguardar worker processar (~5s)**
   - Railway Logs devem mostrar `[inbound-lead-create] job <id> concluído`.
   - **Falha se:** log não aparece em 30s. Provável causa: worker morto (§1.2 regrediu) ou P-36 voltou.
4. **Verificar fila /inbox/prospects** (como admin ou role com `inbound:view_queue`)
   - **Passa se:** card aparece com badge de source, confidence %, empresa "Empresa Teste".
5. **Alocar vendedor**
   - Botão "Alocar" → popover com vendedores ordenados por carga (asc).
   - Escolher vendedor.
   - **Passa se:** card some da fila + toast "Vendedor alocado."
6. **Rate limit** (opcional, mas recomendado)
   - Disparar 11 requests em <60s pro endpoint acima com IP fixo.
   - **Passa se:** 11ª request retorna 429 (rate limit `PUBLIC_FORM_LIMIT`).

**Bloqueia release se:** webhook público quebrou (segurança — cliente perde leads) ou fila não popula (P-36 regrediu).

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

**Roteiro das 9 variações preparado pelo PO em conversa de 2026-06-30/2026-07-01**.

<!-- PLACEHOLDER: cole aqui as 9 variações Command Palette (P-16) preparadas em conversa. -->

Smoke enquanto placeholder não preenchido:

1. Em qualquer rota autenticada, atalho `⌘K` (macOS) ou `Ctrl+K` (Linux/Win) abre o overlay.
   - **Passa se:** overlay aparece com input focado.
2. Digitar "qa" (≥2 chars) → resultados em 4 buckets (companies/contacts/opportunities/users), top 5 cada.
3. Setas ↑/↓ movem highlight; Enter navega.
   - **Passa se:** bucket "companies" com "QA Test SA" (criada em 2.2) → Enter navega pra `/companies/<id>`.
4. Debounce: digitar rápido não faz 1 request por keystroke.
   - **Passa se:** Network mostra 1 request após parar de digitar (~200ms).
5. ESC fecha.
6. Rota pública (ex: `/sign-in` em sessão nova) → atalho **não** abre palette.

**Bloqueia release se:** palette não abre em rota autenticada (regressão P-16).

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
