# Deploy Vercel — CRM Venzo (Staging)

> **Objetivo:** subir o CRM em um domínio Vercel público (ex:
> `crm-app-abc.vercel.app`) pra Fred mandar pra PO/testers em ~20min de
> trabalho ativo. Este guia é o único caminho suportado hoje.
>
> **Stack alvo:** Vercel (Next.js) + Neon branch dedicado + Upstash Redis
> + Clerk (mesma instance de dev) + Anthropic (mesma chave). Sem Docker,
> sem servidor próprio.

---

## Custo estimado

| Serviço | Plano | Custo/mês |
|---------|-------|-----------|
| Vercel | Hobby | R$ 0 (100GB bandwidth, 100h build) |
| Neon | Free tier (branch) | R$ 0 (3GB, autoscale) |
| Upstash Redis | Free tier | R$ 0 (10k commands/dia) |
| Clerk | Dev instance | R$ 0 (10k MAU) |
| Anthropic | Pay-per-token | ~R$ 5–30 (uso staging) |
| Resend | Free tier | R$ 0 (3k emails/mês) |

**Total esperado:** < R$ 50/mês em staging leve.

---

## Pré-requisitos (5 min)

- [ ] Conta Vercel criada em [vercel.com](https://vercel.com) (login com GitHub)
- [ ] Conta Neon (já existe — mesma do dev)
- [ ] Conta Upstash em [upstash.com](https://upstash.com) — recomendada (grátis)
- [ ] Acesso ao Clerk dashboard (já existe — `guiding-bobcat-23.clerk.accounts.dev`)
- [ ] Domínio de e-mail verificado no Resend (opcional, mas alertas ficam mudos sem ele)
- [ ] `vercel` CLI instalada: `npm i -g vercel`

---

## Etapa 1 — Criar branch de banco no Neon (10 min)

**Por quê?** Isolar dados do staging dos dados do dev. Assim os testers
podem quebrar o banco à vontade sem afetar seu ambiente local.

1. Abrir [dashboard.neon.tech](https://dashboard.neon.tech) → selecionar
   o project atual (mesmo do CRM dev).
2. Sidebar → **Branches** → botão **New branch**.
3. Nome: `staging`. Source: `main` (ou o branch atual). Confirmar.
4. Neon copia o schema e os dados em segundos. Abrir a branch nova.
5. Aba **Connection Details**:
   - Selecionar **Pooled connection** (crítico pra serverless).
   - Copiar a connection string. Termina em algo como:
     `?sslmode=require`.
6. Salvar essa string em local seguro. Chamaremos de `DATABASE_URL_STAGING`.

---

## Etapa 2 — Aplicar migrations no Neon branch (2 min)

Do diretório do projeto local:

```bash
# 1) Rodar TODAS as migrations (0001 → 0030 inclui Sprint 15E RBAC granular)
DATABASE_URL="<staging-connection-string>" npx prisma migrate deploy

# 2) OBRIGATÓRIO pós-migration 0030: popular cache de permissions
DATABASE_URL="<staging-connection-string>" npm run rbac:backfill-cache

# 3) OPCIONAL: seed com 3 tenants + massa de teste PT-BR
DATABASE_URL="<staging-connection-string>" npm run db:seed
```

**Sanity check:** conectar no Neon Studio ou via `psql` e rodar:

```sql
SELECT count(*) FROM tenants;
SELECT count(*) FROM user_permission_overrides;
SELECT count(*) FROM users WHERE cached_permissions IS NOT NULL;
```

Última query deve retornar ≥ 1. Se retornar 0, o `rbac:backfill-cache`
não rodou.

⚠️ **Sequência canônica das migrations aplicadas nesta ordem:**
`0001_init` → `0002_rls` → `0003_vector_indexes` → `0004_sprint1_additions`
→ ... → `0030_rbac_granular`. Sem gaps (o pulo aparente entre `0015` e
`0016` na listagem `ls` é só ordem alfabética — verificado que todos os
sprints têm sua migration). Prisma aplica em ordem lexicográfica.

---

## Etapa 3 — Criar Upstash Redis (opcional, 3 min)

Sem Redis, workers BullMQ não rodam (alertas, imports, email-send).
Aplicação sobe, mas features assíncronas ficam desativadas.

1. [upstash.com](https://upstash.com) → **Create Database**.
2. Region: `us-east-1` (mesma do Neon) ou `sa-east-1` (São Paulo, mais
   perto do Vercel `gru1`, mas free tier tem menos opções).
3. Tipo: **Regional** (grátis, suficiente pra staging).
4. Copiar da aba **Details**:
   - **Endpoint** + **Port** + **Password** → montar:
     `rediss://default:<PASSWORD>@<ENDPOINT>:<PORT>`
   - **NÃO** usar o formato REST (`https://...`) — o app usa TCP via `ioredis`.
5. Salvar como `REDIS_URL`.

---

## Etapa 4 — Deploy inicial no Vercel (5 min)

Do diretório do projeto:

```bash
# 1) Uma vez: login (abre browser)
vercel login

# 2) Link do projeto local com um novo Vercel project
vercel link
# Prompts:
#   Set up "~/Claude/crm-app"? Y
#   Which scope? (sua conta pessoal)
#   Link to existing project? N
#   Project name? crm-app (ou crm-venzo-staging)
#   In which directory? ./
#   Autodetect? Y (detecta Next.js)

# 3) Deploy inicial — SEM env vars ainda, vai falhar no boot; ok, só pra criar URL
vercel
# Escolha "y" pra deployar. Anote a URL final (crm-app-<hash>.vercel.app).
```

Se o deploy falhar em runtime com "Invalid environment variables", é
esperado — vamos configurar env vars agora.

---

## Etapa 5 — Configurar env vars (5 min)

Rodar o script auxiliar que imprime TODOS os `vercel env add` na ordem
correta:

```bash
bash scripts/setup-vercel-env.sh | less
```

Copiar bloco a bloco no terminal. Cada `vercel env add NOME production`
abre um prompt seguro pra colar o valor (não vai no histórico do shell).

**Ordem de prioridade** (o próprio script separa em blocos):

1. **BLOCO 1 (obrigatórias, 4 vars):** DATABASE_URL, CLERK_*, NEXT_PUBLIC_APP_URL.
   Sem estas, app não sobe.
2. **BLOCO 2 (recomendadas, 7 vars):** Redis, Anthropic, Resend,
   encryption key, webhook secret.
3. **BLOCO 3 (feature flags, 4 vars):** MULTI_AI_ENABLED,
   RBAC_GRANULAR_ENABLED, USD_BRL_RATE, AI_PLATFORM_MARGIN.
4. **BLOCO 4 (opcionais):** S3, VAPID, Stripe, Perplexity, observabilidade.
5. **BLOCO 5 (preview envs):** replicar pra branches.

### Valores críticos a substituir do `.env.local`

O script NÃO lê `.env.local` automaticamente pra evitar vazamento. Você
substitui manualmente:

- `DATABASE_URL` → **novo valor** (branch staging do Neon, NÃO o do dev)
- `TENANT_FIELD_ENCRYPTION_KEY` → **novo valor**
  (`openssl rand -base64 32` — não reusar o do dev, chaves criptografadas
  ficam isoladas por ambiente)
- `INBOUND_WEBHOOK_SECRET` → **novo valor** (`openssl rand -hex 24`)
- `NEXT_PUBLIC_APP_URL` → **URL real do Vercel** (você só sabe depois do
  1º deploy)
- `RESEND_FROM` → domínio verificado (se não tiver, deixe fora do bloco 2)

Todo o resto (Clerk keys, Anthropic key, OpenAI key) pode vir do `.env.local`.

### Após colar todas as vars:

```bash
# Redeploy pra pegar as vars novas
vercel --prod
```

---

## Etapa 6 — Reconfigurar Clerk (3 min)

O Clerk dev instance funciona pra staging, mas precisa saber o novo domínio:

1. [dashboard.clerk.com](https://dashboard.clerk.com) → sua app dev.
2. **Configure → Domains** → **Add domain**:
   - `crm-app-<hash>.vercel.app` (a URL do Vercel).
   - Salvar. Sem isto, sign-in dá erro de origin.
3. **Configure → Webhooks** → editar o endpoint existente (ou criar novo):
   - URL: `https://crm-app-<hash>.vercel.app/api/clerk/webhook`
   - Events: `user.created`, `user.updated`, `user.deleted`, `session.created`
   - Copiar o **Signing secret** e atualizar `CLERK_WEBHOOK_SECRET`
     no Vercel se ainda não estiver setado.
4. **Configure → Sessions → Customize session token** — verificar que
   o JWT template inclui:
   ```json
   {
     "public": {
       "tenantId": "{{user.public_metadata.tenantId}}",
       "role": "{{user.public_metadata.role}}",
       "platformRole": "{{user.public_metadata.platformRole}}"
     }
   }
   ```
   (Se você é Platform Owner, `platformRole` já deve estar configurado
   do Sprint 15A.)

---

## Etapa 7 — Smoke test (5 min)

Abrir `https://crm-app-<hash>.vercel.app` num browser anônimo:

- [ ] Redireciona pra `/sign-in`
- [ ] Login com email existente (ou criar user novo via Clerk) funciona
- [ ] `/dashboard` carrega sem erro no console
- [ ] `/admin/ai` (Sprint 15F) abre; configurar chave Anthropic + testar
- [ ] `/pipeline/new` cria oportunidade (COMPANY existente ou nova via QuickCreate)
- [ ] `/admin/users` lista usuários
- [ ] `/inbox/prospects` abre (Sprint 15D)
- [ ] Verificar no Neon Studio que `audit_logs` teve INSERTs recentes
- [ ] Verificar no Vercel dashboard que Function Logs não tem erros vermelhos

Se algum passo falhar:
- **500 em `/api/trpc/...`** → Vercel dashboard → Deployments → Runtime
  Logs → grep pelo erro. Geralmente env var faltando.
- **"Invalid environment variables"** → alguma var obrigatória do Zod
  não foi setada. Ver `src/lib/env.ts`.
- **Sign-in erro CORS/origin** → Clerk domain não incluído.
- **Webhook 401** → `CLERK_WEBHOOK_SECRET` errado.

---

## Ativação incremental de flags

Após smoke test passar com `RBAC_GRANULAR_ENABLED=false`:

```bash
# 1) Confirmar backfill rodou (Etapa 2 passo 2)
DATABASE_URL="<staging>" node -e "console.log('rodar SELECT em users.cached_permissions')"

# 2) Ligar flag
vercel env rm RBAC_GRANULAR_ENABLED production
vercel env add RBAC_GRANULAR_ENABLED production
# valor: true

# 3) Redeploy
vercel --prod

# 4) Testar /admin/users/<id>/permissions
```

---

## Rollback rápido

Cenário: staging quebrou no meio do teste.

**Opção 1 — desligar flag problemática:**
```bash
vercel env rm RBAC_GRANULAR_ENABLED production
vercel env add RBAC_GRANULAR_ENABLED production
# valor: false
vercel --prod
```

**Opção 2 — reverter pra deploy anterior:**
Vercel dashboard → Deployments → clicar num deploy anterior verde → menu
"...", "Promote to Production".

**Opção 3 — remover projeto inteiro:**
```bash
vercel remove crm-app-<hash>
```
(Neon branch e Upstash ficam. Recriar deploy é rápido.)

---

## Manutenção contínua

**Cada push em `main`:**
- Vercel auto-deploya (default).
- ⚠️ Migrations NÃO rodam automaticamente. Se o push inclui uma migration
  nova, rodar manualmente contra o Neon staging antes do deploy propagar:
  ```bash
  DATABASE_URL="<staging>" npx prisma migrate deploy
  ```
  Depois: `vercel --prod` OU push num commit vazio pra forçar redeploy.

**Env vars mudaram:**
```bash
vercel env pull .env.staging   # baixa cópia local (não commitar)
# editar manualmente ou:
vercel env rm NOME production
vercel env add NOME production
vercel --prod
```

**Escalar plano quando testers reclamarem de lentidão:**
- Vercel Pro (US$ 20/mês) desbloqueia function duration 60s → 300s,
  bandwidth 1TB.
- Neon Launch (US$ 19/mês) tira o hard cap de 3GB.
- Upstash Pay-as-you-go tira o limite de 10k comandos/dia.

---

## Cache de referência — o que ficou fora deste guia

- **Cron jobs BullMQ:** `alerts-scan` diário 07:00 BRT é o único
  registrado. Vercel Cron poderia disparar via endpoint, mas requer
  Redis persistente + adaptação de código pra rodar como HTTP handler.
  Fora de escopo pra staging inicial. Se ficar crítico: promover
  Upstash pro plano pago + adicionar entrada em `vercel.json > crons`
  apontando pra endpoint que enfileira o job.
- **S3 real:** staging aguenta uma semana sem uploads persistentes
  (fallback `/tmp` na verdade **não persiste** entre invocations do
  serverless — arquivo some após ~1 min). Configurar R2 (grátis 10GB)
  quando tester pedir pra testar upload de PDF/contrato.
- **Domínio custom (staging.crm.venzo.com.br):** Vercel dashboard →
  Domains → adicionar. Precisa apontar CNAME `cname.vercel-dns.com`.
- **Preview deployments por PR:** replicar env vars com escopo `preview`
  (script tem bloco 5 explicando). Recomendo criar 2º Neon branch
  chamado `preview` pra isolar de staging.
