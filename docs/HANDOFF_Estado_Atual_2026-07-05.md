# Handoff — 2026-07-05 (fim da sessão)

Snapshot ao pausar sessão longa (~30 tasks, 29 fechadas + 1 aguardando QA).
Fecha ciclo epic pós-P-42 backstop.

**Você é a próxima sessão.** Leia este primeiro. Depois `CLAUDE.md`
pra contexto do sprint atual + Metodologia §3 checklist.

Substitui [HANDOFF_Estado_Atual_2026-07-04.md](HANDOFF_Estado_Atual_2026-07-04.md) — histórico.

---

## 1. Estado técnico atual

- **Main HEAD:** `2c3155f` — docs(backlog): registra P-65/P-66/P-67
- **Baseline testes** (paterna, env dummy consistente):
  - `npm test`: **927 passing / 0 failing / 174 skipped** (1101 total)
  - `npx tsc --noEmit`: zero
  - `npm run lint`: zero na paterna
- **Deploy Vercel production:** `https://crm-app-pi-eight.vercel.app`
  - Último deploy: `dpl_Guj9B3xGfKXDV2JdjbD6ejfwSB7B` (bloco G) — P-54 desbloqueio Salvar + IA
  - **⚠️ Bloco H+I (9 chips: P-55/P-63/P-29/P-62/P-44/P-61/P-53/P-37/P-30) NÃO deployado ainda** — QA verde ✅ mas deploy pendente autorização Fred
- **Worker BullMQ Railway:** ainda não subiu (P-36 pendente ação Fred)
- **Env vars prod:** só as 9 essenciais (Clerk + DATABASE + APP_URL). Ausentes: `TENANT_FIELD_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, Redis, Stripe, flags kill-switch

## 2. Ciclo epic 2026-07-05 (o que foi feito)

**27 débitos fechados hoje** (ordem cronológica):

### Fase 1 — Housekeeping (mecânica)
- P-39 Clerk dummy pub key
- P-40 ESLint root:true
- P-41 baseline docs
- Housekeeping cycle (R1 CLERK_ENCRYPTION_KEY + R2 baseline Roteiro + R3 nuance 715/709)

### Fase 2 — Bug crítico prod
- **P-42** backstop tenant-isolation quebrava `.update` em 8+ modelos — reforma arquitetural

### Fase 3 — UX prod
- **P-50** máscara pt-BR Valor estimado
- **P-54** toast + limpar edits + IA desbloqueia (3 bugs em 1 fix)

### Fase 4 — Bloco A+B+C
- P-51 smoke.spec Sprint 14 copy
- P-52 axe iframe Clerk
- P-45 createMany audit
- P-46 tenant-isolation → TRPCError
- P-47 vitest dotenv (fecha P-43)

### Fase 5 — Bloco G
- **P-56** billing.statusForBanner (não-ADMIN)
- **P-58** toast Communication/Documents/Proposals
- **P-31** push nativo assignInbound
- **P-60** comm-summary mock migrado + **envBoolean fix bombástico**
  - `z.coerce.boolean("false") === true` — todas flags kill-switch estavam ligadas
  - Sem risco em prod porque nenhuma flag foi setada

### Fase 6 — Bloco H (Sprint 16)
- P-37 cobertura dispatch + ai-usage
- P-44 caller tRPC integration
- P-53 Testing Library harness piloto
- P-61 trpc.ts coverage direto

### Fase 7 — Bloco I (higiene + Sprint 15D residuais)
- P-55 CookieBanner contraste WCAG AA
- P-63 doc regra envBoolean + regressão test
- P-62 RBAC_GRANULAR_ENABLED kill-switch runtime real
- P-29 rate limit por sender email
- P-30 UI /admin/inbound-rejected

**6 QA automations rodadas** (todas verdes): pós-P-42, pós-P-50, pós-bloco A+B+C, pós-bloco G, pós-bloco H+I ✅ 927/0/174.

**Relatórios QA persistidos**: `docs/qa-sessions/auto-report-2026-07-05-batch-9-merges.md` (chip QA salvou).

## 3. Deploys prod feitos

1. P-50 máscara pt-BR (`dpl_8LLwCrEYXSZM5t2j2Ug6GWyRnZmN`)
2. P-42+P-54+bloco A+B+C+G (`dpl_Guj9B3xGfKXDV2JdjbD6ejfwSB7B`)

## 4. Débitos abertos pra próxima sessão (priorizado)

### 🔴 Alta prioridade — pedidos do Fred pra amanhã (P-65/P-66/P-67)

Todos descobertos em uso 2026-07-05. Detalhamento completo no
Backlog_Pos_MVP.md linhas iniciais.

| ID | Item | Esforço |
|---|---|---|
| **P-65** | `estimatedValue` da opp não sincroniza com valor da proposta | 2h |
| **P-66** | PROPOSTA→NEGOCIACAO deve exigir valor + margem + documento anexado | 2h |
| **P-67** | 🔴 `/approvals` invisível pra DIRETOR_COMERCIAL/FINANCEIRO — feature quebrada | 1-3h |

**Sugestão:** começar por **P-67** (feature quebrada, alta severidade)
com investigação SQL prod primeiro pra identificar se bug é engine,
filtro RBAC ou config. Depois P-65 e P-66 (business rules relacionadas
a proposta).

### 🟡 Débitos residuais recém-registrados

| ID | Item | Origem |
|---|---|---|
| P-57 | Design "IA bloqueia por dirty em campos não-Receptor" | Chip P-54 (decisão produto) |
| P-64 | 3 outras ocorrências `.text-brand` (admin/branding + PolicyAcceptGate) | Chip P-55 |
| P-68 | `.text-caption.text-text-3` no header público reprova WCAG AA | QA H+I |
| P-69 | CookieBanner sem teste de componente (0% coverage) | QA H+I |
| P-70 | Rate-limit sender sem bypass em `forcePromoted` — decisão produto | QA H+I |
| P-71 | Metodologia §5.2 baseline stale (715→927) | QA H+I |
| P-72 | `permissions.service.ts` funcs 25% (helpers gated por DB) | QA H+I |

### 🟡 Aberto anterior (Sprint 16 hardening + backlog)

- **P-03** visual baseline (precisa app local + seed E2E)
- **P-05** Lighthouse audit CI (precisa STAGING_URL)
- **P-27** `/api/v1/inbound/email` estender pra criar Lead (1d)
- **P-28** Integrações OAuth nativas (sob demanda cliente)
- **P-59** Playwright infra worktree (browsers Clerk mock)

### 🔴 Ação humana Fred (não desbloqueia com chip)

- **P-36** Subir Railway worker (30min-2h) — desbloqueia P-38
- **P-25** Rollout Sprint 15F em prod (Fred decide quando)
- **Task #22** Validar visualmente P-08 a P-12 em prod
- **Task #23** Testar IA end-to-end após créditos Anthropic

### 🧹 Higiene backlog pendente

- Duplicatas históricas P-18, P-19 (Sprint 15F backend fechado; rollout = P-25)
- Batch merge sed pode ter deixado blocos duplicados em CLAUDE.md/Backlog — QA vai reportar

## 5. Regras críticas descobertas nesta sessão

### 5.1. Bug bombástico `z.coerce.boolean` (P-60)
`z.coerce.boolean("false") === true` (JS truthy). Usar `envBoolean(default)`
de `src/lib/env.ts` sempre em kill-switches. Ver
[env-boolean-parsing.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/env-boolean-parsing.md).
Preventivo em Metodologia §4.9 (adicionado por P-63) + teste regressão
[env-schema-regression.test.ts](../tests/unit/env-schema-regression.test.ts).

### 5.2. Fred usa 2 contas (memory salva)
- `marquezinifred@gmail.com` = ADMIN + PLATFORM_OWNER (dual identity)
- `fredmarquezini@hotmail.com` = DIRETOR_COMERCIAL (conta teste UX real)

Ao investigar 403/RBAC em prod, perguntar qual conta está em uso antes
de assumir role. Ver [crm-app-setup-state.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/crm-app-setup-state.md).

### 5.3. Backstop tenant-isolation reformado (P-42)
Ver [tenant-backstop-lesson.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/tenant-backstop-lesson.md).
`create` exige tenantId; `update`/`upsert.update` NÃO exigem (WHERE
protege). `assertTenantWritePayload` extraído como função pura testável.

### 5.4. RBAC_GRANULAR_ENABLED tem consumer runtime (P-62)
Ver [rbac-kill-switch-runtime.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/rbac-kill-switch-runtime.md)
(se P-62 caminho A). Rollback via env var funciona agora — mas
overrides individuais deixam de valer com flag=false.

### 5.5. QA automation obrigatório default (Metodologia §9.4)
Sempre spawn QA após merge de código app. Bloco H+I foi 9 chips em
paralelo + 1 QA único cobrindo todos — validou. Padrão continua.

## 6. Ações humanas críticas ainda em aberto

- **QA automation pós-bloco H+I** (task_a35e95db) — aguardando fechamento.
  Quando chegar report, próxima sessão:
  - Consumir §6 Regressões + §7 Débitos + §8 Integridade docs + §9 Recomendação
  - Se verde e docs OK → push+deploy prod dos 9 chips
  - Se docs bagunçados (batch sed) → chip housekeeping curto pra limpar
  - Se regressões → chip de fix
- **Deploy prod bloco H+I** — pendente autorização Fred pós-QA verde
- **Railway worker** (P-36) — ação humana ~30min-2h
- **Task #22** validar visual P-08 a P-12
- **Task #23** testar IA e2e após créditos Anthropic

## 7. Comandos úteis pra retomar

```bash
# Estado do repo
cd /Users/fredmarqueziniyahoo.com.br/Claude/crm-app
git log --oneline -10
git status

# Testes
npm test                  # esperado 927/0/174 (paterna)
npx tsc --noEmit          # zero
npm run lint              # zero

# Worktrees ativas
git worktree list
for b in $(git branch --format='%(refname:short)' | grep '^claude/'); do
  count=$(git log --oneline main..$b 2>/dev/null | wc -l | tr -d ' ')
  if [ "$count" != "0" ]; then echo "$b: $count commits ahead"; fi
done

# Prod health
curl -sS https://crm-app-pi-eight.vercel.app/api/v1/health

# Dev local
rm -rf .next && npm run dev
```

## 8. Referências rápidas

- **Metodologia:** [Metodologia_Desenvolvimento_Venzo.md](Metodologia_Desenvolvimento_Venzo.md)
- **Roteiro QA:** [Roteiro_QA_Homologacao_Staging.md](Roteiro_QA_Homologacao_Staging.md)
- **Backlog vivo:** [Backlog_Pos_MVP.md](Backlog_Pos_MVP.md) — P-01 a P-67
- **CLAUDE.md:** raiz — sprints + changelog
- **Memórias:**
  - [crm-app-setup-state.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/crm-app-setup-state.md) — contas + setup
  - [tenant-backstop-lesson.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/tenant-backstop-lesson.md) — P-42
  - [env-boolean-parsing.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/env-boolean-parsing.md) — P-60
  - [rbac-kill-switch-runtime.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/rbac-kill-switch-runtime.md) — P-62 (se aplicável)
  - [feedback_chip_qa_homologacao.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/feedback_chip_qa_homologacao.md) — QA obrigatório
  - [feedback_never_parse_secrets.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/feedback_never_parse_secrets.md) — proibição parsing secrets

## 9. Próximo passo recomendado

1. **Ler Metodologia §3 checklist** (5min)
2. **Ler CLAUDE.md §Sprint atual** + últimas 5 seções de Débitos zerados
3. **Consumir QA report pós-bloco H+I** quando chegar no chat de retomada
4. **Perguntar ao Fred:**
   - Autoriza deploy prod dos 9 chips do bloco H+I?
   - Prefere começar por P-67 (feature quebrada aprovações) ou P-65+P-66 (proposta sync)?
5. **Se autorizar deploy:** `vercel --prod` (CLI autenticada, sabemos que funciona)
6. **Se seguir com P-67:** investigação SQL prod primeiro pra identificar
   raiz do problema (engine vs filtro vs config)

## 10. Notas de continuidade

- Sessão foi longa (~7h wall clock, 30 tasks). Chegou onde context pesava
  mas ainda coerente
- Fred está aggressive/agressivo hoje — autorizou 9 chips simultâneos.
  Reduzir escopo se contexto novo escalar demais
- Batch merge via `sed` funcionou pros 9 chips mas pode ter deixado docs
  bagunçados — QA vai reportar. Se aparecer, `docs(housekeeping)` inline
- Baseline evolução: 715 (início dia) → 927 (fim dia) = **+212 tests**
- 27 débitos fechados. Nenhum débito ficou aberto sem contexto ou plano

---

**Última atualização:** 2026-07-05 22:15 BRT (pausa da sessão)
**Próximo checkpoint recomendado:** após consumir QA report pós-bloco H+I
