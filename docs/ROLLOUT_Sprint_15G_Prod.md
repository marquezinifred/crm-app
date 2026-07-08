# Rollout Sprint 15G — Produção

**Data:** 2026-07-08 · **Autor:** sessão paterna · **Duração estimada:** ~45min ativo + 24-48h monitoramento

Guia executável pra rollout do Sprint 15G (Estrutura Comercial e Visibilidade
Hierárquica) em produção. Backend das 3 fases mergido e QA verde. Kill-switch
runtime `SALES_STRUCTURE_ENABLED` permite ativação gradual com rollback trivial.

**Pré-requisitos confirmados:**
- ✅ Sprint 15G Fases 1+2+3 mergidas em main (`eac77c6` → QA verde `c872df7`)
- ✅ Baseline testes 1055/0/174 verde (ver `docs/qa-sessions/auto-report-2026-07-07-15g-fase-3.md`)
- ✅ Migration 0031 com backfill A1 idempotente (unidade "Padrão" por tenant + todos users como MEMBER)
- ✅ Script `15g:migrate-permissions` idempotente pra migrar overrides `read_others` → `read_team`
- ✅ Kill-switch `SALES_STRUCTURE_ENABLED` com consumer runtime único em `sales-structure.service.ts:71`

**⚠️ Sequência obrigatória — NUNCA pular etapas.**

---

## Fase A — Preparação (5min)

### A.1. Verificar estado pré-rollout do prod

```bash
# Health check
curl -sS https://crm-app-pi-eight.vercel.app/api/v1/health
# Esperado: {"status":"ok","checks":{"app":"ok","db":"ok"}}

# Baseline de env vars kill-switch já setadas em prod
vercel env ls production | grep -E "SALES_STRUCTURE|RBAC_GRANULAR|MULTI_AI"
# Esperado: 
#   RBAC_GRANULAR_ENABLED  (true) — Sprint 15E
#   MULTI_AI_ENABLED       (false) — Sprint 15F pendente rollout
#   SALES_STRUCTURE_ENABLED: NÃO deve estar setada ainda
```

- [ ] Health prod OK
- [ ] `SALES_STRUCTURE_ENABLED` **NÃO** listada (default `false` do schema vai ser aplicado)

### A.2. Backup de segurança (Neon)

Neon já tem PITR (Point-in-Time Recovery) de 7 dias no plano free. Confirmar
snapshot recente clicando em Neon Console → seu projeto prod → Branches → main
→ "Restore point". Se aparecer data hoje, OK.

- [ ] Neon PITR ativo (janela ≥ 7 dias visível)

---

## Fase B — Deploy código com flag OFF (10min)

**Comportamento esperado:** kill-switch `SALES_STRUCTURE_ENABLED=false` (default do
schema) faz `resolveOpportunityScope` cair no path pré-15G (binário
`read_team|read_all → ALL`, senão `OWN`). Runtime **idêntico** ao main
pré-Sprint 15G. Zero mudança de comportamento pro usuário.

### B.1. Deploy

```bash
cd /Users/fredmarqueziniyahoo.com.br/Claude/crm-app
git log --oneline -1
# Esperado: c872df7 (ou HEAD do main)

vercel --prod
# Anotar deployment ID (dpl_...) na resposta
```

- [ ] Deploy prod completou sem erro
- [ ] Deployment ID anotado: `dpl_______________`

### B.2. Smoke test pós-deploy

```bash
curl -sS https://crm-app-pi-eight.vercel.app/api/v1/health
# Esperado: mesmo JSON de A.1, dbLatencyMs razoável (~1-2s)
```

- [ ] Health OK
- [ ] Login manual em `https://crm-app-pi-eight.vercel.app/sign-in` OK
- [ ] `/pipeline` carrega sem erro (kill-switch OFF preserva runtime)
- [ ] `/reports/funnel` carrega sem erro

**Se qualquer smoke falhar:** rollback imediato — `vercel promote <deployment_anterior>`.
Anotar erro e não prosseguir.

---

## Fase C — Aplicar migration 0031 (5min)

**⚠️ Migration inclui backfill A1**: cria 1 unit "Padrão" por tenant existente
+ associa TODOS os users ativos como MEMBER (ou MANAGER se
ADMIN/DIRETOR_*/GESTOR). Idempotente via `ON CONFLICT DO NOTHING`.

### C.1. Aplicar migration

```bash
# Neon prod connection string vem do Vercel env
vercel env pull .env.production.local
export DATABASE_URL=$(grep '^DATABASE_URL=' .env.production.local | cut -d'=' -f2- | tr -d '"')

# Verificar que está apontando pra prod (não staging/dev)
echo "$DATABASE_URL" | head -c 60
# Esperado: começar com "postgresql://..." e conter "neon" + "pooler" + região prod

# Aplicar migration
npx prisma migrate deploy
# Esperado: "Applied migration 0031_estrutura_comercial"
```

- [ ] Migration 0031 aplicada sem erro

### C.2. Validar backfill A1

```bash
# Conta unidades e members criados
npx prisma studio --port 5555  # abre GUI no browser
# OU via psql/pgcli direto:

psql "$DATABASE_URL" -c "
SELECT
  (SELECT COUNT(*) FROM sales_unit_types) AS types,
  (SELECT COUNT(*) FROM sales_units) AS units,
  (SELECT COUNT(*) FROM sales_unit_members) AS members,
  (SELECT COUNT(*) FROM tenants WHERE deleted_at IS NULL) AS tenants_active,
  (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND active = true) AS users_active
;
"
```

- [ ] `types` = número de tenants ativos (1 tipo "Unidade" por tenant)
- [ ] `units` = número de tenants ativos (1 unit "Padrão" por tenant)
- [ ] `members` = número de users ativos (todos vinculados)

### C.3. Limpar env local

```bash
rm .env.production.local
unset DATABASE_URL
```

- [ ] Arquivo removido (segurança)

---

## Fase D — Backfill de permissions (5min)

Script migra overrides individuais existentes de `opportunity:read_others` (Sprint
15E) → `opportunity:read_team`. Sem esse backfill, users com override individual
perderiam a visão de equipe quando kill-switch ligar (breaking change).

### D.1. Rodar script

```bash
# Reusa connection prod
vercel env pull .env.production.local
export DATABASE_URL=$(grep '^DATABASE_URL=' .env.production.local | cut -d'=' -f2- | tr -d '"')

npm run 15g:migrate-permissions
# Esperado: log detalhado — quantos overrides encontrados, migrados, cache invalidado

# Idempotência check (rodar 2x, segunda deve dizer "nada a migrar")
npm run 15g:migrate-permissions
# Esperado: "0 users affected — nada a migrar"

rm .env.production.local
unset DATABASE_URL
```

- [ ] Primeira execução migrou overrides existentes (ou reportou zero se ninguém tinha override individual)
- [ ] Segunda execução reportou "nada a migrar" (idempotência confirmada)
- [ ] Env local limpo

---

## Fase E — Ativar kill-switch gradualmente (24-48h)

**Estratégia:** flag `true` primeiro só monitorar 24h; se estável, deixar
ativo definitivamente. Rollback = flag `false` sem redeploy.

### E.1. Ativar flag em prod

Via Vercel Dashboard:

1. https://vercel.com → seu projeto → Settings → Environment Variables
2. Add New:
   - **Key:** `SALES_STRUCTURE_ENABLED`
   - **Value:** `true`
   - **Environments:** `Production` (marque só produção; preview fica false)
3. Save

Sem redeploy necessário — Vercel Functions leem env var no cold start.
Efetivo em ~2min pra novas requests. **Sessions existentes preservam runtime
até próximo refresh.**

- [ ] Flag setada como `true` em Production
- [ ] Timestamp de ativação anotado: `_______________`

### E.2. Smoke test com flag ativa

Login como Fred (`fredmarquezini@hotmail.com`, DIRETOR_COMERCIAL — usa
memory `crm-app-setup-state.md`):

- [ ] `/pipeline` carrega opps normalmente
- [ ] `/reports/funnel` carrega dados
- [ ] `/reports/performance-by-owner` mostra só própria linha (regra Sprint 5 preservada)
- [ ] Se der 500 em qualquer rota → rollback E.1 (flag `false`) e investigar

### E.3. Monitoramento inicial (primeiras 2h)

```bash
# Sentry (se ativo)
# https://sentry.io → seu projeto → Issues → filtrar por "sales-structure"

# Vercel logs em tempo real
vercel logs --follow

# Filtrar por erros
vercel logs --follow | grep -i "error\|500\|SalesStructureService\|scope"
```

- [ ] Zero erros novos em Sentry
- [ ] Zero 500 nos logs Vercel
- [ ] Latência p95 estável (comparar com pré-rollout)

### E.4. Monitoramento 24-48h

Após 24h ativa, revisar:

```bash
# Logs auditoria (audit_logs pra scope)
psql "$DATABASE_URL" -c "
SELECT COUNT(*), action FROM audit_logs
WHERE at >= NOW() - INTERVAL '24 hours'
  AND action LIKE 'sales_unit%'
GROUP BY action ORDER BY COUNT(*) DESC;
"
```

- [ ] Zero rows retornadas (ninguém criou/mexeu estrutura ainda — Fase 4 UI vai
      permitir isso). Comportamento esperado sem UI.
- [ ] Métrica de uso pipeline/reports estável (Vercel Analytics ou GA)

Após 48h estável:
- [ ] Marcar rollout como **FECHADO** neste doc + `docs/HANDOFF_Estado_Atual_YYYY-MM-DD.md`

---

## Rollback (se algo der errado)

### Rollback rápido (kill-switch OFF)

Via Vercel Dashboard:
1. Settings → Environment Variables → `SALES_STRUCTURE_ENABLED` → Edit
2. Value: `false`
3. Save

Efetivo em ~2min. Runtime volta ao path pré-15G (binário
`read_team|read_all`). Dados no DB preservados — ao religar `true`, resume
comportamento novo.

### Rollback pesado (revert deploy)

Se código do 15G tiver bug não capturado por QA:

```bash
vercel promote <deployment_id_anterior>
# Deployment ID anterior anotado em Fase B.1
```

**⚠️ Cuidado:** rollback pesado NÃO reverte migration 0031. Tabelas
`sales_unit_types/units/members` continuam no DB, mas código antigo não as
usa. Sem impacto negativo — só ocupa espaço.

### Reverter migration (extremo, raramente necessário)

Se precisar recriar branch Neon do zero:
1. Neon Console → Branches → PITR restore para timestamp pré-Fase C
2. Reapontar Vercel `DATABASE_URL` pro branch restaurado

---

## Sinalização de conclusão

Após 48h estável + smoke tests passando, atualizar:

- [ ] `CLAUDE.md` §Sprint atual — adicionar bloco "Sprint 15G — Estrutura Comercial: ✅ CONCLUÍDO"
- [ ] `docs/HANDOFF_Estado_Atual_YYYY-MM-DD.md` — snapshot pós-rollout
- [ ] `docs/Backlog_Pos_MVP.md` — marcar Sprint 15G Fases 1+2+3 como ✅ DEPLOYADAS
- [ ] Este arquivo — status `✅ FECHADO em YYYY-MM-DD HH:MM`

---

## Referências rápidas

- **QA Fase 3 report:** [auto-report-2026-07-07-15g-fase-3.md](qa-sessions/auto-report-2026-07-07-15g-fase-3.md)
- **Metodologia §11.4** (gate deploy): [Metodologia_Desenvolvimento_Venzo.md](Metodologia_Desenvolvimento_Venzo.md)
- **Backlog Sprint 15G:** [Backlog_Pos_MVP.md](Backlog_Pos_MVP.md) — Fases 1a/1b/2a/2b/3a/3b
- **Kill-switch pattern P-73:** [rbac-kill-switch-runtime.md](../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/rbac-kill-switch-runtime.md)
- **Backfill A1 SQL:** `prisma/migrations/0031_estrutura_comercial/migration.sql`
- **Script backfill A2:** `scripts/15g-migrate-permissions.ts`
