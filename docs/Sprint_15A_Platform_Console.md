# Sprint 15A — Platform Console (Super Admin Operacional)

Pré-requisito de **operação** — necessário pra operar o Venzo como
produto desde o primeiro cliente. Não dá pra escalar suporte/billing
sem isso.

Esforço estimado: **5–7 dias** (puramente backend + UI; sem novas
features de domínio).

---

## Decisão arquitetural — `PLATFORM_OWNER` em vez de `SUPER_ADMIN`

### Por que renomear

O enum `UserRole` atual inclui `SUPER_ADMIN` ao lado de `ADMIN`,
`DIRETOR_*`, `GESTOR`, `ANALISTA`, `PARCEIRO`. Todos esses **outros**
roles são contextuais ao tenant — alguém é `ADMIN` do tenant X, não
"ADMIN da plataforma". Misturar `SUPER_ADMIN` no mesmo enum cria
confusão conceitual:

- "Esse usuário é SUPER_ADMIN **do tenant**?" — não, é da plataforma
- Permissions matrix de rbac.ts ficam confusas
- Possível bug futuro: alguém promove user pra SUPER_ADMIN dentro do
  tenant achando que vai ter "todas as permissões do tenant", mas
  na verdade vai ter **acesso cross-tenant**

### Nova taxonomia

| Enum atual | Migrado pra | Onde fica |
|---|---|---|
| `SUPER_ADMIN` (rename) | `PLATFORM_OWNER` | Enum **separado** `PlatformRole` (não o `UserRole` de tenant) |
| `ADMIN` | `ADMIN` | UserRole — admin do tenant |
| `DIRETOR_*` | `DIRETOR_*` | UserRole |
| ... etc | ... | UserRole |

**Por que não criar tabela nova:** Fred sugeriu — em vez de
`tenant_membership_super_admin`, usar `users.tenantId = null` +
`users.platformRole = 'PLATFORM_OWNER'` como discriminador.

Mais limpo, menos surface de bug, e o Prisma extension já tem
`runAsSystem()` que bypassa filtro de tenant — só estender pra
detectar `tenantId IS NULL AND platform_role IS NOT NULL` como
identidade legítima.

### Migration 0016_platform_owner

```sql
-- Novo enum
CREATE TYPE "PlatformRole" AS ENUM ('PLATFORM_OWNER', 'PLATFORM_SUPPORT');

-- users ganha colunas opcionais
ALTER TABLE users
  ADD COLUMN platform_role "PlatformRole",
  ALTER COLUMN tenant_id DROP NOT NULL;

-- CHECK: ou é user de tenant OU é platform user, nunca os dois
ALTER TABLE users ADD CONSTRAINT users_tenant_or_platform_check
  CHECK (
    (tenant_id IS NOT NULL AND platform_role IS NULL) OR
    (tenant_id IS NULL AND platform_role IS NOT NULL)
  );

-- Migração: SUPER_ADMIN → PLATFORM_OWNER + tenant_id = NULL
-- (zero rows hoje porque SUPER_ADMIN não foi atribuído na prática,
-- mas o script trata o caso por segurança)
UPDATE users
  SET platform_role = 'PLATFORM_OWNER', tenant_id = NULL
  WHERE role = 'SUPER_ADMIN';

-- Remover SUPER_ADMIN do enum UserRole
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'DIRETOR_COMERCIAL', 'DIRETOR_OPERACOES',
  'GESTOR_COMERCIAL', 'GESTOR_OPERACOES', 'ANALISTA', 'PARCEIRO');
ALTER TABLE users ALTER COLUMN role TYPE "UserRole" USING role::text::"UserRole";
DROP TYPE "UserRole_old";

-- Índice composto pra detectar Platform Users rapidamente
CREATE INDEX users_platform_role_idx ON users (platform_role) WHERE platform_role IS NOT NULL;

-- RLS: tabelas continuam com policy tenant_id = current_tenant_id();
-- Platform users acessam via runAsSystem() que SETA current_tenant_id
-- pra UUID alvo durante impersonação, ou bypassa em queries cross-tenant
```

### Estender `runAsSystem` + Prisma extension

```ts
// src/server/db/tenant-context.ts
export const SYSTEM_TENANT_SENTINEL = '__system__';

// NOVO sentinel pra Platform Owner — comporta-se como system mas
// com identidade atribuível (audit_logs.user_id preenchido)
export const PLATFORM_TENANT_SENTINEL = '__platform__';

export function runAsPlatform<T>(
  platformUserId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(
    { tenantId: PLATFORM_TENANT_SENTINEL, userId: platformUserId, role: 'PLATFORM_OWNER' },
    fn,
  );
}
```

```ts
// src/server/db/client.ts — extension reconhece os dois sentinels
if (tenantId === SYSTEM_TENANT_SENTINEL || tenantId === PLATFORM_TENANT_SENTINEL) {
  return query(args); // bypass de injeção tenant
}
```

---

## Middleware + roteamento

### `/platform/*` — rotas exclusivas Platform Owner

```ts
// src/middleware.ts (extensão do que já existe)
const PLATFORM_PATHS = ['/platform(.*)', '/api/platform(.*)'];

if (PLATFORM_PATHS.some(matches)) {
  const claims = auth.sessionClaims as { public?: { platformRole?: string } };
  if (claims?.public?.platformRole !== 'PLATFORM_OWNER') {
    return NextResponse.redirect(new URL('/', req.url));
  }
  // Não inject x-tenant-id — Platform users não têm tenant ativo
  const headers = new Headers(req.headers);
  headers.set('x-platform-user-id', auth.userId);
  headers.set('x-platform-role', claims.public.platformRole);
  return withHeaders(NextResponse.next({ request: { headers } }));
}
```

### Clerk JWT template — adicionar `platformRole`

```json
{
  "public": {
    "tenantId": "{{user.public_metadata.tenantId}}",
    "role": "{{user.public_metadata.role}}",
    "platformRole": "{{user.public_metadata.platformRole}}"
  }
}
```

---

## Telas e funcionalidades

### `/platform/dashboard` — visão geral

Cards no topo (Server Components com queries em `runAsPlatform`):

| Card | Conteúdo | Query |
|---|---|---|
| **Tenants** | `count(tenants) WHERE deleted_at IS NULL` + breakdown por plano (TRIAL/STARTER/PRO/ENTERPRISE) | `SELECT plan, count(*) FROM tenants GROUP BY plan` |
| **MRR** | Soma de subscriptions ACTIVE convertida em R$ via `priceIdToPlan` | `SELECT plan, status FROM billing_subscriptions WHERE status = 'ACTIVE'` |
| **Trial → Conversion 30d** | % de tenants que viraram ACTIVE no mês | derivado de `billing_events` |
| **Tokens IA mês corrente** | `sum(tokens_input + tokens_output) FROM ai_usage_logs WHERE created_at >= date_trunc('month', now())` | `ai_usage_logs` agregado |
| **Privacy Requests pendentes** | `count WHERE status IN (PENDING, IN_PROGRESS)` cross-tenant | `data_subject_requests` |
| **Trials expirando em 7d** | `count(tenants) WHERE trial_ends_at BETWEEN now() AND now() + 7d AND subscription_status = 'TRIALING'` | `tenants` |

Gráfico de série temporal abaixo: tenants ativos / MRR / tokens últimos 90 dias.

### `/platform/tenants` — CRUD de tenants

| Coluna da tabela | Conteúdo |
|---|---|
| Nome / Slug | Link pro detalhe |
| Plano | Badge (TRIAL/STARTER/PRO/ENTERPRISE) |
| Status | ACTIVE / TRIALING / PAST_DUE / CANCELED |
| Trial ends | Data + ⚠ se < 7 dias |
| Users | count |
| Opps | count |
| Última atividade | max(updated_at) de qualquer entidade |
| Ações | Ver / Impersonar / Suspender |

Botões:
- **+ Novo tenant** — modal com nome, slug, razão social, CNPJ, plano inicial, email do primeiro admin (envia invite Clerk)
- **Suspender** — soft delete + flag `suspended_at` em tenant; usuários do tenant veem banner "Conta suspensa, contate suporte" no AppShell

### `/platform/tenants/[id]` — detalhe do tenant

Tabs:

1. **Visão Geral** — todos os campos + métricas de uso (users count, opps count, contracts ativos, MRR contribuído, tokens IA mês)
2. **Membros** — lista de users com role, last_login, status (active/disabled)
3. **Billing** — sub Stripe + histórico de eventos (`billing_events`)
4. **Audit Log** — `audit_logs` filtrados por `tenant_id`
5. **Configurações** — toggle de feature flags Unleash override pra este tenant

Botões: Impersonar, Suspender, Exportar dados (LGPD-style), Excluir definitivamente (com 2-step confirm).

### `/platform/impersonate` — impersonação

Fluxo:

1. Platform Owner escolhe tenant + role-alvo (ex: admin do tenant X)
2. Sistema gera **session token Clerk** com `public.tenantId = X`,
   `public.role = ADMIN`, e **metadata especial** `impersonatedBy = platformUserId`
3. Redirect pra `/dashboard` — Platform Owner agora vê a app como Admin do tenant X
4. **Banner persistente vermelho** no topo: "Modo impersonação: Acme Tecnologia.
   Encerrar impersonação"
5. **Audit log de toda ação** durante impersonação:
   - `audit_logs.user_id = userIdImpersonado` (admin do tenant, mantém integridade)
   - `audit_logs.metadata.impersonated_by = platformUserId` (rastreabilidade legal)
   - `audit_logs.metadata.impersonation_session_id = uuid` (correlação)
6. **Encerrar** revoga session, redirect pra `/platform/tenants/[id]`

**Importante:** Impersonação **NÃO pode** mudar dados sem trace.
Toda mutação durante impersonação grava `impersonated_by` no audit
— se cliente reclamar "alguém alterou X sem minha autorização", logs
mostram exatamente qual Platform Owner fez.

### `/platform/audit` — audit log cross-tenant

Lista cronológica de todos os `audit_logs` do sistema, com:
- Filtros: tenant, ação, ator (user_id ou platform_user_id), período
- Coluna especial **"Impersonação"** marcada se `metadata.impersonated_by` presente
- Export CSV pra forense

### `/platform/privacy` — privacy requests centralizado

Substitui `/admin/privacy` pra Platform Owner — fila de **todos** os
pedidos LGPD cross-tenant, com mesmo workflow (Processar/Rejeitar)
mas vendo todos os tenants de uma vez.

`/admin/privacy` continua existindo pra Admin do tenant (vê só do
próprio tenant). Não conflita — é a mesma tabela com filtro diferente.

### `/platform/feature-flags` — Unleash management

UI sobre Unleash API:
- Lista de feature flags ativas
- Por flag: lista de tenants com override (enabled/disabled)
- Botões: enable/disable global, override pra tenant específico

Substitui chamadas manuais no painel do Unleash.

---

## Procedures tRPC

Novo router `platformRouter` em `src/server/trpc/routers/platform.ts`,
**fora** do `protectedProcedure` (que exige tenant). Usa novo
`platformProcedure`:

```ts
// src/server/trpc/trpc.ts
const enforcePlatform = t.middleware(({ ctx, next }) => {
  if (ctx.platformRole !== 'PLATFORM_OWNER') {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return next({ ctx: { ...ctx, platformUserId: ctx.platformUserId! } });
});

export const platformProcedure = t.procedure.use(mapErrors).use(enforcePlatform);
```

Procedures:

| Endpoint | Função |
|---|---|
| `platform.dashboard` | métricas agregadas dos cards |
| `platform.tenants.list` | lista paginada de tenants |
| `platform.tenants.byId` | detalhe |
| `platform.tenants.create` | cria tenant + invita primeiro admin via Clerk |
| `platform.tenants.suspend` / `unsuspend` | soft toggle |
| `platform.tenants.delete` | hard delete (cascata + anonimização) |
| `platform.impersonate.start` | gera session token + audit start |
| `platform.impersonate.end` | revoga session + audit end |
| `platform.audit.list` | cross-tenant audit log |
| `platform.audit.export` | CSV |
| `platform.privacy.list` | cross-tenant pedidos LGPD |
| `platform.privacy.process` / `reject` | reusa serviço existente |
| `platform.featureFlags.list` / `set` | wrapper Unleash |

Toda procedure roda em `runAsPlatform(ctx.platformUserId, () => ...)`.

---

## Setup do primeiro Platform Owner

Como criar o primeiro `PLATFORM_OWNER`?

**Script seed:** `prisma/seed-platform.ts` que aceita env vars:
```bash
PLATFORM_OWNER_EMAIL=marquezinifred@gmail.com \
PLATFORM_OWNER_CLERK_ID=user_3FkD... \
npx tsx prisma/seed-platform.ts
```

Cria um user em `users` com `tenantId = NULL` + `platformRole = PLATFORM_OWNER`
+ `clerkId = <id Clerk>`. Próximas instâncias podem usar a UI:
`/platform/admins` (lista) com botão "+ Add Platform Owner" — só
visível pra Platform Owners existentes.

---

## Testes

- Unit: `platform-rbac.test.ts` — Platform user acessa, tenant user é negado
- Unit: `runAsPlatform.test.ts` — bypassa injection de tenant
- Unit: `impersonation-audit.test.ts` — audit preserva `impersonated_by`
- Integration: `platform-tenants.test.ts` — CRUD completo
- E2E: login como Platform Owner → criar tenant → impersonar → executar ação → ver no audit

---

## Critérios de aceite

- ✅ Migration `0016_platform_owner` aplicada — `users.platformRole` +
  `users.tenantId` nullable + CHECK constraint
- ✅ `SUPER_ADMIN` removido do enum `UserRole`; users existentes
  migrados pra `PLATFORM_OWNER` + `tenantId = NULL`
- ✅ `runAsPlatform(userId, fn)` disponível + reconhecido pelo
  Prisma extension
- ✅ Clerk JWT template inclui `public.platformRole`
- ✅ Middleware bloqueia `/platform/*` se `platformRole !== 'PLATFORM_OWNER'`
- ✅ 7 telas implementadas: dashboard, tenants list, tenants detail
  (5 tabs), impersonate flow, audit cross-tenant, privacy
  cross-tenant, feature-flags
- ✅ Impersonação: banner vermelho persistente; `audit_logs.metadata.impersonated_by`
  preenchido em toda mutação
- ✅ Script `prisma/seed-platform.ts` cria primeiro Platform Owner
- ✅ 262 + ≥ 12 novos testes passando, lint zero, type-check zero

## NÃO fazer

- Telemetria de IA (vai pro Sprint 15B)
- AI Marketplace catálogo (Sprint 15B)
- Tenant Health Score (Sprint 15B)
- Pipeline de trials/onboarding próprio (Sprint 15B)
- Broadcast/comunicação com tenants (Sprint 15B)
