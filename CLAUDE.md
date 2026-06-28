# CRM Comercial — Instruções para Claude Code

## Sobre este projeto
Estou construindo um CRM B2B multi-tenant completo. A especificação funcional e o plano de implementação estão em `docs/CRM_Especificacao_e_Implementacao.docx`.

Leia esse documento antes de qualquer tarefa. Ele tem duas partes:
- **PARTE I** — O que construir (módulos, campos, regras de negócio, 19 seções)
- **PARTE II** — Como construir (arquitetura, sprints, testes, segurança, infraestrutura)

---

## Sprint atual

> **Sprint 7 — Parceiros e Documentos: ✅ CONCLUÍDO em 2026-06-27**
>
> Próximo: **Sprint 8 — Propostas, Aprovações e Contratos** (fluxo de
> aprovação configurável por margem/valor/universal, versionamento de
> propostas com comparador IA, gestão de contratos ativos com alertas
> de renovação, handoff automático para operações/financeiro).

---

## Débitos técnicos com dependência cruzada (registrados para sprints futuros)

| Origem | Pendência | Resolve em |
|--------|-----------|-----------|
| Sprint 2 | Validação `NEGOCIACAO → ACEITE` deveria exigir ≥ 1 `ProposalVersion` registrada na etapa de negociação | Sprint 8 (módulo Propostas/Aprovações) |
| Sprint 2 | E2E `pipeline-7-stages.spec.ts` está `test.skip` — depende de fixture Clerk + reset de banco entre testes em CI | Sprint 11 (Segurança + hardening de CI) |
| Sprint 1 | Webhook Clerk `session.created` registra IP/UA do edge Clerk, não do dispositivo final — middleware Next deve gravar em paralelo via `x-forwarded-for` | Sprint 11 |

Cada item acima é referenciado nos prompts do sprint que vai resolvê-lo. Verificar este quadro antes de iniciar Sprints 7, 8 e 11.

---

### Sprint 0 — Foundation (concluído)
- [x] Next.js 14 + TS strict + Tailwind + shadcn/ui
- [x] Schema Prisma 25+ entidades + pgvector + migrations init/RLS/vector
- [x] Prisma extension de tenant + AsyncLocalStorage
- [x] Middleware Clerk + tRPC base + DataMaskingService + RBAC + AuditLog
- [x] Docker, GitHub Actions CI, seed (3 tenants), .env.example

### Sprint 7 — Parceiros e Documentos (concluído)
- [x] Migration `0008_partners_documents`: `User.partnerCompanyId` (FK SET
      NULL), enum `DocumentCategory`, `Document.category`, tabela
      `document_templates` com RLS
- [x] **Débito Sprint 2 resolvido**: visibilidade real do perfil PARCEIRO
      em `opportunities` e `reports` (PARCEIRO vê apenas oportunidades onde
      `partnerCompanyId = User.partnerCompanyId` E existe `PartnerEngagement`
      com status APPROVED). Context tRPC agora carrega `partnerCompanyId`
- [x] **Débito Sprint 2 resolvido**: validação ACEITE → CONTRATO exige
      Document `category=ACEITE_CLIENTE` vinculado à oportunidade
- [x] Router `partners`: listWithStats (oportunidades + comissão acumulada),
      getTcText, updatePartnerConfig (commission, T&C text/versão),
      linkUserToPartner, registerTcAcceptance, publicTcView/publicTcAccept
      via token de `partner_links` (sem auth)
- [x] Router `documents`: listByOpportunity, create (+v1), addVersion
      (dedup por SHA-256), compare (mock IA)
- [x] Router `templates`: list/create/uploadVersion/setActive por categoria
- [x] `document-compare.service.ts` — Haiku gera JSON estruturado
      (scopeChanges, valueChange, marginChange, items+/-, termChanges) com
      DataMasking + circuit breaker + fallback metadata
- [x] UI `/admin/partners` — lista com stats + form de config inline
      (commission, T&C, ativo) + usuários parceiros vinculados
- [x] UI `/admin/templates` — biblioteca agrupada por categoria + form
      de adicionar
- [x] UI `/p/tc/[token]` — aceite público de T&C com token de partnerLink;
      registra IP+UA em `partner_tc_acceptances`
- [x] UI `DocumentsSection` no `/pipeline/[id]` — upload (URL),
      versionamento visual, link p/ abrir cada versão
- [x] Sprint 7 NÃO implementa upload binário (S3); usa `storageKey` como
      URL externa. Sprint 11 endurece com presigned URLs
- [x] Testes: 126/126 unit (document-compare +3: emptyResult, circuit
      breaker open/close)

### Sprint 6 — Comunicações, Busca e E-mail (concluído)
- [x] Migration `0007_inbound_email_search` — `Tenant.inboundEmailSlug`
      (citext unique), tabela `incoming_emails` (raw payload + status
      PENDING/LINKED/REJECTED + dados de vínculo), índices GIN tsvector
      PT-BR em `activities` e `incoming_emails` para fallback de busca
- [x] `inbound-email.service.ts` — ingestão de payload com normalizadores
      `fromPostmark` e `fromResend`, extração de slug por
      `extractSlugFromAddresses`
- [x] Endpoint `POST /api/v1/inbound/email` aceita Postmark/Resend/
      genérico com proteção via `?secret=` (INBOUND_WEBHOOK_SECRET)
- [x] `email-link.service.ts` — 3 heurísticas em ordem:
      `#<oppId>` no subject (conf 1.0) > match por contato (conf 0.85 se
      unique, senão sugestões) > Claude Haiku rank das top oportunidades
      ativas. Cria Activity tipo EMAIL automática quando conf ≥ 0.8
- [x] `embeddings.service.ts` — opcional via OpenAI text-embedding-3-small;
      grava em `embeddings` (pgvector) com dedup por contentHash SHA-256
- [x] `semantic-search.service.ts` — pipeline candidate retrieval →
      hydrate → rerank Haiku. Cai para tsvector PT-BR sem OPENAI_API_KEY
- [x] Routers tRPC: `inbox` (list/byId/retryAutoLink/linkManually/reject),
      `search` (natural com rerank opcional), `adminEmail` (getSlug/setSlug/
      regenerateSlug)
- [x] UI `/inbox` — lista expansível com sugestões + vincular manual +
      rejeitar + retry IA
- [x] UI `/search` — busca natural com indicador de modo (vector/tsvector)
      e reranqueamento + exemplos
- [x] UI `/admin/email-inbound` — endereço completo + copiar + regenerar
      + instruções de uso (#ID no subject)
- [x] env: `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL`,
      `INBOUND_WEBHOOK_SECRET` (todos optional)
- [x] Testes: 123/123 unit (inbound-email +9: slug parser, #ID parser,
      normalizadores Postmark/Resend)

### Sprint 5 — Relatórios, Analytics e Equipe (concluído)
- [x] Migration `0006_conversion_rates` — `Tenant.conversionRates JSONB`
      com defaults B2B (5/15/30/50/70/85/100)
- [x] `analytics.service.ts` — funções puras: `computeFunnel`,
      `avgDaysPerStage`, `winLossBreakdown`, `performanceByOwner`,
      `projectRevenue` (cenários base/best/worst)
- [x] `conversion-rate-suggestion.service.ts` — sugere taxas via
      histórico próprio (≥30 fechadas) OU IA com contexto de segmento/
      território (Claude Haiku com masking). Retorna source/rationale/rates
- [x] Router tRPC `reports`: funnel, winLoss, timePerStage,
      performanceByOwner (ANALISTA vê apenas própria linha + média
      anônima), revenueProjection, conversionRates (get/update),
      suggestConversionRates. Filtros dinâmicos: from/to/ownerId/stage/
      segmentId/territoryId. Visibilidade por perfil aplicada
- [x] `excel-export.service.ts` + endpoint `GET /api/v1/reports/export`
      gera xlsx com abas Resumo/Funil/Performance/Projeção via exceljs
- [x] UI `/reports` — filtros + funil SVG inline (sem libs) + stats
      (projeção base/best/worst, win rate, valor ganho) + tabela
      performance + motivos de perda + projeção por estágio + botão
      Exportar Excel
- [x] UI `/admin/conversion-rates` — edição inline + botão "Sugerir
      com IA" com modal de preview (atual vs sugerida) + aceitar/descartar
- [x] Testes: 114/114 unit (analytics +9, incluindo funil, win rate,
      projeção com cap 100%, performance, avgDaysPerStage)

### Sprint 4 — Atividades, Tarefas e IA (concluído)
- [x] `DataMaskingService` estendido: PESSOA (nomes PT-BR com conectores),
      EMPRESA (sufixo societário Ltda/S/A/EIRELI/Inc), VALOR (R$ N | N
      milhões de reais), ENDERECO (logradouro + número), além de EMAIL/
      PHONE/CPF/CNPJ. Inclui blacklist de falsos positivos comuns
      (São Paulo, Brasil, CNPJ, etc.) e método `audit()` para métricas
- [x] `CircuitBreaker` reusável em `src/server/services/ai-circuit-breaker.ts`
- [x] `summarizeCommunication`: mascara → Claude Haiku → parse JSON → desmascara
      → loga `ai_usage_log` com tokens + custo. Fallback gracioso se IA falhar
- [x] `ai-usage.service.ts` com `AI_PRICING` table (Anthropic, OpenAI),
      `calculateCost`, `logAiUsage`, `getMonthlyUsage`
- [x] Routers tRPC: `activities` (list, create, summarize, confirmSummary),
      `tasks` (list, myOpen, create, updateStatus), `aiConfig`
      (getConfig, updateConfig com encryption, monthlyUsage, pricingTable)
- [x] Encriptação AES-256-GCM para `tenant.ai_api_key_encrypted` em
      `src/lib/crypto/field-encryption.ts` (encryptField/decryptField/maskApiKey)
- [x] Worker scan diário agora também roda `scanTaskEscalations` — cobrança
      no vencimento (TASK_DUE) + escalonamento após `tenant.taskOverdueDays`
      (TASK_OVERDUE) para GESTOR/DIRETOR_COMERCIAL
- [x] Template de e-mail `renderTaskAlert` com badge [Escalonamento]
- [x] UI `CommunicationIntake` no `/pipeline/[id]`: textarea → resumir →
      preview com 4 blocos editáveis + checkboxes de tarefas sugeridas
- [x] Seções "Tarefas" e "Linha do tempo" no `/pipeline/[id]`
- [x] Tela `/admin/ai` para configurar provider/modelo/API key + medidor
      de consumo mensal com breakdown por modelo
- [x] Testes: 103/103 unit (masking PII +9, summary-parser +4, field-encryption +4)

### Sprint 3 — Sistema de Alertas (concluído)
- [x] `alert-generator.service.ts` — gera alertas devidos para HOJE por
      tenant; suporta datas recorrentes (ano sentinela 0001) e únicas;
      antecedência via `tenant.alertLeadDays`; resolve destinatário
      (owner da última opp da company; fallback ADMIN)
- [x] `email-sender.service.ts` — wrapper Resend com circuit breaker
      (3 falhas em 60s → aberto por 5min); dry-run quando RESEND_API_KEY
      ausente
- [x] Templates de e-mail em `src/lib/email/templates.ts`
      (relationship + pipeline)
- [x] BullMQ: `src/jobs/queues.ts`, workers `alerts-scan` e `email-send`,
      entry point `src/jobs/index.ts` com job recorrente diário 07:00 BRT
- [x] Router tRPC `alerts`: myAlerts (com window de N dias), tenantConfig,
      updateConfig (admin), dismiss
- [x] `/dashboard` com Central de Alertas (Relacionamento + Pipeline) com
      indicador de urgência + ações Abrir/Dispensar
- [x] `/admin/alerts` com edição de `alertLeadDays`, `centralCrmEmail`,
      `taskOverdueDays`
- [x] Worker no docker-compose (serviço `worker`) + script `npm run worker`
      + `npm run worker:scan-now` para disparar scan manual
- [x] Testes: 85/85 unit (alert-generator +10, email-templates +3)

### Sprint 2 — Pipeline Comercial (concluído)
- [x] Migration `0005_opportunity_stage_fields` — campos por estágio
      (meetingScheduledAt/Happened, briefing, proposalPresentedAt,
      decisionExpectedAt, estimatedTeamNotes, acceptedAt,
      acceptanceNotificationSentAt, handoffReportGeneratedAt,
      currentStageEnteredAt)
- [x] Service `opportunity-stage.service.ts` com `STAGE_EXIT_REQUIREMENTS`,
      `validateStageExit`, `isValidTransition` (avança 1 ou retrocede livre),
      `advanceStage` (transação + histórico + audit), `cancelOpportunity`
- [x] Routers tRPC: `opportunities` (com kanban, byId, advance, cancel, team),
      `partnerEngagements` (request → decide aprovar/rejeitar, revoke),
      `contracts` + `contracts.installments`
- [x] Visibilidade por perfil aplicada em queries (ANALISTA só vê próprias +
      onde é team member; DIRETOR/GESTOR vê tudo)
- [x] UI desktop Kanban com @dnd-kit (drag-and-drop entre colunas, validação
      no servidor dispara modal "Não foi possível avançar")
- [x] UI mobile com tabs horizontais por estágio + botão Avançar →
- [x] Cards mostram avatar + nome do responsável (não só iniciais)
- [x] Indicador de urgência baseado em `expectedCloseDate` (verde >7d, amarelo
      2-7d, vermelho <2d) ou em dias no estágio quando não há data prevista
- [x] Página `/pipeline/[id]` com header, ações (avançar/voltar/cancelar),
      formulário inline dos campos do estágio atual, histórico
- [x] Modal de cancelamento com motivo + lossReason (soft delete via status)
- [x] Testes: 72/72 unit (validators 39, rbac 9, masking 5, tenant-context 3,
      company-validator 6, stage-transition 10)
- [x] E2E spec `pipeline-7-stages.spec.ts` (skipped até CI ter banco seeded
      + auth fixture)

### Sprint 1 — Auth + Cadastros (concluído)
- [x] Migration `0004_sprint1_additions` com refinos (WorkArea, DIRETOR_*, CNAE,
      commissionPct, Contact.workArea/relationshipType/function, Product.type novo,
      Opportunity.contactId/source/lossReason, ContractStatus.RENEWED, ApprovalRule,
      ConsentLog)
- [x] Validators Zod compartilhados (`src/lib/validators/`): CNPJ, CPF, email,
      telefone BR, datas PT-BR
- [x] Webhook Clerk com verificação svix (`/api/clerk/webhook`):
      user.created/updated/deleted + session.created → access log
- [x] Onboarding Super Admin (`/onboarding`): cria Tenant + Company OWN + ADMIN
- [x] CRUDs tRPC: territories, segments, companies, contacts (com auto-cadastro
      público em `/p/[tenantSlug]/contact`), products, users (com convite Clerk)
- [x] Páginas mínimas: `/companies`, `/onboarding`, `/p/[slug]/contact`
- [x] Middlewares tRPC `withRoles` + `withCapability` + `adminOnlyProcedure`
- [x] `audit()` chamada nos pontos sensíveis dos CRUDs
- [x] User access log via webhook session.created
- [x] Testes: 62/62 passando (rbac, masking, tenant-context, validators, company);
      integração de isolamento gated por `DATABASE_URL_TEST` (skip local)
- [x] E2E smoke (Playwright): home, health endpoint, /p/.../contact form

---

## Configuração necessária para rodar (pós-Sprint 1)

1. **Clerk** — criar aplicação em https://dashboard.clerk.com com:
   - OAuth providers: Google, Microsoft
   - Email + Magic Link, TOTP 2FA habilitados
   - **JWT Template** com nome `default`, claim:
     ```json
     {
       "public": {
         "tenantId": "{{user.public_metadata.tenantId}}",
         "role": "{{user.public_metadata.role}}"
       }
     }
     ```
   - **Webhook** apontando para `https://seu-dominio/api/clerk/webhook` com
     events: `user.created`, `user.updated`, `user.deleted`, `session.created`.
     Copiar Signing Secret para `CLERK_WEBHOOK_SECRET`.

2. **Postgres** com extensões `vector`, `pgcrypto`, `citext` (já no
   `pgvector/pgvector:pg16` do docker-compose).

3. **Variáveis** preencher em `.env.local` (ver `.env.example`).

---

## Stack (não negociável)

| Camada | Tecnologia |
|--------|-----------|
| Frontend | Next.js 14 App Router + Tailwind CSS + shadcn/ui |
| API interna | tRPC (type-safe, Next.js ↔ frontend) |
| API pública | REST + OpenAPI 3.0 (endpoints `/api/v1/`) |
| Banco | PostgreSQL + Prisma + Row Level Security (Neon serverless em prod) |
| Autenticação | Clerk (Google OAuth, Microsoft OAuth, magic link, TOTP 2FA) |
| Filas/Jobs | BullMQ + Redis |
| Email | Resend |
| Storage | AWS S3 / Cloudflare R2 |
| Billing | Stripe |
| WAF/CDN | Cloudflare |
| Feature flags | Unleash (self-hosted) |
| IA principal | Anthropic SDK (Claude Haiku + Sonnet) |
| IA benchmarks | Perplexity API (fallback: Gemini, OpenAI) |
| Vector search | pgvector (extensão PostgreSQL) |
| Containers | Docker + Docker Compose |
| CI/CD | GitHub Actions |
| Observabilidade | Sentry + Axiom |
| Testes | Vitest (unit) + Supertest (integration) + Playwright (E2E) |

---

## Regras de Arquitetura — OBRIGATÓRIAS

1. **Multi-tenancy**: TODA query de banco inclui `WHERE tenant_id = ?` — sem exceção. A Prisma extension em `src/server/db/client.ts` injeta isso automaticamente desde que o handler esteja envolto em `runWithTenant()`. RLS no PostgreSQL como segunda linha de defesa.

2. **Validação**: TODA entrada de usuário é validada com **Zod no servidor**. Nunca confiar apenas na validação do frontend.

3. **Secrets**: ZERO hardcode de credenciais. Somente variáveis de ambiente, parseadas e validadas em `src/lib/env.ts` (Zod). Usar `.env.local` no dev (nunca commitar).

4. **Soft delete**: Campo `deleted_at` em todas as entidades. Nenhum registro é deletado permanentemente em operações normais. Exceção: rota `/api/v1/gdpr/erase` para anonimização LGPD.

5. **Data Masking para IA**: NUNCA enviar PII (nomes, e-mails, CPF/CNPJ, telefones) diretamente a providers de IA. Passar pelo `DataMaskingService` (`src/lib/ai/masking.ts`) que tokeniza e destokeniza automaticamente.

6. **Mobile-first**: Breakpoint base 375px. Bottom navigation bar em mobile. Tables → cards empilhados em viewport < 768px. Touch targets ≥ 44×44px.

7. **Audit log**: Toda ação sensível registrada em `audit_logs` via `audit()` em `src/server/services/audit.service.ts`.

8. **RBAC**: Todo endpoint tRPC/REST com middleware de auth (Clerk) + tenant + role. Roles: `SUPER_ADMIN | ADMIN | DIRETOR | GESTOR | ANALISTA | PARCEIRO`. Matriz em `src/lib/auth/rbac.ts`.

---

## Estrutura de Pastas

```
/
├── CLAUDE.md                    ← este arquivo
├── docs/
│   └── CRM_Especificacao_e_Implementacao.docx
├── src/
│   ├── app/                     ← Next.js App Router
│   │   ├── api/
│   │   │   ├── trpc/[trpc]/    ← tRPC HTTP adapter
│   │   │   └── v1/             ← REST endpoints públicos
│   │   ├── layout.tsx          ← ClerkProvider + tema shadcn
│   │   └── page.tsx
│   ├── components/
│   │   ├── ui/                 ← shadcn/ui base (button, etc.)
│   │   └── modules/            ← componentes por módulo (pipeline/, contacts/, …)
│   ├── server/
│   │   ├── trpc/
│   │   │   ├── routers/        ← um arquivo por módulo
│   │   │   ├── context.ts      ← extrai tenantId + user dos headers
│   │   │   └── trpc.ts         ← initTRPC + middlewares
│   │   ├── services/           ← lógica de negócio (audit, etc.)
│   │   ├── db/
│   │   │   ├── client.ts       ← Prisma + tenant extension
│   │   │   ├── tenant-context.ts ← AsyncLocalStorage helpers
│   │   │   └── repositories/
│   │   └── api/v1/             ← handlers REST OpenAPI
│   ├── lib/
│   │   ├── validators/         ← schemas Zod compartilhados
│   │   ├── ai/
│   │   │   ├── masking.ts      ← DataMaskingService (tokenização PII)
│   │   │   └── claude.ts       ← wrapper Anthropic SDK
│   │   ├── auth/
│   │   │   └── rbac.ts         ← matriz de permissões
│   │   ├── utils/cn.ts         ← cn() helper shadcn
│   │   └── env.ts              ← variáveis validadas com Zod
│   ├── jobs/                   ← BullMQ workers (sprint 3+)
│   └── middleware.ts           ← Next.js middleware (Clerk + tenant)
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts                 ← 3 tenants com massa em PT-BR
│   └── migrations/
│       ├── 0001_init/
│       ├── 0002_rls/
│       └── 0003_vector_indexes/
├── tests/
│   ├── unit/                   ← Vitest
│   ├── integration/            ← Supertest
│   ├── e2e/                    ← Playwright
│   └── setup.ts
├── docker-compose.yml
├── Dockerfile
└── .github/workflows/ci.yml
```

---

## Multi-tenancy — fluxo de uma requisição autenticada

```
Request HTTP
   ↓
Clerk middleware (src/middleware.ts)
   ↓  extrai sessionClaims.public.tenantId → header x-tenant-id
   ↓
Route handler (app/api/trpc/[trpc]/route.ts)
   ↓  runWithTenant({tenantId, userId, role}, async () => ...)
   ↓
tRPC procedure
   ↓
Prisma query
   ↓  $extends.query.$allOperations injeta {where: {..., tenantId}} ou
   ↓  {data: {tenantId, ...}} automaticamente
   ↓
PostgreSQL
   ↓  RLS policies (current_tenant_id()) bloqueiam vazamento mesmo se a injeção falhar
```

A camada Prisma + RLS é defesa em profundidade: ambas precisam ser bypassadas para haver vazamento de tenant.

---

## DataMaskingService — uso obrigatório antes de IA

```typescript
import { masking } from '@/lib/ai/masking';
import { getAnthropic, MODELS } from '@/lib/ai/claude';

const { masked, map } = masking.mask(userText);
const completion = await getAnthropic().messages.create({
  model: MODELS.HAIKU,
  max_tokens: 1024,
  messages: [{ role: 'user', content: masked }],
});
const safe = masking.unmask(extractText(completion), map);
```

**Nunca passe `userText` diretamente para um provider de IA.**

---

## Convenções de Código

- TypeScript strict + `noUncheckedIndexedAccess` + `noImplicitOverride`
- Nomenclatura: `camelCase` variáveis, `PascalCase` componentes/types, `snake_case` banco (mapeado via `@@map` / `@map`)
- Imports: absolute paths via `@/` alias
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`)
- Cada novo módulo: router tRPC + service + testes unitários mínimos
- Nada de comentários narrativos; explicar apenas o "porquê" não óbvio

---

## Comandos úteis

```bash
# dev
npm run dev                     # Next.js em http://localhost:3000
docker compose up -d postgres redis

# banco
npx prisma migrate dev          # cria nova migration interativamente
npx prisma migrate deploy       # aplica todas em prod/CI
npm run db:seed                 # popula 3 tenants
npm run db:reset                # reset + migrate + seed
npx prisma studio               # GUI do banco

# qualidade
npm run lint
npm run type-check
npm run test                    # Vitest
npm run test:watch
npm run test:coverage
npm run test:e2e                # Playwright

# build
npm run build
```

---

## Ordem de Implementação

Seguir rigorosamente o Plano de Sprints da **PARTE II, Seção 4** do documento de especificação.

**Nunca pular sprints ou implementar módulos fora de ordem** — cada sprint depende da fundação do anterior.

Sprint atual: **verificar no topo deste arquivo qual sprint está em andamento.**

---

## Checklist antes de cada deploy (PR → staging)

- [ ] `npm run test` passa
- [ ] `npm run type-check` passa
- [ ] `npm run lint` passa
- [ ] Job `multi-tenancy-guard` no CI passa (sem queries Prisma fora dos pontos de controle)
- [ ] Nenhum secret hardcoded (revisar diff)
- [ ] Schema Prisma migrado em staging (`npx prisma migrate deploy`)
- [ ] Seed executado (se for novo tenant)
- [ ] `GET /api/v1/health` retorna `{status: "ok", checks: {db: "ok"}}`
- [ ] Nenhum `console.log` com PII ou tokens
