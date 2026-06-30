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

### P-04. Bug do audit log em outros sprints (não só theme.update)
**Severidade:** Alta. Memory `audit-trpc-context-loss.md` documenta:
o fix de `93ca6df` corrigiu `audit.service` pra usar `runAsSystem`
sempre, **mas** o caminho A (sem `tenantIdOverride`) ainda é
silencioso em vários callers.

Callers que ainda dependem de AsyncLocalStorage perfeito:
- `src/server/trpc/routers/companies.ts` (3 ocorrências)
- `src/server/trpc/routers/contracts.ts` (4 ocorrências)
- `src/server/trpc/routers/proposals.ts` (3 ocorrências)
- `src/server/trpc/routers/approval-rules.ts` (5 ocorrências)
- `src/server/trpc/routers/partners.ts` (provável)
- `src/server/trpc/routers/documents.ts` (provável)
- `src/server/trpc/routers/imports.ts` (provável)

**Fix:** passar `tenantIdOverride: ctx.tenantId` em cada `audit({...})`
desses arquivos.

**Esforço:** ~2h (grep + sed mecânico + spot check). **Status:** débito
aberto; não verificado se Sprint 15A/15B passaram nesses arquivos
com fix incidental.

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
