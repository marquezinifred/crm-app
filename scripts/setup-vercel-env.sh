#!/usr/bin/env bash
# =============================================================================
# scripts/setup-vercel-env.sh
#
# Uso: bash scripts/setup-vercel-env.sh
#
# Este script NÃO EXECUTA nada — ele apenas IMPRIME os comandos `vercel env add`
# que você deve rodar/copiar no terminal, na ordem correta.
#
# Antes de colar cada bloco, substitua manualmente os valores marcados com
# [SUBSTITUIR:...] — nunca cole a versão local no ambiente de staging sem
# checar. As chaves que vêm do .env.local devem ser copiadas manualmente
# pelo terminal (o script não lê o arquivo pra evitar vazamento acidental).
#
# Rodar `vercel env add <NOME> production` abre um prompt seguro pra colar
# o valor sem que ele apareça no histórico do shell.
# =============================================================================

set -euo pipefail

BAR="============================================================"
DIV="------------------------------------------------------------"

cat <<'HEADER'

╔══════════════════════════════════════════════════════════════════╗
║  VERCEL ENV SETUP — CRM Venzo Staging                           ║
║                                                                  ║
║  Este script imprime a lista completa de env vars a configurar. ║
║  Rode os comandos abaixo no terminal, um por vez.               ║
║                                                                  ║
║  ⚠️  Antes de começar:                                          ║
║    1) `vercel login` (uma vez)                                   ║
║    2) `vercel link` no diretório do projeto (uma vez)            ║
║    3) Ter à mão: DATABASE_URL do Neon branch de STAGING          ║
║       (NÃO usar o mesmo do dev local)                            ║
║    4) Ter à mão: chaves Clerk (dev instance funciona pra staging)║
║    5) Chaves Anthropic/OpenAI podem ser as mesmas do dev         ║
╚══════════════════════════════════════════════════════════════════╝

HEADER

# =============================================================================
# BLOCO 1 — OBRIGATÓRIAS (sem estas, boot falha via Zod em src/lib/env.ts)
# =============================================================================
echo ""
echo "$BAR"
echo "  BLOCO 1: OBRIGATÓRIAS — sem elas o app não sobe"
echo "$BAR"
echo ""

cat <<'REQUIRED'
# ---------------------------------------------------------------------------
# DATABASE_URL — Neon branch de STAGING (NÃO reusar o do .env.local)
# Criar: dashboard.neon.tech > Project > Branches > New branch
# Copiar a "Pooler connection string" (termina em ?sslmode=require&pgbouncer=true)
# ---------------------------------------------------------------------------
vercel env add DATABASE_URL production
# valor: postgresql://<user>:<pass>@<host>.neon.tech/<db>?sslmode=require

# ---------------------------------------------------------------------------
# NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY — mesmo do .env.local (dev instance ok)
# Copiar de dashboard.clerk.com > API Keys > Publishable key
# ---------------------------------------------------------------------------
vercel env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY production
# valor: pk_test_...

# ---------------------------------------------------------------------------
# CLERK_SECRET_KEY — mesmo do .env.local (dev instance ok)
# Copiar de dashboard.clerk.com > API Keys > Secret key
# ---------------------------------------------------------------------------
vercel env add CLERK_SECRET_KEY production
# valor: sk_test_...

# ---------------------------------------------------------------------------
# NEXT_PUBLIC_APP_URL — URL final do Vercel deploy (usada em callbacks)
# Depois do 1º deploy, você saberá; se ainda não, use placeholder e ajuste
# ---------------------------------------------------------------------------
vercel env add NEXT_PUBLIC_APP_URL production
# valor: https://crm-app-<hash>.vercel.app
REQUIRED

# =============================================================================
# BLOCO 2 — RECOMENDADAS (features ativas do CRM param sem elas)
# =============================================================================
echo ""
echo "$BAR"
echo "  BLOCO 2: RECOMENDADAS — features param sem elas, mas app sobe"
echo "$BAR"
echo ""

cat <<'RECOMMENDED'
# ---------------------------------------------------------------------------
# CLERK_WEBHOOK_SECRET — pra sincronização de users (roles, deletes)
# Criar em: dashboard.clerk.com > Webhooks > Add endpoint
# Endpoint: https://<seu-vercel>.vercel.app/api/clerk/webhook
# Events: user.created, user.updated, user.deleted, session.created
# ---------------------------------------------------------------------------
vercel env add CLERK_WEBHOOK_SECRET production
# valor: whsec_...

# ---------------------------------------------------------------------------
# REDIS_URL — Upstash Redis REST URL (schema aceita rediss://)
# Criar: upstash.com > Redis > Create database (region us-east-1)
# Copiar: "Redis URL" no formato rediss://default:<pass>@<host>:<port>
# ---------------------------------------------------------------------------
vercel env add REDIS_URL production
# valor: rediss://default:<token>@<endpoint>.upstash.io:6379

# ---------------------------------------------------------------------------
# ANTHROPIC_API_KEY — copiar do .env.local (Sprint 15F multi-provider)
# Consumo pago; considere criar chave separada de staging pra isolar limite
# ---------------------------------------------------------------------------
vercel env add ANTHROPIC_API_KEY production
# valor: sk-ant-...

# ---------------------------------------------------------------------------
# TENANT_FIELD_ENCRYPTION_KEY — encriptação AES-256-GCM de ai_api_key
# Gerar novo pra staging: openssl rand -base64 32
# ⚠️ NÃO reusar o do .env.local — chaves criptografadas ficam isoladas por env
# ---------------------------------------------------------------------------
vercel env add TENANT_FIELD_ENCRYPTION_KEY production
# valor: <output de: openssl rand -base64 32>

# ---------------------------------------------------------------------------
# RESEND_API_KEY — envio de alertas + magic link
# Sem: alertas ficam em dry-run (log-only), UX degrada
# ---------------------------------------------------------------------------
vercel env add RESEND_API_KEY production
# valor: re_...

# ---------------------------------------------------------------------------
# RESEND_FROM — endereço de envio (precisa domínio verificado no Resend)
# ---------------------------------------------------------------------------
vercel env add RESEND_FROM production
# valor: crm-staging@seudominio.com.br

# ---------------------------------------------------------------------------
# INBOUND_WEBHOOK_SECRET — protege POST /api/v1/inbound/lead + /email
# Gerar: openssl rand -hex 24
# ---------------------------------------------------------------------------
vercel env add INBOUND_WEBHOOK_SECRET production
# valor: <hex-random>
RECOMMENDED

# =============================================================================
# BLOCO 3 — FEATURE FLAGS (controlam comportamento sem afetar boot)
# =============================================================================
echo ""
echo "$BAR"
echo "  BLOCO 3: FEATURE FLAGS — controle de rollout de sprints"
echo "$BAR"
echo ""

cat <<'FLAGS'
# ---------------------------------------------------------------------------
# MULTI_AI_ENABLED — Sprint 15F multi-provider por feature + fallback
# Default false = path legado. Setar true pra usar a nova stack completa.
# ---------------------------------------------------------------------------
vercel env add MULTI_AI_ENABLED production
# valor: true

# ---------------------------------------------------------------------------
# RBAC_GRANULAR_ENABLED — Sprint 15E permissions individuais
# ⚠️ Antes de setar true: `npm run rbac:backfill-cache` contra o Neon staging
# Default false até backfill completo. Deixe false no 1º deploy.
# ---------------------------------------------------------------------------
vercel env add RBAC_GRANULAR_ENABLED production
# valor: false

# ---------------------------------------------------------------------------
# USD_BRL_RATE — câmbio de billing IA (default 5.1, ajustar se cotação mover)
# ---------------------------------------------------------------------------
vercel env add USD_BRL_RATE production
# valor: 5.5

# ---------------------------------------------------------------------------
# AI_PLATFORM_MARGIN — margem sobre custo bruto de IA (0.20 = +20%)
# ---------------------------------------------------------------------------
vercel env add AI_PLATFORM_MARGIN production
# valor: 0.20
FLAGS

# =============================================================================
# BLOCO 4 — OPCIONAIS (só configure se for usar a feature)
# =============================================================================
echo ""
echo "$BAR"
echo "  BLOCO 4: OPCIONAIS — pule se não for usar a feature"
echo "$BAR"
echo ""

cat <<'OPTIONAL'
# ---------------------------------------------------------------------------
# OPENAI_API_KEY — embeddings pra busca semântica
# Sem: cai pra Postgres tsvector (funcional em PT-BR, só sem sinônimos)
# ---------------------------------------------------------------------------
vercel env add OPENAI_API_KEY production
# valor: sk-...

# ---------------------------------------------------------------------------
# S3 — uploads de propostas/contratos/documentos
# ⚠️ CRÍTICO pra staging real: sem S3, uploads em /tmp somem entre invocations
# do Vercel serverless. Use Cloudflare R2 (grátis 10GB) ou S3 real.
# ---------------------------------------------------------------------------
vercel env add S3_ENDPOINT production
# valor: https://<account>.r2.cloudflarestorage.com

vercel env add S3_BUCKET production
# valor: crm-staging-documents

vercel env add S3_REGION production
# valor: auto

vercel env add S3_ACCESS_KEY_ID production
# valor: <access-key>

vercel env add S3_SECRET_ACCESS_KEY production
# valor: <secret>

# ---------------------------------------------------------------------------
# VAPID — Web Push notifications (Sprint 10)
# Gerar: npx web-push generate-vapid-keys
# Sem: botão "Ativar push" fica escondido (degradação silenciosa)
# ---------------------------------------------------------------------------
vercel env add NEXT_PUBLIC_VAPID_PUBLIC_KEY production
# valor: B<base64>

vercel env add VAPID_PRIVATE_KEY production
# valor: <base64>

vercel env add VAPID_SUBJECT production
# valor: mailto:noreply@seudominio.com.br

# ---------------------------------------------------------------------------
# Stripe (Sprint 12 billing) — pule se ainda não for cobrar
# ---------------------------------------------------------------------------
vercel env add STRIPE_SECRET_KEY production
# valor: sk_test_...

vercel env add STRIPE_WEBHOOK_SECRET production
# valor: whsec_...

# ---------------------------------------------------------------------------
# Perplexity (benchmarks competitivos)
# ---------------------------------------------------------------------------
vercel env add PERPLEXITY_API_KEY production
# valor: pplx-...

# ---------------------------------------------------------------------------
# Observabilidade — Sentry + Axiom
# ---------------------------------------------------------------------------
vercel env add SENTRY_DSN production
# valor: https://<hash>@<org>.ingest.sentry.io/<project>

vercel env add AXIOM_TOKEN production
# valor: xaat-...

vercel env add AXIOM_DATASET production
# valor: crm-staging

# ---------------------------------------------------------------------------
# Manutenção — banner controlado por env (DEPRECADO em Sprint 15B, mas ainda
# honrado como fallback). Deixe vazio.
# ---------------------------------------------------------------------------
vercel env add NEXT_PUBLIC_MAINTENANCE_MESSAGE production
# valor: (vazio, só Enter)
OPTIONAL

# =============================================================================
# BLOCO 5 — Preview environment (opcional)
# =============================================================================
echo ""
echo "$BAR"
echo "  BLOCO 5: PREVIEW ENV — pra branches serem deployadas com config isolada"
echo "$BAR"
echo ""

cat <<'PREVIEW'
# Se quiser que cada branch tenha seu próprio deploy preview com env isolado,
# repita os comandos acima trocando `production` por `preview` OU use ambos:
#
#   vercel env add DATABASE_URL production preview
#
# ⚠️ Para PREVIEW ideal: criar OUTRO branch Neon separado (preview vs staging).
PREVIEW

echo ""
echo "$BAR"
echo "  PRÓXIMOS PASSOS APÓS COLAR AS VARS"
echo "$BAR"
echo ""
cat <<'NEXT'
1) `vercel --prod` — deploy inicial
2) Copiar URL final (ex: crm-app-abc.vercel.app) e atualizar:
   - vercel env rm NEXT_PUBLIC_APP_URL production
   - vercel env add NEXT_PUBLIC_APP_URL production (com URL real)
3) Redeploy: `vercel --prod`
4) dashboard.clerk.com > Domains > adicionar https://<url>.vercel.app
5) dashboard.clerk.com > Webhooks > atualizar endpoint pro Vercel
6) Rodar migrations e backfill contra o Neon staging (guia tem os comandos)
7) Smoke test — ver docs/DEPLOY_Vercel_Guide.md § Etapa 7
NEXT

echo ""
echo "$BAR"
echo "  FIM — copiar os blocos acima e colar no terminal"
echo "$BAR"
echo ""
