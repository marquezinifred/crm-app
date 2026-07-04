# Observabilidade — Sentry + Axiom

Guia operacional. Foco: como configurar em staging/prod, como o
código instrumenta, e que alertas ligar.

Ver [`Backlog_Pos_MVP.md`](./Backlog_Pos_MVP.md) — P-35 tracked
esta implementação.

---

## Visão geral

| Camada         | Ferramenta | Papel                                          |
| -------------- | ---------- | ---------------------------------------------- |
| Error tracking | Sentry     | Exceções + performance de procedures tRPC      |
| Structured log | Axiom      | audit, ai_usage, worker_job, trpc(_error)      |
| Rotulagem      | Tags       | tenantId, userId, jobName, procedure, provider |

Ambos **fazem no-op silencioso** quando o env var correspondente não
está definido. Rodar `npm run dev` local sem tokens funciona igual.

---

## Setup — Sentry

### 1. Provisionar projeto

1. `sentry.io` → New Project → **Next.js**
2. Copiar o DSN.
3. Criar auth token em Settings → Auth Tokens com scope
   `project:releases` e `project:read`.

### 2. Variáveis de ambiente

```bash
# Runtime — o SDK só inicializa se DSN estiver presente
SENTRY_DSN=https://<hash>@o0.ingest.sentry.io/<projectId>
NEXT_PUBLIC_SENTRY_DSN=https://<hash>@o0.ingest.sentry.io/<projectId>
SENTRY_ENVIRONMENT=staging     # ou production

# Build — necessário só pra upload de sourcemap
SENTRY_ORG=venzo
SENTRY_PROJECT=crm-app
SENTRY_AUTH_TOKEN=<token>
```

Sem `SENTRY_AUTH_TOKEN` o build ainda funciona; só perde
symbolication (stack trace mostra código bundleado).

### 3. Vercel Integration (recomendado em prod)

`vercel.com/integrations/sentry` — a integração adiciona
automaticamente as 4 env vars de build (org/project/auth token) +
adiciona DSN. Continua sendo preciso setar `NEXT_PUBLIC_SENTRY_DSN`
manualmente (browser).

### 4. Verificar

```bash
# Local com DSN de teste
export SENTRY_DSN=<dsn-teste>
npm run dev
# Provocar erro proposital em qualquer route handler:
# throw new Error('sentry smoke test')
# Conferir em sentry.io/issues em ~30s.
```

---

## Setup — Axiom

### 1. Dataset + token

1. `app.axiom.co` → Datasets → New:
   - `venzo-crm-staging`
   - `venzo-crm-prod`
2. Settings → API tokens → New:
   - Name: `venzo-crm-staging-ingest`
   - Scopes: `ingest`
   - Dataset: `venzo-crm-staging`

### 2. Variáveis de ambiente

```bash
AXIOM_TOKEN=xaat-<hash>
AXIOM_DATASET=venzo-crm-staging
AXIOM_LOG_QUERIES=false        # true pra logar queries tRPC também
```

### 3. Verificar

```bash
export AXIOM_TOKEN=xaat-...
export AXIOM_DATASET=venzo-crm-staging
npm run dev
# Fazer uma mutation tRPC no app
# Em app.axiom.co/datasets/venzo-crm-staging, filtro:
#   category == "trpc" | limit 10
# Deve mostrar a mutation em segundos.
```

---

## O que está instrumentado

### Sentry (exceções + breadcrumbs)

| Local                                    | O que reporta                     |
| ---------------------------------------- | --------------------------------- |
| `src/lib/monitoring/sentry.ts`           | Helper wrappers (no-op sem DSN)   |
| `src/server/services/audit.service.ts`   | Breadcrumb sucesso, exception erro |
| `src/server/trpc/trpc.ts` (middleware)   | Exception em procedures INTERNAL  |
| `src/app/api/trpc/[trpc]/route.ts`       | Defense-in-depth em onError       |
| `src/jobs/queues.ts` (`makeWorker`)      | Exception em falha de job         |
| `src/lib/ai/dispatch.ts`                 | Breadcrumb por dispatchChat       |

Erros esperados **não** são reportados: `FORBIDDEN`, `UNAUTHORIZED`,
`PRECONDITION_FAILED`, `NOT_FOUND`, `TOO_MANY_REQUESTS`,
Clerk session expiry. Ver `shouldReportTrpcError` em
`src/lib/monitoring/sentry.ts:105`.

### Axiom (structured logs)

| Categoria    | Origem                                       | Payload                                           |
| ------------ | -------------------------------------------- | ------------------------------------------------- |
| `audit`      | `audit.service.ts`                           | action, tableName, recordId, tenantId, userId, ok |
| `ai_usage`   | `ai-usage.service.ts` → `logAiUsage`         | provider, model, tokens, costUsd, costBrl, fallback |
| `worker_job` | `jobs/queues.ts` → `makeWorker`              | jobName, jobId, tenantId, durationMs, ok, error   |
| `trpc`       | `trpc.ts` middleware `monitor` (sucesso)     | procedure, kind, tenantId, userId, durationMs    |
| `trpc_error` | `trpc.ts` middleware `monitor` (falha)       | + errorCode, errorMessage                         |

**Regra**: queries só são logadas quando falham — a menos que
`AXIOM_LOG_QUERIES=true`. Mutations + subscriptions sempre.

**Privacidade**: payloads de mutations **não** são incluídos. Só
metadados (nome procedure, tenant, duração). PII fica no DB, não em
observability.

---

## Alertas recomendados

### Sentry

| Alert                                   | Condição                                     | Onde                       |
| --------------------------------------- | -------------------------------------------- | -------------------------- |
| Issue novo com volume alto              | 10+ occurrences em 5min                      | Slack #incidents           |
| Regressão                               | Resolved issue reaberto                      | Email                      |
| Latência crítica                        | Transaction p95 > 3s                         | Slack #dev                 |
| First seen                              | Issue novo, qualquer volume                  | Email                      |

Setup: Sentry → Alerts → Create Rule.

### Axiom

Queries APL sugeridas:

```apl
// 1. Worker morto (não roda há 2h)
worker_job
| where _time > ago(2h)
| summarize count() by jobName
| where count_ < 1
```

```apl
// 2. Fallback rate alto (> 20%)
ai_usage
| where _time > ago(1h)
| summarize
    total = count(),
    fallback = countif(usedFallback == true)
  by requestType
| extend rate = todouble(fallback) / todouble(total)
| where rate > 0.20
```

```apl
// 3. Procedures tRPC lentas
trpc
| where _time > ago(15m)
| summarize p95 = percentile(durationMs, 95) by procedure
| where p95 > 2000
| top 20 by p95 desc
```

```apl
// 4. Custo IA por tenant/dia
ai_usage
| where _time > ago(24h)
| summarize costBrl = sum(costBrl) by tenantId
| top 20 by costBrl desc
```

```apl
// 5. Erros tRPC recentes por tenant
trpc_error
| where _time > ago(1h)
| summarize count() by tenantId, errorCode
| where count_ > 5
```

Setup: Axiom → Monitors → New → APL query → threshold → Slack/PagerDuty webhook.

---

## Runbook — recebi alerta X

### `Issue novo com 10+ occurrences` (Sentry)

1. Abrir Sentry issue → verificar stack trace + breadcrumbs.
2. Tag `procedure` diz qual endpoint tRPC quebrou.
3. Tag `tenantId` isola se é um cliente específico.
4. Rodar `git log --since='1 day ago'` — regressão recente?
5. Se crítico e recente: rollback via `vercel rollback`.

### `Fallback rate > 20%` (Axiom)

1. `ai_usage | where _time > ago(6h) | summarize count() by configuredProvider, provider`
   — mostra qual provider primary está caindo.
2. Checar Anthropic status page.
3. `/admin/ai` no tenant afetado — key expirada? saldo?
4. Circuit breaker em `src/lib/ai/breakers.ts` — resetar via
   `/admin/ai` Card D → "Reconhecer" quando confirmado.

### `Worker parou` (Axiom)

1. Vercel logs / Railway logs do worker process.
2. Se worker crashado, restartar. `npm run worker` local pra testar.
3. Se Redis morto: verificar Upstash console.
4. Ver P-36 (Backlog) — workers em Vercel serverless são débito
   arquitetural conhecido.

---

## Não vazar PII

**Regra**: nenhum payload de mutation, nenhum texto de resumo IA,
nenhum email/CNPJ/telefone em Sentry ou Axiom.

Instrumentação atual respeita isso:

- `audit`: só grava tableName + recordId (o `before`/`after` fica no
  DB, não vai pro Axiom).
- `ai_usage`: números e nomes de modelo — nunca o prompt.
- `trpc`: procedure name + duração — nunca o input do zod schema.
- `worker_job`: jobName + tenantId — nunca o payload do job.

Ver `DataMaskingService` em `src/lib/ai/masking.ts` — mesma política:
PII nunca sai do processo sem máscara. Sentry.init tem
`sendDefaultPii: false`.

---

## Custo — quanto observability adiciona

- Sentry: plano free 5k errors/mês. Sample tracing 10% e replay só em
  erro. Estimativa staging <100 err/mês.
- Axiom: plano free 500 GB ingest/mês. Uma mutation tRPC ~250 bytes.
  Volume MVP ~50k eventos/mês = <15 MB.

Ambos escalam pra cima gradual sem grandes surpresas.

---

## Referências no código

- `src/lib/monitoring/sentry.ts` — wrappers
- `src/lib/monitoring/axiom.ts` — logger
- `sentry.client.config.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts`
- `instrumentation.ts` — Next.js hook
- `next.config.mjs` — `withSentryConfig`
- `tests/unit/monitoring-sentry.test.ts`
- `tests/unit/monitoring-axiom.test.ts`
