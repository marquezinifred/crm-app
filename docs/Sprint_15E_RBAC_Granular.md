# Sprint 15E — RBAC Granular (Permissões Configuráveis)

## Objetivo

Refatorar o sistema de roles fixas (`SUPER_ADMIN`, `ADMIN`,
`DIRETOR_*`, `GESTOR`, `GESTOR_INBOUND`, `ANALISTA`, `PARCEIRO`) pra
um modelo de **roles como perfis + overrides individuais de permissão
por user**.

Resolve a dor identificada no Sprint 15D: cada feature nova "que
precisa de um gestor de X" hoje força criação de uma role nova no
enum (proliferação). Após este sprint, novas permissões granulares
(`inbound.assign_prospects`, `reports.financial_view`, etc) ficam em
catálogo configurável.

## Pré-requisito

- ✅ Sprint 15D entregue (introduziu `GESTOR_INBOUND` como caso real
  de role específica que será migrada como permission)

Sem 15D entregue, este sprint perde o caso de uso âncora pra validar
o modelo. Faça 15D primeiro.

## NÃO fazer neste sprint

- Remover roles completamente — roles continuam existindo como
  "perfis padrão" com permissões pré-aplicadas; usuários **podem**
  ainda ser cadastrados com role e nada mais
- Permissão por entidade (row-level — tipo "esse user pode editar
  só essas 5 empresas") — fica como Sprint futuro caso vire necessidade
- UI de delegação temporária (permission expirando em X dias) —
  Sprint futuro
- Custom roles (admin cria role nova com nome livre tipo
  "Coordenador de Eventos") — fica como Sprint futuro

---

## Visão geral do refactor

### Antes (modelo atual)

```ts
// src/lib/auth/rbac.ts
const ROLE_PERMISSIONS: Record<UserRole, Set<Permission>> = {
  ADMIN: new Set([...]),
  GESTOR: new Set([...]),
  GESTOR_INBOUND: new Set([...]),
  ...
};

function hasPermission(role: UserRole, permission: Permission): boolean {
  if (role === 'SUPER_ADMIN') return true;
  return ROLE_PERMISSIONS[role].has(permission);
}
```

### Depois (modelo novo)

```ts
const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, Set<Permission>> = {
  ADMIN: new Set([...]),       // perfis padrão CONTINUAM existindo
  GESTOR: new Set([...]),
  ...
  // GESTOR_INBOUND removido — virou ADMIN + permission override
};

async function hasPermission(
  userId: string,
  permission: Permission,
): Promise<boolean> {
  const user = await getUserWithPermissions(userId);
  if (user.platformRole === 'PLATFORM_OWNER') return true;
  // 1. Override individual (grant ou revoke)
  if (user.permission_overrides[permission] === 'revoked') return false;
  if (user.permission_overrides[permission] === 'granted') return true;
  // 2. Permissão default do role
  return ROLE_DEFAULT_PERMISSIONS[user.role].has(permission);
}
```

### Catálogo de permissões

Novo: tabela `permissions_catalog` ou arquivo estático
`src/lib/auth/permissions-catalog.ts` (mais simples — sem necessidade
de configurar no banco):

```ts
export const PERMISSIONS_CATALOG = [
  // Tenant
  { key: 'tenant.read', label: 'Ver dados do tenant', category: 'tenant' },
  { key: 'tenant.update', label: 'Editar dados do tenant', category: 'tenant' },

  // Users
  { key: 'user.create', label: 'Convidar usuários', category: 'users' },
  { key: 'user.read', label: 'Ver usuários', category: 'users' },
  { key: 'user.update', label: 'Editar usuários', category: 'users' },
  { key: 'user.delete', label: 'Desativar usuários', category: 'users' },
  { key: 'user.grant_permissions', label: 'Conceder permissões individuais', category: 'users' },

  // Catalog
  { key: 'catalog.read', label: 'Ver catálogo de produtos', category: 'catalog' },
  ...

  // Inbound (NOVAS — substituem role GESTOR_INBOUND)
  { key: 'inbound.view_queue', label: 'Ver fila de prospects inbound', category: 'inbound' },
  { key: 'inbound.assign_prospects', label: 'Alocar prospects inbound', category: 'inbound' },
  { key: 'inbound.configure', label: 'Configurar captura inbound', category: 'inbound' },

  // Reports
  { key: 'reports.read', label: 'Ver relatórios', category: 'reports' },
  { key: 'reports.financial', label: 'Ver dados financeiros nos relatórios', category: 'reports' },
  { key: 'reports.export', label: 'Exportar relatórios', category: 'reports' },

  // ... ~40-50 permissions no total
] as const;

export type Permission = (typeof PERMISSIONS_CATALOG)[number]['key'];
export type PermissionCategory = 'tenant' | 'users' | 'catalog' | 'companies' |
  'contacts' | 'opportunities' | 'proposals' | 'contracts' | 'partners' |
  'reports' | 'inbound' | 'ai' | 'alerts' | 'audit';
```

---

## Schema novo

### Migration `0025_rbac_granular`

```sql
-- Tabela de overrides por usuário
CREATE TABLE user_permission_overrides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  permission    text NOT NULL,
  action        text NOT NULL CHECK (action IN ('granted', 'revoked')),
  granted_by    uuid REFERENCES users(id),
  granted_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,             -- opcional, mas não no escopo desse sprint
  reason        text,                    -- justification opcional
  UNIQUE (user_id, permission)
);

CREATE INDEX user_permission_overrides_user_idx
  ON user_permission_overrides(user_id);

-- Migração: GESTOR_INBOUND → ADMIN + permission overrides
INSERT INTO user_permission_overrides (user_id, tenant_id, permission, action, granted_by, granted_at, reason)
SELECT
  id,
  tenant_id,
  unnest(ARRAY['inbound.view_queue', 'inbound.assign_prospects', 'inbound.configure']),
  'granted',
  NULL,
  NOW(),
  'Migrated from GESTOR_INBOUND role (Sprint 15E backfill)'
FROM users
WHERE role = 'GESTOR_INBOUND';

UPDATE users SET role = 'ADMIN' WHERE role = 'GESTOR_INBOUND';

-- Remover GESTOR_INBOUND do enum
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
CREATE TYPE "UserRole" AS ENUM (
  'ADMIN',
  'DIRETOR_COMERCIAL',
  'DIRETOR_OPERACOES',
  'DIRETOR_FINANCEIRO',
  'GESTOR',
  'ANALISTA',
  'PARCEIRO'
);

ALTER TABLE users
  ALTER COLUMN role DROP DEFAULT,
  ALTER COLUMN role TYPE "UserRole" USING role::text::"UserRole",
  ALTER COLUMN role SET DEFAULT 'ANALISTA';

UPDATE approval_rules
   SET approver_roles = (
     SELECT array_agg((r::text)::"UserRole_old")
     FROM unnest(approver_roles) AS r
   )
 WHERE TRUE;

ALTER TABLE approval_rules
  ALTER COLUMN approver_roles TYPE "UserRole"[]
  USING approver_roles::text[]::"UserRole"[];

DROP TYPE "UserRole_old";

-- Backfill permissions de role pra cada user existente
-- (cache local pra performance — evita join em toda chamada)
ALTER TABLE users ADD COLUMN cached_permissions text[];

UPDATE users
   SET cached_permissions = (
     -- Computar permissions: defaults do role + overrides
     SELECT array_agg(DISTINCT p)
     FROM (
       SELECT unnest(default_permissions_for_role(role)) AS p
       UNION ALL
       SELECT permission AS p
       FROM user_permission_overrides
       WHERE user_id = users.id AND action = 'granted'
     ) sub
     WHERE p NOT IN (
       SELECT permission FROM user_permission_overrides
       WHERE user_id = users.id AND action = 'revoked'
     )
   );

-- Trigger pra atualizar cache automaticamente quando role ou
-- override muda
CREATE OR REPLACE FUNCTION refresh_user_permissions_cache() ...;
CREATE TRIGGER ...
```

**Função `default_permissions_for_role(role)` SQL:**

Pra evitar duplicar a tabela JS no Postgres, usar uma função que
retorna array baseado no role. Ou — mais simples — não usar trigger
e atualizar cache via tRPC `users.update*` mutations.

Decisão: **sem trigger SQL**, atualização do cache fica no service
de users (`updateUserRole`, `grantPermission`, `revokePermission`).
Mais simples, mais visível.

---

## Refactor da camada de autorização

### `src/lib/auth/rbac.ts` — novo

```ts
import { PERMISSIONS_CATALOG, type Permission } from './permissions-catalog';

const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, Set<Permission>> = {
  ADMIN: new Set([
    'tenant.read', 'tenant.update',
    'user.create', 'user.read', 'user.update', 'user.delete',
    'user.grant_permissions',          // NOVA — só ADMIN concede por default
    ...
  ]),
  DIRETOR_COMERCIAL: new Set([
    'tenant.read',
    'company.read', 'contact.read',
    'opportunity.read', 'opportunity.create', 'opportunity.update',
    'proposal.approve',
    'reports.read', 'reports.financial',
    ...
  ]),
  GESTOR: new Set([
    'company.read', 'company.create', 'company.update',
    'opportunity.read', 'opportunity.create', 'opportunity.update',
    ...
  ]),
  ANALISTA: new Set([
    'opportunity.read', 'opportunity.create',
    'activity.create',
    ...
  ]),
  PARCEIRO: new Set([
    'opportunity.read',           // só as próprias
    ...
  ]),
  // ... etc
};

export async function hasPermission(
  userId: string,
  permission: Permission,
): Promise<boolean> {
  // PLATFORM_OWNER bypass (Sprint 15A)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, platformRole: true, cachedPermissions: true },
  });
  if (user?.platformRole === 'PLATFORM_OWNER') return true;
  if (!user) return false;

  // Cache hit (default + overrides já computados)
  if (user.cachedPermissions) {
    return user.cachedPermissions.includes(permission);
  }

  // Cache miss — computa on demand (raro)
  return computeUserPermissions(userId).then(p => p.has(permission));
}

export function hasPermissionByRole(role: UserRole, permission: Permission): boolean {
  // Versão síncrona pra UI conditionals — não considera overrides,
  // só defaults. Útil pra esconder botões em lista renderizada.
  // Backend sempre re-valida via hasPermission async.
  return ROLE_DEFAULT_PERMISSIONS[role].has(permission);
}
```

### `src/server/trpc/middlewares.ts` — novo

```ts
export function withPermission(permission: Permission) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const ok = await hasPermission(ctx.user.id, permission);
    if (!ok) throw new TRPCError({ code: 'FORBIDDEN' });
    return next();
  });
}

// Helpers comuns
export const requirePermission = (p: Permission) =>
  protectedProcedure.use(withPermission(p));
```

### Migração das procedures existentes

Cada uso atual de `withRoles('ADMIN', 'GESTOR')` migra pra
`withPermission('opportunity.update')`. Refactor mecânico via grep:

```bash
grep -rnE "withRoles\(['\"]" src/server/trpc/routers/ | wc -l
# ~30-40 ocorrências esperadas
```

Mapa de migração (anexar à PR):

| Antes | Depois |
|---|---|
| `withRoles('ADMIN')` em `users.invite` | `withPermission('user.create')` |
| `withRoles('ADMIN', 'GESTOR')` em `companies.create` | `withPermission('company.create')` |
| `withRoles('SUPER_ADMIN', 'ADMIN', 'DIRETOR_COMERCIAL', 'GESTOR')` em `opportunities.create` | `withPermission('opportunity.create')` |
| `withRoles('GESTOR_INBOUND')` em `inbound.queue.list` | `withPermission('inbound.view_queue')` |
| ... |

---

## UI — `/admin/users/[id]/permissions`

Nova rota pra gerenciar overrides individuais.

### Acesso

- Permission `user.grant_permissions` (default só ADMIN tem)
- Acesso a outros users do mesmo tenant

### Layout

```
┌──────────────────────────────────────────────────────┐
│ Maria Silva                                          │
│ Analista · maria@empresa.com                         │
│                                                      │
│ [Permissões padrão do perfil] [Overrides individuais]│
├──────────────────────────────────────────────────────┤
│                                                      │
│  ⚙ Categoria: Inbound                                │
│  ✅ Ver fila de prospects inbound (concedida)        │
│  ☐  Alocar prospects inbound                         │
│  ☐  Configurar captura inbound                       │
│                                                      │
│  ⚙ Categoria: Reports                                │
│  ✅ Ver relatórios (do perfil ANALISTA)              │
│  ☐  Ver dados financeiros (REVOGADA do perfil ✏)    │
│  ☐  Exportar relatórios                              │
│                                                      │
│  ...                                                 │
└──────────────────────────────────────────────────────┘
```

**3 estados visuais por permission:**
- ✅ verde — concedida (override `granted` OU default do role sem
  revoke)
- ❌ vermelho — explicitamente revogada (`revoked` override sobrepõe
  default do role)
- ☐ neutro — não tem (sem override e sem default do role)

**Botões:**
- "Conceder" → cria `granted` override
- "Revogar" → cria `revoked` override
- "Restaurar default" → deleta override (volta a usar default do role)

**Inline justification:** input opcional "Por quê?" salvo no
`user_permission_overrides.reason`.

### Audit log automático

Cada mudança (grant/revoke/restore) gera entrada em `audit_logs`:

```ts
await audit({
  action: 'user.permission_changed',
  tableName: 'user_permission_overrides',
  recordId: user.id,
  tenantIdOverride: ctx.tenantId,
  before: { permission, prevAction: existing?.action ?? 'default' },
  after: { permission, newAction: 'granted', reason: input.reason },
});
```

Útil pra forense quando admin reclama "alguém deu permissão errada ao
fulano".

---

## tRPC router novo — `permissions`

```ts
// src/server/trpc/routers/permissions.ts

export const permissionsRouter = router({
  // Lista catálogo (público pros admins de tenant)
  listCatalog: protectedProcedure.query(() => {
    return PERMISSIONS_CATALOG;
  }),

  // Lista permissions efetivas de um user (defaults + overrides)
  forUser: requirePermission('user.read')
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const user = await prisma.user.findFirst({
        where: { id: input.userId, tenantId: ctx.tenantId },
        include: { permissionOverrides: true },
      });
      if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
      return {
        role: user.role,
        defaultPermissions: ROLE_DEFAULT_PERMISSIONS[user.role],
        overrides: user.permissionOverrides,
        effective: user.cachedPermissions,
      };
    }),

  // Concede ou revoga permission
  set: requirePermission('user.grant_permissions')
    .input(z.object({
      userId: z.string().uuid(),
      permission: z.string(),  // validado contra catalog
      action: z.enum(['granted', 'revoked', 'restore']),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      validatePermissionExists(input.permission);
      // ... grant / revoke / delete override
      // ... atualizar cachedPermissions do user
      // ... audit log
    }),

  // Lista usuários do tenant que têm uma permission específica
  // (útil pra notificações "quem é o gestor de inbound?")
  whoHas: requirePermission('user.read')
    .input(z.object({ permission: z.string() }))
    .query(async ({ input, ctx }) => {
      return prisma.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          cachedPermissions: { has: input.permission },
        },
        select: { id: true, fullName: true, email: true, role: true },
      });
    }),
});
```

---

## Compatibilidade com código existente

### approval_rules.approver_roles

**Antes:** array de roles. Aprovador pra esta regra é qualquer user
com role em `approver_roles`.

**Depois:** mantém. Mas adiciona modo alternativo via permission:

```sql
ALTER TABLE approval_rules
  ADD COLUMN approver_permission text;   -- alternativo a approver_roles

-- Regra de validação: ou approver_roles ou approver_permission, não os dois
ALTER TABLE approval_rules ADD CONSTRAINT approval_rules_approver_check
  CHECK ((approver_roles IS NOT NULL AND approver_permission IS NULL)
      OR (approver_roles IS NULL AND approver_permission IS NOT NULL));
```

Service `approval-engine.service.ts` consulta a regra: se
`approver_permission` setado, usa `permissions.whoHas` pra encontrar
aprovadores. Se `approver_roles`, mantém comportamento atual.

**Backward compatible:** regras existentes continuam funcionando.

### Sidebar / BottomNav — links condicionais

UI server-side renderiza só os links que o user tem permission pra
acessar. Hoje usa `withRoles`; muda pra `hasPermissionByRole` (versão
síncrona — defaults só) + revalida server-side ao clicar.

### `/inbox/prospects` (Sprint 15D)

**Antes (15D):** middleware checa `role === 'GESTOR_INBOUND' ||
'ADMIN' || 'DIRETOR_COMERCIAL'`.

**Depois (15E):** middleware checa `permission ===
'inbound.view_queue'`.

Migration backfilla todos os antigos `GESTOR_INBOUND` → role `ADMIN` +
3 grants de permission. Comportamento idêntico do ponto de vista do
user.

---

## Procedures que mudam interface

`users.invite` e `users.updateRole` (Sprint 13) ganham fluxo
opcional:

```ts
users.invite({
  email, fullName, role,                  // mantém
  initialPermissionOverrides: {           // NOVO opcional
    granted: ['inbound.view_queue'],
    revoked: ['reports.financial'],
  },
});
```

Admin pode convidar alguém como ANALISTA mas com permissions extra
pré-aplicadas. UI do modal de convite ganha tab opcional "Permissões
avançadas".

---

## Testes

### Unit
- `tests/unit/permissions-catalog.test.ts` — catálogo válido,
  categories balanceadas
- `tests/unit/role-defaults.test.ts` — cada role tem permissions
  esperadas (snapshot test)
- `tests/unit/has-permission-with-overrides.test.ts` — 6 cases:
  - Sem override → usa default do role
  - Granted override → true mesmo se default não tem
  - Revoked override → false mesmo se default tem
  - Conflito (granted E revoked) → revoked vence
  - Cache hit
  - Cache miss
- `tests/unit/permission-cache-invalidation.test.ts` — mudar role
  invalida cache; grant invalida; revoke invalida; restore invalida

### Integration
- `tests/integration/permissions-router.test.ts` — set/forUser/
  whoHas com user.grant_permissions guard
- `tests/integration/approval-rules-by-permission.test.ts` — regra
  com approver_permission é resolvida corretamente
- `tests/integration/migration-gestor-inbound.test.ts` — backfill
  do GESTOR_INBOUND funciona (users mantêm acesso ao `/inbox/prospects`)

### E2E
- ADMIN entra em `/admin/users/[id]/permissions`, concede
  `inbound.view_queue` a um ANALISTA → ANALISTA passa a ver
  `/inbox/prospects`
- ADMIN revoga `reports.financial` de um DIRETOR_COMERCIAL → DIRETOR
  para de ver coluna de valores em relatórios financeiros
- ANALISTA tenta acessar `/admin/users/[id]/permissions` → 403

---

## Critérios de aceite

### Funcional
- [ ] Migration 0025 aplicada (user_permission_overrides +
  cached_permissions + remove GESTOR_INBOUND do enum)
- [ ] Todos os GESTOR_INBOUND migrados pra ADMIN + 3 permissions
- [ ] `permissions_catalog.ts` com ~40-50 permissions categorizadas
- [ ] `hasPermission(userId, perm)` async com cache funcional
- [ ] `hasPermissionByRole(role, perm)` síncrono pra UI conditionals
- [ ] `withPermission(perm)` middleware tRPC funcional
- [ ] ~30-40 procedures migradas de `withRoles` pra `withPermission`
- [ ] Mapping doc anexado à PR
- [ ] `permissions.{listCatalog, forUser, set, whoHas}` procedures
- [ ] approval_rules.approver_permission funciona alternativo

### UI
- [ ] `/admin/users/[id]/permissions` lista permissions por
  categoria com 3 estados visuais (concedida/revogada/neutro)
- [ ] Botões Conceder/Revogar/Restaurar default funcionais
- [ ] Justification opcional inline
- [ ] Audit log gerado em cada mudança
- [ ] Sidebar/BottomNav renderizam links condicionalmente baseado em
  defaults do role

### Sprint 15D compatibility
- [ ] `/inbox/prospects` continua acessível pelos mesmos usuários
  (que eram GESTOR_INBOUND, agora têm permission)
- [ ] Botão "Alocar" continua disponível pra eles
- [ ] Notificações inbound continuam chegando

### Performance
- [ ] hasPermission async + cache não adiciona > 5ms em request
  típico (medido com `console.time`)
- [ ] Cache invalidation acontece em < 200ms após mudança de
  override (medido em test e2e)

### Qualidade
- [ ] 330+ testes anteriores continuam passando + ≥ 18 novos
- [ ] Type-check zero, lint zero
- [ ] PR description tem mapping completo old → new

---

## Esforço

| Atividade | Dias |
|---|---|
| Permissions catalog + migrate types | 0,5 |
| Migration 0025 + backfill GESTOR_INBOUND | 0,75 |
| Refactor `rbac.ts` + middlewares + cache | 1,25 |
| Refactor das ~30 procedures pra `withPermission` | 1,5 |
| UI `/admin/users/[id]/permissions` | 1,5 |
| approval_rules.approver_permission + service update | 0,75 |
| Migração de tests existentes que assumiam role-based | 0,5 |
| Testes novos + E2E | 1,0 |
| **Total** | **~7 dias** |

(Original estimado 5-7d — mantém no high range pelo refactor de
~30 procedures + UI + 18 novos tests.)

---

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Refactor de 30 procedures introduz regressão silenciosa | Mapping doc detalhado + grep ANTES de qualquer mudança + suite de tests por procedure |
| Cache fica stale → user perde acesso após revoke | Invalidation em todas as 3 mutations (grant/revoke/restore) + ttl 5min como fallback de segurança |
| Permission errada concedida via UI por engano | Confirmação inline + audit log + UI mostra histórico de mudanças por user |
| Procedures faltando guards após refactor | Lint custom (eslint rule: procedure sem `.use(...)` falha) ou test E2E que valida 401/403 em rota cada |
| Approval rules quebram por causa de modo dual | Backward compat — regras com `approver_roles` setado continuam funcionando como antes |

---

## Pós-sprint

Quando fechado:
- Atualizar `CLAUDE.md` marcando Sprint 15E concluído
- Atualizar `docs/Backlog_Pos_MVP.md` zerando débito "proliferação
  de roles"
- Migration 0025 aplicada no Neon
- Memory novo: `rbac-granular-pattern.md` com regras de quando criar
  permission vs role
- Comunicar Platform Owner: futuras features tipo "Gestor de X"
  devem usar permissions, não roles novas
