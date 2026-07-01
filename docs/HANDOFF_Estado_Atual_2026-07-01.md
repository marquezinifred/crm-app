# Handoff de sessão — 2026-07-01 (fim do dia)

Snapshot do estado do trabalho na conclusão desta sessão. Complementa (não substitui) o [HANDOFF_Sprints_15B_a_15E.md](HANDOFF_Sprints_15B_a_15E.md) que documenta o trabalho técnico das sprints.

**Propósito:** registro pra próxima sessão do Fred retomar sem ter que reconstruir contexto. Se você é a próxima pessoa (ou próximo Claude), leia esse primeiro.

---

## 1. O que está rodando agora

### Chip único em execução

| Task | Chip ID | Escopo | Estimativa |
|---|---|---|---|
| **Sprint 15E** — RBAC Granular | `task_7965b8c7` | 4 fases (Fundação → 47 procedures → UI + router → Compat + rollout) + buffer | ~10 dias |

Nenhum outro chip paralelo. Se surgir débito novo enquanto Sprint 15E roda, spawnar chip separado — Sprint 15E absorve conflitos via `git pull` entre fases.

### Como monitorar
- Ver commits em `git log --oneline main..claude/*` — o chip cria branch com prefixo `claude/`
- Não spawnar chip novo em Sprint 15D/E — paterna está com Sprint 15E

---

## 2. O que Fred precisa fazer (pendente de humano)

### 2.1. Testes manuais pendentes (task #22 e #23 na task list)

Preparado roteiro detalhado com PO na sessão anterior. Ver mensagens deste dia com **"Roteiro de testes — features recém-entregues"** — 4 blocos:

1. **`/admin/ai` 4 Cards** (P-23 + refino) — 15–20min · 8 variações · crítico pra controle de custo
2. **`/platform/tenants/[id]/ai` drilldown** (P-06) — 10–15min · 6 variações
3. **Inbound Marketing end-to-end** (Sprint 15D) — 25–30min · 8 variações · fluxo completo lead público → oportunidade
4. **Command Palette ⌘K** (P-16) — 5–8min · 9 variações · UX

**Total tempo PO:** ~1h de teste guiado.

### 2.2. Rollout Sprint 15F em produção (P-25)

Migrations 0027 + 0028 aplicadas em **Neon dev** ✅. Falta:
- Aplicar em **Neon prod**
- Ativar `MULTI_AI_ENABLED=true` no Vercel prod pro tenant marquezini
- Monitorar `ai_usage_logs.used_fallback` 3–5 dias
- Expandir 2–3 early adopters Enterprise
- 30d sem regressão → flag global

### 2.3. Decisão sobre débitos bloqueados
- **P-03** Visual baseline — precisa seed E2E + app rodando local (~1.5h quando desbloqueado)
- **P-05** Lighthouse CI — precisa `vars.STAGING_URL` no GitHub Secrets (~3h quando desbloqueado)

Ambos ficam abertos até haver ambiente de staging operacional.

---

## 3. Débitos abertos no backlog (ordem de prioridade)

Consulte [`docs/Backlog_Pos_MVP.md`](Backlog_Pos_MVP.md) — vai até P-26. Estado ao fim de 2026-07-01:

**Fechados nesta sessão (20+):** P-02, P-04, P-06, P-07, P-08, P-09, P-10, P-11, P-12, P-13, P-14, P-15, P-16, P-17, P-19, P-20, P-21, P-22, P-23 (+ refino), P-24, P-26.

**Abertos:**
| ID | Item | Bloqueador |
|---|---|---|
| P-03 | Visual baseline | Depende de seed E2E |
| P-05 | Lighthouse CI | Depende de STAGING_URL |
| P-25 | Rollout Sprint 15F em produção | Fred decide quando |
| **P-27** (implícito, mencionado no chip P-24) | Delete de `AiFeature` no marketplace | Nice-to-have |

**Sprints planejados (não iniciados):**
- Nenhum — Sprint 15E é o último da série. Roadmap Sprints 16+ está em `docs/Backlog_Pos_MVP.md`.

---

## 4. Estado técnico atual

**Baseline testes:** 576 passing / 4 pré-existentes falhando (env vars) / 2 skipped
**Type-check:** zero
**Lint:** zero
**Migrations aplicadas em Neon dev:** até 0029 (Sprint 15D)
**Migration próxima esperada:** 0030 (Sprint 15E — chip vai criar)
**Feature flags ativas no `.env.local`:** `MULTI_AI_ENABLED=true`

**Últimos merges no main (ordem cronológica):**
```
14ea43a  Merge Sprint 15D: Inbound Marketing Pipeline (6 fases)
78c53bc  Merge P-26: PageHeader em 7 rotas fora /admin
6bca825  Merge P-23 refino: Card C fallback + Card D custo
7557496  Merge P-24: form Adicionar Feature em ai-marketplace
+ (série de merges anteriores de P-14 até P-22, Sprint 15F backend, etc.)
```

**Dev server:** rodando local (PID varia — verificar com `pgrep -fl "next dev"`)

---

## 5. Comandos úteis pra retomar

```bash
# Verificar estado
git log --oneline -10
git status
pgrep -fl "next dev"
tail -30 /tmp/next-dev.log | grep -v "theme cache"

# Testes
npm test              # deve dar 576 passing / 4 falhas pré-existentes
npm run lint          # zero
npx tsc --noEmit      # zero

# Restart dev (se precisar)
kill $(pgrep -f "next dev"); sleep 2 && rm -rf .next && npm run dev > /tmp/next-dev.log 2>&1 &

# Ver estado de chips em execução
git branch | grep '^  claude/'
for b in $(git branch --format='%(refname:short)' | grep '^claude/'); do
  count=$(git log --oneline main..$b 2>/dev/null | wc -l | tr -d ' ')
  if [ "$count" != "0" ]; then echo "$b: $count commits"; fi
done

# Aplicar novas migrations quando chegarem
npx prisma migrate deploy
```

---

## 6. Riscos / atenção pra próxima sessão

1. **Se Sprint 15E terminar antes de você voltar:** mergir por fases (não tudo de uma vez) porque são 4 fases lógicas — cada uma deve ser um merge separado pra ficar reviewable. Ver §5.4 da spec 15E pra ordem obrigatória.

2. **Breaking change do 15E:** ANALISTA passa a ver só as próprias opps. **Comunicar** no CLAUDE.md changelog antes de mergir. Se algum tenant específico precisar do comportamento antigo, é override individual.

3. **`RBAC_GRANULAR_ENABLED=false` como default:** manter até validar em staging. Kill-switch pra reverter runtime sem redeploy.

4. **Script de backfill obrigatório:** `scripts/rbac-backfill-cache.ts` roda logo após `migrate deploy`. Sem isso, `permissions.whoHas` retorna vazio pra users que ainda não logaram. Bloqueia notificações inbound.

5. **Merges de conflito CLAUDE.md / Backlog:** virou padrão. Se paterna e chips paralelos escrevem changelog no mesmo lugar, resolver aceitando ambas as adições (concatenar). Testado com sucesso em várias rodadas.

6. **`.env.local` NUNCA commitar:** contém `ANTHROPIC_API_KEY` real. Já está no `.gitignore` — só cuidado se algum chip mexer em `.env.example` por engano.

---

## 7. Referências rápidas

- **Handoff técnico principal:** [`HANDOFF_Sprints_15B_a_15E.md`](HANDOFF_Sprints_15B_a_15E.md) — 431 linhas, cobre 15B → 15F + 15D + 15E + 20 débitos
- **Backlog vivo:** [`Backlog_Pos_MVP.md`](Backlog_Pos_MVP.md) — P-01 a P-26 + Sprints 15D/E + roadmap
- **Spec 15E v3:** [`Sprint_15E_RBAC_Granular.md`](Sprint_15E_RBAC_Granular.md) — 1271 linhas
- **Matriz permissions:** [`permission-matrix.md`](permission-matrix.md) — 65 × 7 células validadas
- **Spec 15F v2:** [`Sprint_15F_IA_Multi_Provider.md`](Sprint_15F_IA_Multi_Provider.md)
- **Spec 15D:** [`Sprint_15D_Inbound_Marketing.md`](Sprint_15D_Inbound_Marketing.md)
- **CLAUDE.md:** raiz do projeto — instruções permanentes + changelog resumido

---

## 8. Fluxo de trabalho estabelecido nesta sessão

Padrão que funcionou bem, pra próxima:

1. **Roles claras** (memory `role-separation.md`): esta sessão-chip = QA/gestor/arquiteto (não escreve código exceto docs). Trabalho de código vai pra paterna ou chip separado spawnado via `spawn_task`.

2. **Chips paralelos ok** — até 5-6 rodam simultâneos sem conflito se áreas são disjuntas. Coordenar via `git pull` antes de mergir.

3. **Backlog como pivô** — cada débito P-XX registrado antes de spawn, marca como ✅ FECHADO após merge. Fonte da verdade.

4. **Auto mode ativo** — Fred autorizou (via `/loop` + auto): bias to keep going. Não perguntar por confirmação em cada decisão de spawn/merge trivial.

5. **PO check-in periódico** — Fred leva pro PO revisar specs antes de disparar sprints grandes. PO pegou 3 bugs críticos no Sprint 15E que foram corrigidos em v3.

---

**Última atualização deste doc:** 2026-07-01 fim do dia
**Próximo checkpoint recomendado:** quando Sprint 15E fechar OU 24h após retomar
