# Runbook — Staging Vercel

URL: `https://crm-app-pi-eight.vercel.app`
Última atualização: 2026-07-04

Runbook enxuto pro PO/tester durante teste guiado. Cobre os problemas
conhecidos que **não são bug do app** — são limitações de staging (Clerk
dev instance, workers desligados, sessão curta) que Sprint 16 vai
endereçar. Se aparecer um sintoma fora dessa lista, print + URL + horário
→ mandar pro Fred.

Guia técnico completo de deploy e reconfig em
[`DEPLOY_Vercel_Guide.md`](DEPLOY_Vercel_Guide.md). Estado da sessão em
[`HANDOFF_Estado_Atual_2026-07-01.md`](HANDOFF_Estado_Atual_2026-07-01.md).

---

## Problemas conhecidos e soluções

### 🟡 Cai em /onboarding após primeiro login (ou fica sem tenant)

Clerk dev instance leva ~30s pra propagar `tenantId` no session token
depois que o webhook atualiza o `public_metadata`.

1. Aguarde 30s e recarregue a página
2. Se persistir, sign out + sign in
3. Se persistir mais que isso, avisar Fred

Não é bug do app. Sprint 16 migra pra Clerk production instance (P-34).

### 🟡 Formulário público inbound salva mas lead não aparece

Workers BullMQ desligados em staging (P-36). Leads inbound entram na
queue Redis mas nada consome. Não vira Opportunity até worker rodar.

- Endpoint `POST /api/v1/inbound/lead` responde 202 normalmente
- `/inbox/prospects` fica vazio mesmo com submissions confirmadas
- Fred precisa rodar `npm run worker` local ou subir Railway/Render

### 🟡 Alertas diários não chegam por email

Mesma raiz de P-36. Job `alerts-scan` está agendado pra 07:00 BRT mas
só dispara se worker BullMQ estiver ativo. Vale pra:

- Alertas de relacionamento (aniversário empresa/contato)
- Alertas de pipeline (data prevista de fechamento)
- Escalonamento de tarefas vencidas
- Renovação de contrato (90/60/30d antes do endDate)

Sprint 16 endereça.

### 🟡 Erro `[tenant-isolation] X.update sem tenantId no payload`

Modelo `X` ainda não está no allowlist do backstop de tenant isolation.
Fred adiciona a `ALLOW_MISSING_TENANT_ON_WRITE` em
`src/server/db/client.ts` e redeploya (~5min).

Não continuar tentando o mesmo fluxo — vai dar o mesmo erro.

### 🟡 "Unable to transform response from server" ao salvar

Sessão Clerk expirou (JWT curto no dev instance). F5 na página. Se
persistir, sign out + sign in. O `session-guard` (P-13) detecta 401 e
recarrega automaticamente, mas se o batch tRPC caiu no formato errado
pode escapar.

### 🟡 Upload de PDF/contrato "desaparece" após uns minutos

Staging usa fallback `/tmp` do serverless — arquivo some após ~1min
entre invocations. Só um S3/R2 configurado persiste (fora de escopo pro
teste inicial). Testar upload é ok, testar acesso ao arquivo depois não.

---

## Fluxos aprovados pra teste

Roteiro completo em
[`HANDOFF_Estado_Atual_2026-07-01.md`](HANDOFF_Estado_Atual_2026-07-01.md)
§2.1 — 4 blocos, ~1h de teste guiado:

1. `/admin/ai` 4 Cards (P-23 + refino) — 15–20min, crítico pra controle
   de custo IA
2. `/platform/tenants/[id]/ai` drilldown (P-06) — 10–15min
3. Inbound Marketing end-to-end (Sprint 15D) — 25–30min, fluxo completo
   lead público → oportunidade (⚠️ afetado por P-36; testar até o 202
   e conferir persistência via `/admin/email-inbound` histórico)
4. Command Palette ⌘K (P-16) — 5–8min

---

## Reportar bugs

Print + URL + horário exato → mandar pro Fred no WhatsApp/Slack.

Se der pra reproduzir, descrever passos exatos (qual botão, qual valor,
o que aconteceu vs o que era esperado). Vercel dashboard tem Runtime
Logs por deploy — Fred consegue rastrear pelo timestamp.
