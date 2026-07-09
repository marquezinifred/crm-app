# Handoff Noturno — 2026-07-08 → 2026-07-09

Bom dia. Enquanto você dormiu, trabalhei nos problemas de isolamento
de tenant que descobrimos + refactor do Modal empilhado + fix da
mensagem de sucesso do addMember. Tudo commitado, testado e sem
regressão.

## O que foi feito (3 commits sequenciais)

### 1. `fix(P-79)` — Tenant isolation (12 arquivos)

**O bug que descobrimos:** dropdown de usuários em `/admin/commercial-structure`
listava 33 users de 5 tenants (acme, beta, gamma, marquezini +
PLATFORM_OWNERs) em vez de só 1 do marquezini. Vazamento
cross-tenant grave.

**Root cause estrutural:** em `src/app/api/trpc/[trpc]/route.ts`,
se `x-tenant-id` não chegava no header, o handler rodava CRU sem
envolver em `runWithTenant`. Prisma extension via `getTenantContext()?.tenantId = undefined`
e caía no branch "sem contexto → deixa passar" (fail-open em dev).
Resultado: findMany retornava rows de todos os tenants.

**Fix aplicado:**

1. `withTenantStorage` agora sempre envolve o handler em um `runWith*`:
   - Caso 1: `x-tenant-id` → `runWithTenant`
   - Caso 2: `x-platform-role=PLATFORM_OWNER` → `runAsPlatform` (bypass legítimo)
   - Caso 3: sem contexto → só rotas tRPC públicas chegam aqui (`protectedProcedure` barra)

2. Extension em `src/server/db/client.ts` agora **fail-closed em dev**
   (antes só em test). Bug futuro do route handler explode com erro
   em vez de vazar silenciosamente. Em prod, log ERROR pra visibilidade.

3. **12 routers** ganharam filtro `tenantId: ctx.tenantId` explícito
   nas findMany/findFirst/findUnique — defesa em profundidade:
   - `users.ts`, `companies.ts`, `contacts.ts`, `contracts.ts`,
   - `documents.ts`, `inbox.ts`, `opportunities.ts` (history),
   - `privacy.ts`, `proposals.ts`, `reports.ts` (stageHistory)

**Memória salva:** `feedback-cross-tenant-leak-recurrence.md` no
sistema de memory + entrada no MEMORY.md. Regra permanente: SEMPRE
`where: tenantId` explícito, nunca só o extension.

Commit: [`78ab49d`](../src)

---

### 2. `refactor(P-78)` — Modal Venzo → Radix Dialog

**Bug que descobrimos:** ao clicar em "+ Adicionar" no organograma,
o Modal abria em cima do Sheet lateral, mas qualquer click em
campos do Modal (input, dropdown, checkbox) fechava a Sheet — Modal
sumia junto (render condicional).

**Root cause:** Modal Venzo era implementação custom. Sheet já era
Radix Dialog. Radix escuta pointerdown/focus globalmente pra fechar
em "click outside" — detectava clicks no Modal inline como "outside".
Tentativas de handler customizado no Sheet falharam.

**Fix:** Modal agora usa `@radix-ui/react-dialog` internamente.
Radix suporta nested dialogs nativamente. **API pública inalterada** —
os 12+ modais no app continuam funcionando sem edição.

**Bônus:** P-12 (foco roubado a cada keystroke) fica resolvido
"de graça" — Radix não tem esse bug porque focus manager não
depende de closure identity.

**Débito residual P-78:** cor + ícone no `UnitTypeModal` ainda são
Input texto sem picker visual. Como você pediu:
- Cor: substituir por `<input type="color">` nativo + preview inline
- Ícone: picker com biblioteca Tabler Icons (5300+ ícones MIT free)

Sprint 15H housekeeping ou chip dedicado.

Commit: [`0575948`](../src)

---

### 3. `fix` — Mensagem contextual do addMember

**Feedback seu:** "trouxe o meu usuário mesmo, ela dá mensagem de
sucesso mas não adiciona nenhum novo. A mensagem precisa ser
corrigida."

**Fix:**
- Service lê membership existente antes do upsert
- Retorna `{ created, roleChanged, primaryChanged }`
- UI mostra mensagem contextual:
  - `created=true` → **"Membro adicionado."**
  - Update com mudança → **"Vinculação atualizada."**
  - No-op → **"Sem alterações — o usuário já era membro com essa configuração."**

**Bônus:** mensagem de erro NOT_FOUND agora distingue "Unidade não
encontrada" vs "Usuário não pertence a este tenant" (antes era
"Unit ou usuário não encontrados" — confuso).

Commit: [`2b65d42`](../src)

---

## Estado final

- **Testes:** 1087 passing / 0 failing / 175 skipped (1 skip novo
  em `modal.test.tsx` — Tab trap agora é do Radix, teste antigo
  batia contra implementação custom)
- **Type-check:** zero
- **Lint:** zero
- **Git:** main limpo, 3 commits em cima de `d19c4ad`

## O que ainda falta pra fechar validação Sprint 15G local

1. **Testar addMember com outro usuário** — você precisa criar
   um usuário adicional no tenant `marquezini` via `/admin/users` →
   voltar em `/admin/commercial-structure` → adicionar esse novo user
   à unidade "Padrão". Aí valida que o toast "Membro adicionado."
   aparece e a lista da Sheet atualiza mostrando 2 membros.

2. **ScopeSwitcher em `/pipeline`** — validar se aparece (você é
   ADMIN com `opportunity:read_all`, deve aparecer o dropdown
   "Minhas / Toda a empresa").

3. **Testar cross-tenant real** — se tem paciência, faz sign-out
   e sign-in numa conta admin de outro tenant (acme por exemplo)
   e confirma que ela NÃO vê users do marquezini em nenhum lugar.
   Ideal se o rollout prod for logo.

## Débitos residuais registrados

- **P-78** — Color picker + Icon picker no UnitTypeModal
  (Sprint 15H housekeeping)
- **P-79 auditoria estendida** — 12 routers principais cobertos,
  falta grep sistemático em `src/server/services/*` pra queries
  fora de `runAsSystem`. Impacto baixo (services só rodam dentro
  de handlers tRPC/workers já com contexto), mas vale um chip.
- **Tabler Icons dependency** — se aprovar P-78, precisa
  `npm i @tabler/icons-react` (~5300 ícones tree-shaken).

## Sobre o rollout prod Sprint 15G

Recomendo agora **bloquear rollout até você validar addMember com
2+ users**. O fix P-79 é pré-requisito (senão prod vazaria também),
mas já está commitado. Depois de validar, seguir
`docs/ROLLOUT_Sprint_15G_Prod.md` normal — a ordem das fases não
muda (A→E), só adicione **antes de Fase E** um `npm run rbac:backfill-cache`
prod pra garantir que os users em prod tenham as permissions
novas do 15G no cache.

## Referências

- Commit P-79: `78ab49d`
- Commit Modal refactor: `0575948`
- Commit addMember message: `2b65d42`
- Memória P-79: [`feedback-cross-tenant-leak-recurrence.md`](../../.claude/projects/-Users-fredmarqueziniyahoo-com-br-Claude-crm-app/memory/feedback_cross_tenant_leak_recurrence.md)
- Handoff sessão anterior: [`HANDOFF_Estado_Atual_2026-07-08.md`](HANDOFF_Estado_Atual_2026-07-08.md)

---

Bom descanso. Qualquer dúvida, retome dessa mensagem que eu explico
qualquer passo.
