# Handoff — 2026-07-04 (fim da sessão)

Snapshot do estado ao fechar sessão longa que fez P-32 + P-33/P-34/P-35/P-36 + docs Metodologia + Roteiro QA + QA automation cycle.

**Você é a próxima sessão.** Leia este primeiro. Depois `CLAUDE.md` pra contexto do sprint atual.

Substitui [HANDOFF_Estado_Atual_2026-07-01.md](HANDOFF_Estado_Atual_2026-07-01.md) — aquele fica como histórico.

---

## 1. Estado técnico atual

- **Main HEAD:** `19729d7` — docs(backlog): P-32 rotação Neon staging — FECHADO
- **Baseline testes real (medido por QA automation em 2026-07-04):**
  - `npm test`: **715 passing / 0 failing / 168 skipped** com env dummy consistente
  - Sem env vars: ~11 test files falham (env-dependent, não regressão real)
  - `npx tsc --noEmit`: zero
  - `npm run lint`: zero (na paterna; worktree pode falhar por P-40)
- **Migrations aplicadas em Neon staging:** até 0030 (Sprint 15E)
- **Feature flags no `.env.local`:** `MULTI_AI_ENABLED=true`, `RBAC_GRANULAR_ENABLED=false` (default seguro)
- **Deploy Vercel production:** `https://crm-app-pi-eight.vercel.app` — funcional, `/api/v1/health` retorna 200 OK
- **Worker BullMQ Railway:** não subiu ainda (P-36 ação humana pendente — artefatos prontos)

## 2. O que Fred fez nesta sessão (2026-07-04)

**5 débitos fechados:**
- P-32 🔒 Rotação senha Neon (~1h — 3 iterações com 2 vazamentos adjacentes durante debug)
- P-33 Vercel CLI upgrade (~30s)
- P-34 Clerk dev metadata delay (~1h doc runbook)
- P-35 Sentry + Axiom wiring (chip — +21 tests, cobertura Sentry/Axiom 82-90%)
- P-36 Dockerfile.worker + railway.json + guia (artefatos; execução Railway = ação humana)

**5 débitos novos registrados (P-37 a P-41):** todos descobertos pelo QA automation report — candidatos Sprint 16.

**Novos docs criados:**
- [`Metodologia_Desenvolvimento_Venzo.md`](Metodologia_Desenvolvimento_Venzo.md) — 574 linhas. Fonte da verdade única de processo
- [`Roteiro_QA_Homologacao_Staging.md`](Roteiro_QA_Homologacao_Staging.md) — 691 linhas, 31 cenários pass/fail

**Comportamento novo consolidado (memory + metodologia):**
- QA automation via `anthropic-skills:qa-automation` é **obrigatório default** após todo merge de código
- Todo chip spawnado recebe checklist de fechamento (§3 Metodologia) — inclui Roteiro QA
- **NUNCA** parsing/hexdump/awk em linhas com secret embutido ([feedback_never_parse_secrets](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/feedback_never_parse_secrets.md))

## 3. Débitos abertos (prioridade)

| ID | Item | Bloqueador / Ação |
|---|---|---|
| P-03 | Visual baseline | Precisa seed E2E |
| P-05 | Lighthouse CI | Precisa `vars.STAGING_URL` no GitHub |
| P-25 | Rollout Sprint 15F em prod | Fred decide quando (backend Sentry/Axiom já subido) |
| P-27 | Delete de `AiFeature` no marketplace | Nice-to-have |
| P-36 | Railway worker execução | **Ação humana** — usar `docs/DEPLOY_Railway_Worker.md` (~30min-2h) |
| P-37 | Cobertura hooks P-35 (dispatch + ai-usage) | ~4h — chip Sprint 16 |
| P-38 | Cobertura worker duration queues.ts | ~2h — depois de P-36 humano |
| P-39 | Fixture Clerk mock QA/dev local | ~1h |
| P-40 | Conflito .eslintrc worktree | ~30min |
| P-41 | Baseline testes desatualizado CLAUDE.md | ~15min |

**Ações humanas pendentes (você não faz):**
- P-36 subir Railway
- P-25 Fred decide rollout produção
- Task #22 e #23 pendentes: Fred valida P-08 a P-12 em browser + testar IA end-to-end

**Sugestão de próximo cycle:** chip "housekeeping" combinando P-41 + P-40 + P-39 (~2h, docs+config, escopo isolado). Depois pensar em P-37+P-38 como bloco Sprint 16.

## 4. Ações humanas críticas ainda em aberto

- **Railway worker deploy** (P-36) — 30min-2h. `docs/DEPLOY_Railway_Worker.md` tem passo-a-passo
- **Task #22** — Fred valida visualmente P-08 a P-12 no browser
- **Task #23** — Testar IA end-to-end após créditos Anthropic

## 5. Regras críticas descobertas nesta sessão (LEIA)

### 5.1. QA automation obrigatório após merge
Ver [Metodologia §9.4 e §9.5](Metodologia_Desenvolvimento_Venzo.md). Template canônico do prompt em §9.5. Você não pergunta se spawna — spawna. Exceções raras: docs-only, tooling/infra sem runtime, config declarativa — justificar por escrito.

### 5.2. Nunca parsing de secrets
`awk`, `sed`, `hexdump`, `xxd` em linhas que contêm secret = incidente de segurança. Use **só** `grep -q` com padrão âncora + echo constante ("ok" / "não ok"). Ver [feedback_never_parse_secrets.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/feedback_never_parse_secrets.md).

### 5.3. Merges e worktrees
- Trabalhe sempre na paterna (`/Users/fredmarqueziniyahoo.com.br/Claude/crm-app`) para merges e commits em main
- Worktrees `.claude/worktrees/*` são pra chips — não confunda HEAD delas com main
- Antes de mergir, sempre verificar `pwd && git rev-parse HEAD && git rev-parse main` pra evitar merge em worktree por engano (aconteceu 2x nesta sessão)

### 5.4. Chip closure checklist obrigatório em todo spawn
5 itens (Metodologia §3.1-3.5). Item 4 (Roteiro QA) é o novo. Nenhum chip fecha sem os 5 satisfeitos ou justificados.

## 6. Comandos úteis pra retomar

```bash
# Estado do repo
cd /Users/fredmarqueziniyahoo.com.br/Claude/crm-app
git log --oneline -10
git status

# Testes
npm test              # deve dar 715 passing / 0 failing / 168 skipped com env real
npx tsc --noEmit      # zero
npm run lint          # zero (na paterna)

# Ver worktrees ativas (chips)
git worktree list
for b in $(git branch --format='%(refname:short)' | grep '^claude/'); do
  count=$(git log --oneline main..$b 2>/dev/null | wc -l | tr -d ' ')
  if [ "$count" != "0" ]; then echo "$b: $count commits ahead"; fi
done

# Validar app em produção
curl -sS https://crm-app-pi-eight.vercel.app/api/v1/health

# Dev local
rm -rf .next && npm run dev
```

## 7. Referências rápidas

- **Metodologia:** [Metodologia_Desenvolvimento_Venzo.md](Metodologia_Desenvolvimento_Venzo.md) — 574 linhas, fluxo canônico, checklist, antipatterns
- **Roteiro QA:** [Roteiro_QA_Homologacao_Staging.md](Roteiro_QA_Homologacao_Staging.md) — 691 linhas, 31 cenários
- **Backlog vivo:** [Backlog_Pos_MVP.md](Backlog_Pos_MVP.md) — P-01 a P-41
- **QA report:** consulta relatório recente no chat da sessão anterior (não persistiu em arquivo — chip QA por design só reporta)
- **CLAUDE.md:** raiz — instruções permanentes + changelog Sprints 0-15E
- **Memórias novas 2026-07-04:**
  - [feedback_chip_qa_homologacao.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/feedback_chip_qa_homologacao.md) — QA automation obrigatório default, template canônico
  - [feedback_never_parse_secrets.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/feedback_never_parse_secrets.md) — proibição parsing secrets

## 8. Próximo passo recomendado

1. **Leia Metodologia_Desenvolvimento_Venzo.md** (10 min)
2. **Perguntar ao Fred:** quer começar por (a) housekeeping P-41+P-40+P-39 (~2h chip único), (b) Sprint 16 hardening bloco P-37+P-38 (~6h), ou (c) outra coisa que não está no radar?
3. **Se seguir com chip:** aplique padrão canônico de prompt (Metodologia §9.1)
4. **Após merge:** spawn automático QA automation (Metodologia §9.4)

## 9. Notas de continuidade

- Sessão anterior foi longa (~3h wall clock, muitos turnos) — chegou ao ponto onde contexto pesava. Handoff limpa tudo
- Fred tá em modo auto — bias to keep going, mas se em dúvida sobre decisão grande (nova sprint, breaking change, ação humana crítica), **pergunta**
- Task list herdada tem 41 entradas — a maioria fechada. Recomendo criar novo tracking cleanup ou reset em task 42+

---

**Última atualização:** 2026-07-04 fim da sessão
**Próximo checkpoint recomendado:** quando housekeeping fechar OU no meio de próximo sprint
