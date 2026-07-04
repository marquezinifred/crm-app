# Deploy — Workers BullMQ no Railway (P-36)

> **Objetivo:** subir os workers BullMQ (`src/jobs/index.ts`) em um
> processo 24/7 dedicado, consumindo as mesmas queues Redis já usadas
> pela Vercel. Fecha o débito P-36 — hoje as queues acumulam sem
> consumidor.
>
> **Stack alvo:** Railway (Docker) + Redis Upstash (reusar do Vercel)
> + Neon staging (mesma DATABASE_URL do Vercel).

---

## Custo estimado

| Serviço | Plano | Custo/mês |
|---------|-------|-----------|
| Railway | Hobby (512MB RAM 24/7) | ~R$ 40–50 |
| Redis Upstash | Free (já ativo pra Vercel) | R$ 0 |
| Neon staging | Free branch (já ativo) | R$ 0 |

**Total incremental:** ~R$ 50/mês. Railway dá $5 grátis/mês; o worker
consome ~$8–10.

---

## Pré-requisitos

- [ ] Vercel staging já no ar com Redis Upstash + Neon branch `staging`
  (veja `docs/DEPLOY_Vercel_Guide.md`)
- [ ] Conta Railway em [railway.app](https://railway.app) (login GitHub)
- [ ] `railway` CLI (opcional): `npm i -g @railway/cli`

---

## Etapa 1 — Criar projeto Railway (5 min)

1. [railway.app/new](https://railway.app/new) → **Deploy from GitHub repo**
2. Autorizar acesso ao repo `marquezinifred/crm-app` (ou fork)
3. Selecionar o repo → branch `main`
4. Railway detecta `railway.json` na raiz e escolhe automaticamente
   `Dockerfile.worker` como builder
5. Root directory: `/`

Se não detectar automaticamente:
- **Settings → Deploy → Custom Build Command**
- **Dockerfile path:** `Dockerfile.worker`

---

## Etapa 2 — Configurar env vars (10 min)

**⚠️ Regra crítica:** as env vars precisam ser as **mesmas do Vercel
staging** — especialmente `TENANT_FIELD_ENCRYPTION_KEY`. Se divergir,
o worker não decripta as API keys de IA por-tenant e os jobs de
`inbound-lead-create` / `email-send` quebram.

Copiar do Vercel (Settings → Environment Variables → Production) e
colar em Railway (Variables tab):

### Obrigatórias
| Var | Origem | Observação |
|---|---|---|
| `DATABASE_URL` | Neon staging (pooled) | Mesma do Vercel |
| `REDIS_URL` | Upstash Redis TCP endpoint | ⚠️ URL TCP `rediss://...` — não é a REST URL |
| `TENANT_FIELD_ENCRYPTION_KEY` | Vercel | ≥ 32 chars, MESMA do Vercel |
| `CLERK_SECRET_KEY` | Vercel | Worker consulta users (access log) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Vercel | Env schema exige |
| `NODE_ENV` | — | `production` |

### Recomendadas
| Var | Origem | Impacto se faltar |
|---|---|---|
| `ANTHROPIC_API_KEY` | Vercel | `inbound-lead-parser` cai pro tenant-key; se tenant também não tiver, jobs falham |
| `OPENAI_API_KEY` | Vercel | `semantic-search` cai pro tsvector (sem embeddings) |
| `RESEND_API_KEY` | Vercel | `email-send` fica em dry-run — nada é enviado |
| `RESEND_FROM` | Vercel | Sender pattern (`noreply@dominio`) |
| `NEXT_PUBLIC_APP_URL` | Vercel | URL nos links dos e-mails |
| `USD_BRL_RATE` | Vercel | Rollup de custo IA em BRL |
| `AI_PLATFORM_MARGIN` | Vercel | Margem aplicada pelo rollup |
| `MULTI_AI_ENABLED` | Vercel | `true` — casa com Vercel; senão path legado |
| `RBAC_GRANULAR_ENABLED` | Vercel | Deve casar com Vercel (padrão hoje `false`) |

### Sobre o Upstash `REDIS_URL`

Upstash entrega **duas URLs** no dashboard:
- **REST endpoint** (`UPSTASH_REDIS_REST_URL`) — HTTP, usado pelo edge
  runtime da Vercel
- **TCP endpoint** (`REDIS_URL` estilo `rediss://default:...@host:port`)
  — **é o que o worker usa** (BullMQ requer TCP + ioredis)

Se o dashboard não mostrar TCP, ir em **Details → Connect → Node.js /
BullMQ / ioredis** — a string `rediss://` aparece lá.

---

## Etapa 3 — Deploy (5 min)

Push automático após conectar o GitHub. Acompanhar no **Deployments →
View Logs**.

Esperado (~2min de build + 20s pra bootar):

```
[deps] npm ci --ignore-scripts
[build] npx prisma generate
[runtime] tini + npx tsx src/jobs/index.ts
[workers] alerts-scan + email-send + import-run + ai-usage-rollup +
          health-score-rollup + inbound-lead-create rodando
[workers] crons: scan 07:00 BRT · ai-rollup 00:30 BRT ·
          health-rollup 02:00 BRT
```

Se a linha `[workers] ... rodando` não aparecer em ~1min:
- **`Invalid environment variables`** → env var faltando; `env.ts` mostra
  qual campo falhou
- **`ECONNREFUSED`** contra Redis → provavelmente REST URL em vez de TCP
- **`P1000`/`P1001`** do Prisma → `DATABASE_URL` errada ou IP não permitido

---

## Etapa 4 — Validação end-to-end

### Cenário 1: `inbound-lead-create` (mais visível)
1. Copiar webhook URL do form inbound em `/admin/email-inbound` na
   Vercel staging (tab **Forms de captura**)
2. `curl -X POST "$WEBHOOK_URL?secret=$SECRET" -H 'content-type: application/json' -d '{"name":"Teste","email":"teste@x.com","message":"Interesse em X"}'`
3. Aguardar ~5s
4. `/inbox/prospects` na Vercel — deve aparecer 1 card
5. Log Railway deve mostrar `[inbound-lead-create] job <id> concluído`

### Cenário 2: cron diário (paciência)
- `alerts-scan` roda 07:00 BRT — no dia seguinte, `AlertLog` do dia
  aparece populado
- `ai-usage-rollup` roda 00:30 BRT — `/platform/ai-ops` mostra dados
  agregados de ontem
- `health-score-rollup` roda 02:00 BRT — `/platform/health` atualiza
  os buckets RED/YELLOW/GREEN

### Cenário 3: import CSV
1. Em `/imports` na Vercel, subir um CSV pequeno
2. Após clicar **Confirmar**, aguardar ~10s
3. Job aparece com status DONE + e-mail de conclusão pro criador

---

## Rollback

Deployments → escolher versão anterior → **Redeploy**. 1-click,
sem downtime perceptível (Railway derruba a instância antiga só
depois da nova estar pronta).

---

## Manutenção

- **Auto-deploy on push:** Railway monitora `main` — cada push que
  altera arquivos observados dispara build. Configurar watch paths em
  **Settings → Deploy → Watch Paths**:
  - `src/jobs/**`
  - `src/server/services/**`
  - `src/lib/**`
  - `prisma/**`
  - `package.json`
  - `Dockerfile.worker`

  Assim commits em `src/app/**` (só UI) não rebuildam o worker.

- **Monitoramento:** hoje só logs Railway. Depois de P-35 (Sentry +
  Axiom), workers vão emitir eventos estruturados — integração via
  Axiom `next-monitor` reaproveita.

- **Se o worker cair repetido:** Deployments → Logs → ver stack. Comum:
  Redis TTL curto derrubando conexão (ajustar `bullConnection()` em
  `src/jobs/queues.ts` pra `maxRetriesPerRequest: null`).

- **Escalar horizontal:** BullMQ suporta N consumers na mesma queue.
  Railway → Settings → Replicas → aumentar. Cada réplica processa
  jobs distintos (concurrency 4 por réplica hoje).

---

## Migração futura (Sprint 16)

Decisão adiada: manter BullMQ+Railway ou migrar pra **Upstash QStash**
(queue serverless que dispara webhooks HTTP → funções Vercel).
Vantagem QStash: R$ 0 fixo, escala automática. Desvantagem: refactor
dos 6 workers pra API routes, perde parte da durabilidade nativa
BullMQ.

Ver P-36 em `docs/Backlog_Pos_MVP.md` pra contexto atualizado.
