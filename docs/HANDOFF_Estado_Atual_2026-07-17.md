# Handoff — 2026-07-17 (fim do dia)

Ciclo completo de débitos UX pós-rollout Sprint 15G **fechado** (P-88 → P-98,
12 fixes) + P-80 (Neon separation). Todos em prod, todos validados manualmente.

Substitui [HANDOFF_Estado_Atual_2026-07-11.md](HANDOFF_Estado_Atual_2026-07-11.md) — histórico.

---

## 1. Estado técnico atual

- **Main HEAD:** `97f325a` (QA report P-97/P-98)
- **Baseline testes:** **1241 passing / 0 failing / 175 skipped** (1416 total) — cenário verde com env presente
- **Type-check:** zero · **Lint:** zero · **Playwright smoke:** 3/3
- **Deploy Vercel Production:** `crm-b74xq332x` (Ready) — contém P-88 → P-98 completos
- **Banco prod:** branch Neon `production-live` (`ep-rapid-fog-ajm1hdvb`), isolado do dev (P-80)
- **Worker BullMQ Railway:** ainda não subiu (P-36 pendente, não bloqueia)

## 2. O que rolou hoje (2026-07-17)

**Modo canônico:** gestão (esta sessão) + chips via `spawn_task` (sessões
separadas) + QA Modo B único por batch. **Zero código escrito pela gestão.**

### Débitos fechados hoje

| ID | Fix | Commit | Deploy |
|----|-----|--------|--------|
| **P-80** | Neon separation prod/dev (branch production-live) | — (infra) | ✅ |
| **P-88b** | Sidebar RBAC gate nos 10 items admin restantes | `72fc4ee` | ✅ |
| **P-91** | Audit queries admin routers — gate cross-role read leak (19 queries, 12 routers) | `7ae7e6e` | ✅ |
| **P-92** | Padroniza feedback de erro (mutations) nas 13 telas /admin | `53defd3` | ✅ |
| **P-94** | Rota /companies/new (link quebrado /admin/partners) | `3cc5ce3` | ✅ |
| **P-95** | friendlyTrpcError em rotas de operação — zero Zod cru | `3098026` | ✅ |
| **P-92b** | Error state de queries admin (loading infinito no 403 → ErrorState) | `978f9c6` | ✅ |
| **P-96** | AlertDialog em ações destrutivas (confirm nativo removido) + coverage | `aa26a1b` | ✅ |
| **P-97** | Gate de permissão na página /more (espelha Sidebar) | `6ff635f` | ✅ |
| **P-98** | Mensagem FORBIDDEN genérica ("Seu perfil não tem acesso a esta operação") | `3e066ff` | ✅ |

(P-88/P-89/P-86 fecharam em 2026-07-11, também em prod.)

### QA Modo B (todos verdes)

- Chips Semana 1 (P-88/89/86): `auto-report-2026-07-11-chips-semana-1.md`
- P-88b/P-91: `auto-report-2026-07-11-p88b-p91.md`
- P-92/94/95: `auto-report-2026-07-17-p92-p94-p95.md`
- P-92b/housekeeping(P-96): `auto-report-2026-07-17-p92b-housekeeping.md`
- P-97/P-98: `auto-report-2026-07-17-p97-p98.md`

### Validação manual em prod (browser, 2026-07-17)

Testado como **ANALISTA** e **ADMIN**:
- P-88b: ANALISTA vê só "Estrutura comercial" na sidebar; ADMIN vê tudo ✅
- P-92b: conversion-rates + approval-rules → ErrorState "Seu perfil não tem acesso" (não loading infinito) ✅
- P-94: /companies/new renderiza form ✅
- P-95: UUID inválido → "Algo saiu errado / Tentar novamente" (não JSON cru) ✅
- P-96: "Remover regra?" AlertDialog (não confirm nativo) ✅

## 3. Débitos descobertos na validação (já fechados)

- **P-97** (página /more sem gate) — fechado no mesmo dia
- **P-98** (mensagem FORBIDDEN técnica → genérica, feedback do Fred) — fechado no mesmo dia

## 4. Segurança validada (P-98)

Mensagem FORBIDDEN única `'Seu perfil não tem acesso a esta operação.'` nas 3
fábricas (`withRoles`/`withCapability`/`withPermission`). Detalhe técnico
(role/requisito) vai pro `cause` **string** do TRPCError — **não vaza pro
cliente** (errorFormatter em trpc.ts só serializa `zodError`/`tenantIsolation`;
`cause` fica server-side). Provado por teste que serializa o shape e assevera
ausência de `withRoles`/`ANALISTA`/`requer`.

## 5. Ação humana pendente

### 🔴 P-85 (Clerk Production instance) — BLOQUEADO por domínio

Confirmado no Clerk Dashboard: app CRM B2B com badge "No Production
Environment", plano Hobby. **Clerk Production exige domínio próprio** pra
configurar DNS (CNAME `clerk.dominio` + `accounts.dominio`) — NÃO funciona no
`.vercel.app`. Fred vai avaliar registrar um domínio (~R$40/ano Registro.br pra
.com.br, ou Cloudflare pra .com).

Quando tiver domínio, retomar (~1h): criar Production Environment → DNS records
→ JWT template (claims `public.tenantId/role/platformRole`) → webhook endpoint
→ trocar `pk_live`/`sk_live` no Vercel → re-vincular os 6 usuários (Production
instance nasce vazia; usuários re-logam via magic link/OAuth). Não urgente
enquanto prod é só Fred + contas de teste; fazer antes do 1º cliente-piloto.

### 🟡 P-36 (Railway worker) — não bloqueia hoje

Necessário pro Sprint 15H bloco A (worker approval-reconcile).

## 6. Débitos residuais menores (backlog, não urgentes)

| ID | Item | Severidade |
|----|------|-----------|
| P-81 | Runbook recovery pós-restore Neon | 🟢 Housekeeping |
| P-82 | Loop 401 → tela dedicada (clerkId sem row local) | 🟡 Sprint 16 |
| P-83 | Partial UNIQUE (tenant_id, email) WHERE deleted_at IS NULL | 🟢 Housekeeping |
| P-84 | Convidar reativa row soft-deleted | 🟢 Housekeeping |
| P-90 | Coverage funcs admin/users (fechado no P-96 housekeeping → 92%) | ✅ |

## 7. Roadmap grande (o que sobra)

**Sprint 15G.5 — Workflow de transferência de oportunidade (P-87)** — 6-7 dias
dedicados. Spec completa em `docs/Planejamento_Debitos_Pos_Rollout_15G.md` §P-87:
migration 0032 (`opportunity_transfers` + flags), 7 procedures, worker cron de
timeout, 3 telas novas, 7 templates de notificação. Regra: ancestor da estrutura
dispara → destino é par/superior → destinatário escolhe analista → durante
pendência dono vê read-only → rejeição/timeout/cancelamento volta pro disparador.

**Sprint 15H — Metas + Reconcile Approvals** — 8-10 dias. Blocos A (P-77 worker
daily reconcile), B (sales_quotas + drill-down), C (opportunities.list com
owner.primaryUnit.name). Depende de P-36 (Railway worker) pro bloco A.

## 8. Comandos úteis pra retomar

```bash
cd ~/Claude/crm-app
git log --oneline -5
npm test                  # esperado 1241/0/175
curl -sS https://crm-app-pi-eight.vercel.app/api/v1/health
```

## 9. Referências

- **Planejamento débitos v3 (com P-87 completo):** [Planejamento_Debitos_Pos_Rollout_15G.md](Planejamento_Debitos_Pos_Rollout_15G.md)
- **QA reports:** `docs/qa-sessions/auto-report-2026-07-{11,17}-*.md`
- **Roteiro QA homologação:** [Roteiro_QA_Homologacao_Staging.md](Roteiro_QA_Homologacao_Staging.md) — §2.8–§2.11 + §2.5 (cenários dos chips)
- **Handoff anterior:** [HANDOFF_Estado_Atual_2026-07-11.md](HANDOFF_Estado_Atual_2026-07-11.md)

---

**Fim do dia 2026-07-17.** 12 débitos fechados + Neon separation + validação
prod completa. P-85 bloqueado por domínio (decisão do Fred). Próximo trabalho
grande: Sprint 15G.5 (P-87 workflow transferência).
