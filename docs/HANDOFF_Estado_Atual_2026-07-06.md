# Handoff — 2026-07-06 (fim da sessão)

Snapshot de sessão longa que fechou P-65+P-66, planejou Sprint 15G com
amendments, reconstruiu Metodologia, e passou por incidente processual
(QA pulado antes do deploy — mitigado retroativamente).

**Você é a próxima sessão.** Leia este primeiro. Depois `CLAUDE.md`
pra contexto do sprint atual + `Metodologia §3 checklist` (reconstruída
hoje).

Substitui [HANDOFF_Estado_Atual_2026-07-05.md](HANDOFF_Estado_Atual_2026-07-05.md) — histórico.

---

## 1. Estado técnico atual

- **Main HEAD:** `33333b2` — docs(process): reconstroi Metodologia + chip-prompts pra Sprint 15G e P-77
- **Baseline testes** (paterna, env dummy consistente):
  - `npm test`: **944 passing / 0 failing / 174 skipped** (1118 total)
  - `npx tsc --noEmit`: zero
  - `npm run lint`: zero
- **Deploy Vercel production:** `https://crm-app-pi-eight.vercel.app`
  - Último deploy: `dpl_HjfvdgUskbzmj8bnVGVrUeUPziwD` (`b8be0de` Merge P-66)
  - Prod smoke `{status:"ok", db:"ok", dbLatencyMs:1176}` — healthy
- **Worker BullMQ Railway:** ainda não subiu (P-36 pendente ação Fred)
- **Env vars prod:** só as 9 essenciais (Clerk + DATABASE + APP_URL). Ausentes: `TENANT_FIELD_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, Redis, Stripe, flags kill-switch

---

## 2. Ciclo 2026-07-06 (o que foi feito)

### 2.1. Chips mergidos + deployados

- **P-65** `estimatedValue` sync com valor da proposta (Merge `e281718`)
  - `src/server/trpc/routers/proposals.ts` — `addVersion` sincroniza
    `Opportunity.estimatedValue = latestVersion.totalValue` em
    `prisma.$transaction`; audit com `tenantIdOverride`
  - +9 casos em `tests/unit/proposals-router.test.ts` (novo)
- **P-66** Gate PROPOSTA→NEGOCIACAO exige valor+margem+documento (Merge `b8be0de`)
  - `src/server/services/opportunity-stage.service.ts` — helper
    `validateProposalExit(client, opportunityId, tenantId)` async
    valida: ≥1 ProposalVersion, `totalValue` não-null, `marginPct`
    não-null, ≥1 Document `category IN (PROPOSTA_TECNICA, PROPOSTA_COMERCIAL)`
  - +8 casos em `tests/unit/stage-transition.test.ts`

### 2.2. Docs planejamento Sprint 15G

- **`docs/RBAC_OrgVisibility_Mapa_2026-07-06.md`** (161 linhas) — mapa
  dos 3 eixos: RBAC, estrutura organizacional, aprovações. Base pro
  Fred discutir com PO.
- **`docs/Sprint_15G_amendments.md`** (273 linhas) — 7 amendments
  A1-A7 críticos à spec original do PO. Deve ser LIDO antes de spawn
  do chip 15G.
- **`docs/chip-prompts/Sprint_15G_estrutura_comercial.md`** — prompt
  self-contained pra `spawn_task` incluindo os amendments aplicados.
- **`docs/chip-prompts/P-77_approvals_orfas.md`** — prompt pra P-77
  com decisão A/B (worker daily reconcile vs re-execução ativa).

### 2.3. Metodologia reconstruída

- **`docs/Metodologia_Desenvolvimento_Venzo.md`** — reescrita completa
  incorporando feedbacks acumulados:
  - §4.10 Backstop tenant-isolation reformado (P-42)
  - §4.11 Approvals são snapshot vs RBAC dinâmico (P-77)
  - §5.2 Baseline atualizado (944/0/174)
  - §8.3 Protocolo de colisão de IDs P-XX
  - §9.4 QA pós-merge REFORÇADO com case study §16.1
  - §10.6 Never parse secrets
  - **§11.4 Gate QA antes de deploy — NÃO-NEGOCIÁVEL** (novo)
  - §12.5 chip-prompts como padrão (novo)
  - §16 Case studies (novo — 5 aprendizados)

### 2.4. Diagnóstico P-67 (pausado)

Investigação SQL prod no tenant `acme-tech` (onde
`fredmarquezini@hotmail.com` é DIRETOR_COMERCIAL) revelou:

- 4 approvals PENDING existem, mas approver_id aponta pra ANALISTA
  (della.block36) e GESTOR (marquise_ritchie68)
- Rules ATUAIS apontam pra `{DIRETOR_COMERCIAL, DIRETOR_FINANCEIRO}` e
  `{DIRETOR_COMERCIAL}` — nunca editadas (audit_logs vazio)
- Engine só cria approval pra role que está em rule — **impossível**
  ter produzido esses approver_ids com as rules atuais
- Hipótese: approvals são snapshot (approver_id fixo), enquanto RBAC e
  rules são dinâmicas → **descompasso arquitetural fundamental**

Fred pausou pra alinhar com PO. PO respondeu com Sprint 15G (estrutura
comercial). Sessão paterna revisou spec + gerou 7 amendments críticos.
P-77 registrado como aberto pra Sprint 15H (approvals órfãs).

### 2.5. Renumeração P-65/66/67/68 → P-73/74/75/76

Descoberta colisão de IDs no `docs/Backlog_Pos_MVP.md` — bloco P-53
residual usava P-65/66/67/68 pra Testing Library ao mesmo tempo que
chip criava P-65/66/67 pra bugs novos. Fix: renumerou bloco antigo
pra P-73+. Duplicata P-57 também removida.

### 2.6. QA automation retroativo pós P-65+P-66

- Chip QA (`confident-bhaskara-a87fe4`) rodou análise cross-cheched
  do main pós-merges vs baseline pré. **Verdict: 🟢 OK MANTER PROD.**
- Report persistido em `docs/qa-sessions/auto-report-2026-07-06-p65-p66-retroativo.md`
- Baseline 944/0/174 confirmado, coverage nos alvos (proposals.ts 100%
  branches no `addVersion`; opportunity-stage.ts 91.66% branches),
  cross-tenant validado, docs íntegros

### 2.7. Incidente processual (case study §16.1)

Sessão paterna **pulou QA antes do deploy prod** — mergeou P-65+P-66,
rodou smoke (tsc/lint/test), deployou. Fred detectou o gap. QA
automation retroativo mitigou; regra derivada agora explicitada como
§11.4 não-negociável da Metodologia.

---

## 3. Deploys prod feitos hoje

1. **`dpl_HjfvdgUskbzmj8bnVGVrUeUPziwD`** — Merge P-65 + Merge P-66
   (`b8be0de`) — **status healthy**, QA retroativo verde.

---

## 4. Débitos abertos pra próxima sessão (priorizado)

### 🔴 Alta prioridade

| ID | Item | Esforço | Notas |
|---|---|---|---|
| **P-67** | `/approvals` invisível pra DIRETOR_C/F | 1-3h investigação | Pausado — aguarda alinhamento PO + estruturação 15G |
| **Sprint 15G** | Estrutura comercial + visibilidade hierárquica | 11.6 dias | Prompt pronto em `docs/chip-prompts/`. Amendments A1-A7 devem ser aplicados. Aguarda validação final PO |
| **P-77** | Approvals órfãs quando role/rule/estrutura muda | 2-3d | Prompt pronto. Fica pra Sprint 15H OU paralelo se ficar crítico |

### 🟡 Débitos residuais registrados

Ver `docs/Backlog_Pos_MVP.md` topo. Destaques:

| ID | Item | Origem |
|---|---|---|
| P-57 | Design "IA bloqueia por dirty em campos não-Receptor" | P-54 (decisão produto) |
| P-64 | 3 outras ocorrências `.text-brand` (admin/branding + PolicyAcceptGate) | P-55 |
| P-68 | `.text-caption.text-text-3` no header público reprova WCAG AA | QA H+I |
| P-69 | CookieBanner sem teste de componente | QA H+I |
| P-70 | Rate-limit sender sem bypass em `forcePromoted` | QA H+I (decisão produto) |
| P-71 | Metodologia §5.2 baseline stale | ✅ FECHADO hoje |
| P-72 | `permissions.service.ts` funcs 25% | QA H+I |
| P-73/74/75/76 | Testing Library expansion (companies/contacts/admin.users/pipeline) | P-53 residual (renumerado 2026-07-06) |

### 🟡 Aberto anterior

- **P-03** visual baseline (precisa app local + seed E2E)
- **P-05** Lighthouse audit CI (precisa STAGING_URL)
- **P-27** `/api/v1/inbound/email` estender pra criar Lead (1d)
- **P-28** Integrações OAuth nativas (sob demanda cliente)
- **P-59** Playwright infra worktree (browsers Clerk mock)

### 🔴 Ação humana Fred (não desbloqueia com chip)

- **Rejeitar 4 approvals fósseis no `acme-tech`** — logar como
  della.block36 (ANALISTA) e marquise_ritchie68 (GESTOR) e rejeitar
  as 4 PENDING via UI. Justificativa: "aprovação órfã — role da rule
  mudou". Cria audit trail.
- **P-36** Subir Railway worker (30min-2h) — desbloqueia P-38
- **P-25** Rollout Sprint 15F em prod (Fred decide quando)
- **Task #22** Validar visualmente P-08 a P-12 em prod
- **Task #23** Testar IA end-to-end após créditos Anthropic
- **Sprint 15G validação final** — Fred alinha PO nos 7 amendments antes de spawn

---

## 5. Regras críticas descobertas nesta sessão

### 5.1. Approvals são snapshot vs RBAC dinâmico (P-77)

Descompasso fundamental: approvals persistem `approver_id` fixo no
momento da criação, RBAC e rules são dinâmicos. Consequência: quando
role/rule/estrutura muda, approvals antigas ficam órfãs (approver
correto não vê `/approvals`; approver antigo pode ver).

Solução P-77 (Sprint 15H): worker daily reconcile OU re-execução
ativa. Ver `docs/chip-prompts/P-77_approvals_orfas.md`.

Ver [Metodologia §4.11](Metodologia_Desenvolvimento_Venzo.md#411-approvals-são-snapshot-vs-rbac-dinâmico-p-77-aberto).

### 5.2. Backstop tenant-isolation reformado (P-42 do dia 05)

`create` exige `tenantId` no payload; `update`/`upsert.update` NÃO
exigem (WHERE injection protege). `assertTenantWritePayload` é
função pura extraída de `src/server/db/client.ts`.

Ver [Metodologia §4.10](Metodologia_Desenvolvimento_Venzo.md#410-backstop-tenant-isolation-p-42-reformado).

### 5.3. Gate QA antes de deploy prod (NÃO-NEGOCIÁVEL)

Deploy prod SÓ depois de:
1. Merge em main verde
2. Smoke da paterna (tsc + lint + test) verde
3. **QA automation com verdict VERDE ou AMARELO** — passo obrigatório
4. Autorização humana

Case study §16.1 documenta o que aconteceu hoje quando pulou. Ver
[Metodologia §11.4](Metodologia_Desenvolvimento_Venzo.md#114-gate-de-qa-antes-de-deploy-prod-obrigatório).

### 5.4. Colisão de IDs P-XX (protocolo 2026-07-06)

Quando chips paralelos criam débitos residuais, IDs podem colidir.
Protocolo: novo bug preserva ID mais baixo; débito residual migra
pros próximos slots livres. Bloco "Renumeração YYYY-MM-DD" documenta
a mudança.

Ver [Metodologia §8.3](Metodologia_Desenvolvimento_Venzo.md#83-colisão-de-ids-p-xx).

### 5.5. Fred usa 2 contas (memória continua válida)

- `marquezinifred@gmail.com` = ADMIN + PLATFORM_OWNER (dual identity)
- `fredmarquezini@hotmail.com` = DIRETOR_COMERCIAL (conta teste UX real)

Ao investigar 403/RBAC em prod, perguntar qual conta antes de assumir role.
Ver [crm-app-setup-state.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/crm-app-setup-state.md).

---

## 6. Ações humanas críticas ainda em aberto

- **Alinhamento Fred × PO sobre Sprint 15G amendments A1-A7** — Fred
  deve validar as 7 emendas com PO antes de autorizar spawn do chip.
- **Rejeição das 4 approvals fósseis no `acme-tech`** — 5min via UI.
  Não bloqueia mas limpa o tenant seed.
- **Railway worker** (P-36) — ação humana ~30min-2h
- **Task #22** validar visual P-08 a P-12
- **Task #23** testar IA e2e após créditos Anthropic
- **Rollout Sprint 15F prod** (P-25) — Fred decide quando

---

## 7. Comandos úteis pra retomar

```bash
# Estado do repo
cd /Users/fredmarqueziniyahoo.com.br/Claude/crm-app
git log --oneline -10
git status

# Testes
npm test                  # esperado 944/0/174 (paterna)
npx tsc --noEmit          # zero
npm run lint              # zero

# Worktrees ativas
git worktree list

# Prod health
curl -sS https://crm-app-pi-eight.vercel.app/api/v1/health

# Dev local
rm -rf .next && npm run dev

# Spawn chips prontos (via UI ou repetir prompt de docs/chip-prompts/)
# Sprint 15G: docs/chip-prompts/Sprint_15G_estrutura_comercial.md
# P-77:       docs/chip-prompts/P-77_approvals_orfas.md
```

---

## 8. Referências rápidas

### Docs vivos
- **Metodologia (reconstruída):** [Metodologia_Desenvolvimento_Venzo.md](Metodologia_Desenvolvimento_Venzo.md)
- **Roteiro QA:** [Roteiro_QA_Homologacao_Staging.md](Roteiro_QA_Homologacao_Staging.md)
- **Backlog vivo:** [Backlog_Pos_MVP.md](Backlog_Pos_MVP.md) — P-01 a P-77 (P-73/74/75/76 renumerados)
- **CLAUDE.md:** raiz — sprints + changelog

### Docs de review 2026-07-06
- **Mapa 3 eixos:** [RBAC_OrgVisibility_Mapa_2026-07-06.md](RBAC_OrgVisibility_Mapa_2026-07-06.md)
- **Amendments Sprint 15G:** [Sprint_15G_amendments.md](Sprint_15G_amendments.md)

### Chip prompts prontos (novo padrão §12.5)
- [chip-prompts/Sprint_15G_estrutura_comercial.md](chip-prompts/Sprint_15G_estrutura_comercial.md)
- [chip-prompts/P-77_approvals_orfas.md](chip-prompts/P-77_approvals_orfas.md)

### QA reports arquivados
- [qa-sessions/auto-report-2026-07-06-p65-p66-retroativo.md](qa-sessions/auto-report-2026-07-06-p65-p66-retroativo.md) — verdict verde
- [qa-sessions/auto-report-2026-07-05-batch-9-merges.md](qa-sessions/auto-report-2026-07-05-batch-9-merges.md) — bloco H+I

### Memórias
- [crm-app-setup-state.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/crm-app-setup-state.md) — contas + setup
- [tenant-backstop-lesson.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/tenant-backstop-lesson.md) — P-42
- [env-boolean-parsing.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/env-boolean-parsing.md) — P-60
- [rbac-kill-switch-runtime.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/rbac-kill-switch-runtime.md) — P-62
- [feedback_chip_qa_homologacao.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/feedback_chip_qa_homologacao.md) — QA obrigatório
- [feedback_never_parse_secrets.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/feedback_never_parse_secrets.md) — proibição parsing secrets

---

## 9. Próximo passo recomendado

1. **Ler Metodologia §3 checklist + §11.4 gate QA + §16 case studies** (10min)
2. **Ler CLAUDE.md §Sprint atual** + últimas 3 seções de Débitos zerados
3. **Perguntar ao Fred:**
   - PO aprovou os amendments A1-A7 do Sprint 15G? Podemos spawnar?
   - Fred rejeitou as 4 approvals fósseis do `acme-tech`?
   - Alguma nova prioridade descoberta em uso?
4. **Se Sprint 15G autorizado:** spawn chip usando prompt em
   `docs/chip-prompts/Sprint_15G_estrutura_comercial.md`
5. **Se P-77 subir prioridade:** spawn chip usando prompt em
   `docs/chip-prompts/P-77_approvals_orfas.md`
6. **Se novo débito P-XX aparecer em uso:** registrar em backlog com
   IDs únicos (grep antes de criar — colisão hoje foi documental)

---

## 10. Notas de continuidade

- Sessão longa (>10h wall clock). Fred está engajado e responsivo mas
  merece pausas — se contexto novo escalar, sugerir handoff antes de
  esticar
- **Incidente processual hoje foi útil** — case study §16.1 da
  Metodologia agora tem exemplo real de "pular QA custa retrabalho"
- Padrão de docs de review pré-implementação (Mapa + Amendments) foi
  descoberto e formalizado em §12.6. Usar sempre pra sprints > 5d
- Baseline evolução do dia: 927 (início) → 944 (fim) = **+17 tests**
  (P-65: 9, P-66: 8)
- Sprint 15G foi bem-especificada pelo PO. Amendments cobrem os 7
  riscos reais identificados sem inflar escopo

---

**Última atualização:** 2026-07-06 fim da sessão
