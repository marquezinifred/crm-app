# Sprint 15E — RBAC Granular (Permissões Configuráveis) — v2

**Estimativa:** 8-10 dias úteis (revisado — v1 estimou 7d com base em ~30 procedures; estado atual mostra 47)
**Data spec v1:** 2026-06-30
**Data spec v2:** 2026-07-01 (pós-15D fechado e 15F fechado)
**Migration:** 0030 (0024/0025 ficaram como skips; 0026 = clerk_id, 0027-0028 = 15F, 0029 = 15D)
**Pré-requisitos:**
- ✅ Sprint 15A fechado (dual identity Platform Owner + tenant admin)
- ✅ Sprint 15D fechado (introduziu `GESTOR_INBOUND` no enum — caso âncora do refactor)
- ✅ Sprint 15F fechado (novas features IA que ganham permissions granulares)
- ✅ Memory `migration-pitfalls.md` (padrões que se aplicam à migration 0030)

---

## 1. Objetivo

Refatorar o sistema de roles fixas pra modelo de **roles como perfis padrão + overrides individuais de permissão por user**.

Resolve a dor identificada durante o Sprint 15D: cada feature nova "que precisa de um gestor de X" força criação de role nova no enum. Após este sprint, novas permissions granulares (`inbound:assign_prospects`, `reports:financial_view`, `ai:test_key`, etc) ficam em catálogo configurável, atribuíveis por override individual.

### O que NÃO fazer neste sprint

- **Não remover roles** — continuam como perfis pré-configurados; usuário pode ainda ser cadastrado com role e nada mais
- **Não implementar permissões por entidade** (row-level, tipo "esse user pode editar só essas 5 empresas") — Sprint futuro se surgir
- **Não implementar delegação temporária** (permission expirando em X dias) — Sprint futuro
- **Não implementar custom roles** (admin cria role nova com nome livre) — Sprint futuro
- **Não migrar `platformRole`** (PLATFORM_OWNER continua bypass total; PLATFORM_SUPPORT continua no enum pra sprints futuros)

---

## 2. Estado atual (2026-07-01)

### 2.1. Roles ativas no enum

```prisma
enum UserRole {
  ADMIN
  DIRETOR_COMERCIAL
  DIRETOR_OPERACOES
  DIRETOR_FINANCEIRO
  GESTOR
  GESTOR_INBOUND   // Sprint 15D — role temporária; vira permission neste sprint
  ANALISTA
  PARCEIRO
}
```

### 2.2. Sistema de permissões atual (`src/lib/auth/rbac.ts`)

Formato: `"resource:action"` (dois pontos, não ponto).

Recursos:
```ts
export const ACTIONS = {
  tenant: ['read', 'update'],
  user: ['create', 'read', 'update', 'delete'],
  catalog: ['create', 'read', 'update', 'delete'],
  company: ['create', 'read', 'update', 'delete'],
  contact: ['create', 'read', 'update', 'delete'],
  opportunity: ['create', 'read', 'update', 'delete', 'advance_stage', 'cancel'],
  proposal: ['create', 'read', 'update', 'approve'],
  contract: ['create', 'read', 'update'],
  partner: ['invite', 'approve_engagement'],
  ai: ['use_summary', 'configure'],
  alert: ['configure'],
  audit: ['read'],
};
```

Total atual: **~35 permissions**. Sprint 15E vai expandir para **~65** — cobrindo o gap de Sprint 15D (inbound) + Sprint 15F (ai granular) + P-19 (documents) + P-20 (tasks).

### 2.3. Uso das guards

```bash
grep -rn "withRoles\|withCapability" src/server/trpc/routers --include="*.ts" | wc -l
# 47 (baseline 2026-07-01)
```

Distribuição aproximada:
- `withCapability(resource, action)`: 40 usos (formato preferido, já expressa permission)
- `withRoles(...)`: 7 usos (padrão antigo, refactor prioritário)

---

## 3. Modelo novo

### 3.1. Fluxo `hasPermission`

```ts
async function hasPermission(
  userId: string,
  permission: Permission,
): Promise<boolean> {
  const user = await getUserWithCache(userId);

  // 1. Platform Owner bypass (Sprint 15A preserva)
  if (user.platformRole === 'PLATFORM_OWNER') return true;

  // 2. Cache hit — permissions efetivas já computadas
  if (user.cachedPermissions) {
    return user.cachedPermissions.includes(permission);
  }

  // 3. Fallback (cache miss) — computa on-demand
  const effective = await computeUserPermissions(userId);
  return effective.has(permission);
}
```

### 3.2. Cascata de resolução

```
Permission efetiva = (defaults do role) ∪ (overrides granted) − (overrides revoked)
```

Precedência: **revoked > granted > default do role**.

### 3.3. Versão síncrona pra UI

```ts
export function hasPermissionByRole(
  role: UserRole,
  permission: Permission,
): boolean {
  // NÃO considera overrides — só defaults do role.
  // Usado pra esconder botões em lista renderizada (`<Button hidden={!hasPermissionByRole(...)}>`).
  // Backend SEMPRE re-valida via hasPermission async (verdade final).
  return ROLE_DEFAULT_PERMISSIONS[role].has(permission);
}
```

---

## 4. Catálogo de permissions expandido

Arquivo: `src/lib/auth/permissions-catalog.ts` (novo — estático, sem tabela no banco).

### 4.1. Estrutura

```ts
export const PERMISSIONS_CATALOG = [
  // Tenant
  { key: 'tenant:read', label: 'Ver dados do tenant', category: 'tenant' },
  { key: 'tenant:update', label: 'Editar dados do tenant', category: 'tenant' },

  // Users
  { key: 'user:create', label: 'Convidar usuários', category: 'users' },
  { key: 'user:read', label: 'Ver usuários', category: 'users' },
  { key: 'user:update', label: 'Editar usuários (nome, role)', category: 'users' },
  { key: 'user:delete', label: 'Desativar usuários', category: 'users' },
  { key: 'user:grant_permissions', label: 'Conceder permissões individuais', category: 'users' },  // NOVA

  // Catalog (territories, segments, products, lists)
  { key: 'catalog:create', label: 'Criar itens do catálogo', category: 'catalog' },
  { key: 'catalog:read', label: 'Ver catálogo', category: 'catalog' },
  { key: 'catalog:update', label: 'Editar catálogo', category: 'catalog' },
  { key: 'catalog:delete', label: 'Remover itens do catálogo', category: 'catalog' },

  // Companies
  { key: 'company:create', label: 'Cadastrar empresas', category: 'companies' },
  { key: 'company:read', label: 'Ver empresas', category: 'companies' },
  { key: 'company:update', label: 'Editar empresas', category: 'companies' },
  { key: 'company:delete', label: 'Desativar empresas', category: 'companies' },

  // Contacts
  { key: 'contact:create', label: 'Cadastrar contatos', category: 'contacts' },
  { key: 'contact:read', label: 'Ver contatos', category: 'contacts' },
  { key: 'contact:update', label: 'Editar contatos', category: 'contacts' },
  { key: 'contact:delete', label: 'Desativar contatos', category: 'contacts' },

  // Opportunities
  { key: 'opportunity:create', label: 'Criar oportunidades', category: 'opportunities' },
  { key: 'opportunity:read', label: 'Ver oportunidades', category: 'opportunities' },
  { key: 'opportunity:update', label: 'Editar oportunidades', category: 'opportunities' },
  { key: 'opportunity:delete', label: 'Cancelar oportunidades', category: 'opportunities' },
  { key: 'opportunity:advance_stage', label: 'Avançar estágio no funil', category: 'opportunities' },
  { key: 'opportunity:cancel', label: 'Encerrar como perdida', category: 'opportunities' },
  { key: 'opportunity:read_others', label: 'Ver oportunidades de outros usuários', category: 'opportunities' },  // NOVA — hoje default só DIRETOR/ADMIN

  // Proposals
  { key: 'proposal:create', label: 'Criar propostas', category: 'proposals' },
  { key: 'proposal:read', label: 'Ver propostas', category: 'proposals' },
  { key: 'proposal:update', label: 'Editar propostas', category: 'proposals' },
  { key: 'proposal:approve', label: 'Aprovar propostas', category: 'proposals' },

  // Contracts
  { key: 'contract:create', label: 'Criar contratos', category: 'contracts' },
  { key: 'contract:read', label: 'Ver contratos', category: 'contracts' },
  { key: 'contract:update', label: 'Editar contratos', category: 'contracts' },

  // Documents (P-19)
  { key: 'document:upload', label: 'Anexar documentos', category: 'documents' },  // NOVA
  { key: 'document:read', label: 'Ver documentos', category: 'documents' },       // NOVA
  { key: 'document:delete', label: 'Remover documentos', category: 'documents' }, // NOVA

  // Tasks (P-20)
  { key: 'task:create', label: 'Criar tarefas', category: 'tasks' },    // NOVA
  { key: 'task:update', label: 'Editar tarefas', category: 'tasks' },   // NOVA
  { key: 'task:delete', label: 'Remover tarefas', category: 'tasks' },  // NOVA

  // Partners
  { key: 'partner:invite', label: 'Convidar parceiros', category: 'partners' },
  { key: 'partner:approve_engagement', label: 'Aprovar engajamento de parceiros', category: 'partners' },

  // Inbound (Sprint 15D — substitui role GESTOR_INBOUND)
  { key: 'inbound:view_queue', label: 'Ver fila de prospects inbound', category: 'inbound' },        // NOVA
  { key: 'inbound:assign_prospects', label: 'Alocar prospects inbound', category: 'inbound' },       // NOVA
  { key: 'inbound:configure', label: 'Configurar captura inbound (forms, sources)', category: 'inbound' }, // NOVA
  { key: 'inbound:view_reports', label: 'Ver relatório Inbound × Outbound', category: 'inbound' },   // NOVA

  // Reports
  { key: 'reports:read', label: 'Ver relatórios', category: 'reports' },
  { key: 'reports:financial', label: 'Ver dados financeiros nos relatórios', category: 'reports' },  // NOVA — hoje qualquer um vê
  { key: 'reports:export', label: 'Exportar relatórios em Excel', category: 'reports' },             // NOVA

  // AI (Sprint 15F — split granular do 'ai:configure')
  { key: 'ai:use_summary', label: 'Usar resumo de comunicações (IA)', category: 'ai' },
  { key: 'ai:use_extraction', label: 'Usar extração de dados (IA)', category: 'ai' },                // NOVA
  { key: 'ai:use_scoring', label: 'Usar scoring de leads (IA)', category: 'ai' },                    // NOVA
  { key: 'ai:configure_global', label: 'Configurar provider/modelo padrão', category: 'ai' },        // NOVA — vez de 'configure' amplo
  { key: 'ai:configure_feature', label: 'Configurar override por feature', category: 'ai' },         // NOVA
  { key: 'ai:test_key', label: 'Testar chave de provider', category: 'ai' },                         // NOVA
  { key: 'ai:manage_breaker', label: 'Limpar circuit breaker', category: 'ai' },                     // NOVA — ação delicada

  // Alerts
  { key: 'alert:configure', label: 'Configurar alertas de renovação', category: 'alerts' },
  { key: 'alert:receive_admin', label: 'Receber alertas administrativos', category: 'alerts' },      // NOVA

  // Audit
  { key: 'audit:read', label: 'Ver logs de auditoria', category: 'audit' },
  { key: 'audit:read_platform', label: 'Ver logs cross-tenant (Platform)', category: 'audit' },      // NOVA — Platform Owner only, mas listado pra clareza

  // Import
  { key: 'import:run', label: 'Rodar importações CSV/XLSX', category: 'import' },  // NOVA
  { key: 'import:read', label: 'Ver histórico de importações', category: 'import' }, // NOVA
] as const;

export type Permission = (typeof PERMISSIONS_CATALOG)[number]['key'];
export type PermissionCategory =
  | 'tenant' | 'users' | 'catalog'
  | 'companies' | 'contacts' | 'opportunities' | 'proposals'
  | 'contracts' | 'documents' | 'tasks' | 'partners'
  | 'inbound' | 'reports' | 'ai' | 'alerts' | 'audit' | 'import';
```

**Total: ~65 permissions** (35 atuais + 30 novas cobrindo Sprint 15D/15F + P-19/P-20 + splits granulares).

### 4.2. Defaults por role — matriz completa

Ver `docs/permission-matrix.md` (novo arquivo criado no sprint). Resumo:

| Role | Permissions default aproximadas |
|---|---|
| ADMIN | ~55 (tudo exceto `audit:read_platform`) |
| DIRETOR_COMERCIAL | ~35 (leitura ampla + aprovação de propostas + reports:financial) |
| DIRETOR_OPERACOES | ~25 (leitura + contratos + engajamento parceiros) |
| DIRETOR_FINANCEIRO | ~18 (leitura + aprovação de propostas + reports:financial + reports:export) |
| GESTOR | ~30 (CRUD companies/contacts/opps + reports:read sem financial) |
| ANALISTA | ~18 (CRUD companies/contacts/opps próprias + reports:read básico) |
| PARCEIRO | ~6 (só as próprias opps + activity:create) |

`GESTOR_INBOUND` **removido do enum** — todos os users antigos migram pra ADMIN + 4 grants inbound.

---

## 5. Schema — migration 0030

### 5.1. SQL

```sql
-- ================================================================
-- Migration 0030 — RBAC granular
-- ================================================================
-- Padrão aplicado: memory/migration-pitfalls.md
--   1. Cast enum_old[] → text[] → enum_new[] (via text intermediário)
--   2. Sanitizar valores inválidos ANTES de DROP TYPE
--   3. Partial UNIQUE em coluna nullable — se aplicável
--   4. CHECK XOR onde apropriado
-- ================================================================

-- 1. Tabela de overrides por (user, permission)
CREATE TABLE user_permission_overrides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  permission    text NOT NULL,                          -- validado no service contra PERMISSIONS_CATALOG
  action        text NOT NULL CHECK (action IN ('granted', 'revoked')),
  granted_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  reason        text,
  UNIQUE (user_id, permission)
);

CREATE INDEX user_permission_overrides_user_idx
  ON user_permission_overrides(user_id);

CREATE INDEX user_permission_overrides_tenant_idx
  ON user_permission_overrides(tenant_id);

-- 2. Cache de permissions efetivas por user
ALTER TABLE users
  ADD COLUMN cached_permissions text[];

-- 3. Backfill GESTOR_INBOUND → ADMIN + 4 permission grants
--    Ordem crítica: INSERIR overrides ANTES de mudar o role
INSERT INTO user_permission_overrides (user_id, tenant_id, permission, action, granted_at, reason)
SELECT
  id,
  tenant_id,
  unnest(ARRAY[
    'inbound:view_queue',
    'inbound:assign_prospects',
    'inbound:configure',
    'inbound:view_reports'
  ]),
  'granted',
  now(),
  'Backfill Sprint 15E — migrated from GESTOR_INBOUND role (2026-07-XX)'
FROM users
WHERE role = 'GESTOR_INBOUND' AND deleted_at IS NULL;

-- Users soft-deleted também migram (por integridade referencial de audit_logs)
INSERT INTO user_permission_overrides (user_id, tenant_id, permission, action, granted_at, reason)
SELECT
  id,
  tenant_id,
  unnest(ARRAY[
    'inbound:view_queue',
    'inbound:assign_prospects',
    'inbound:configure',
    'inbound:view_reports'
  ]),
  'granted',
  now(),
  'Backfill Sprint 15E — migrated from GESTOR_INBOUND role (soft-deleted user)'
FROM users
WHERE role = 'GESTOR_INBOUND' AND deleted_at IS NOT NULL;

UPDATE users SET role = 'ADMIN' WHERE role = 'GESTOR_INBOUND';

-- 4. Sanitizar approval_rules antes de dropar o enum
--    approval_rules.approver_roles é text[] (não enum[]) — não afeta pattern 1,
--    mas verificar se algum tenant configurou GESTOR_INBOUND lá.
UPDATE approval_rules
   SET approver_roles = array_remove(approver_roles, 'GESTOR_INBOUND')
 WHERE 'GESTOR_INBOUND' = ANY(approver_roles);

-- 5. Cast do enum via text (pattern migration-pitfalls #1)
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

DROP TYPE "UserRole_old";

-- 6. Backfill cached_permissions
--    Estratégia: NULL agora, computa on-demand no service.
--    UPDATE massivo com JOIN complexo seria mais performático mas
--    duplicaria a lógica do rbac.ts em SQL. Deixamos NULL e a primeira
--    chamada de cada user popula o cache.
--
-- (nenhum UPDATE aqui — cache preenchido pelo service quando acessado)

-- 7. Alterar approval_rules pra aceitar approver_permission
ALTER TABLE approval_rules
  ADD COLUMN approver_permission text;

ALTER TABLE approval_rules
  ADD CONSTRAINT approval_rules_approver_check
  CHECK (
    (approver_roles IS NOT NULL AND array_length(approver_roles, 1) > 0 AND approver_permission IS NULL)
    OR
    (approver_roles IS NULL AND approver_permission IS NOT NULL)
  );

-- 8. Comentários pra documentar
COMMENT ON TABLE user_permission_overrides IS
  'Overrides individuais de permission por user. Precedência: revoked > granted > default do role.';
COMMENT ON COLUMN users.cached_permissions IS
  'Cache de permissions efetivas (defaults do role ∪ granted overrides − revoked overrides). Populado on-demand, invalidado em mudança de role ou override.';
COMMENT ON COLUMN approval_rules.approver_permission IS
  'Alternativa a approver_roles. Se setado, aprovadores da regra são todos com esta permission. Sprint 15E.';
```

### 5.2. Prisma schema

```prisma
model UserPermissionOverride {
  id           String   @id @default(uuid()) @db.Uuid
  userId       String   @map("user_id") @db.Uuid
  tenantId     String   @map("tenant_id") @db.Uuid
  permission   String
  action       String   // 'granted' | 'revoked'
  grantedBy    String?  @map("granted_by") @db.Uuid
  grantedAt    DateTime @default(now()) @map("granted_at")
  reason       String?  @db.Text

  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tenant       Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  grantedByUser User?   @relation("PermissionGrantedBy", fields: [grantedBy], references: [id], onDelete: SetNull)

  @@unique([userId, permission], name: "user_permission_unique")
  @@index([userId])
  @@index([tenantId])
  @@map("user_permission_overrides")
}

model User {
  // ... campos existentes
  cachedPermissions       String[]                  @map("cached_permissions")
  permissionOverrides     UserPermissionOverride[]
  grantedOverrides        UserPermissionOverride[]  @relation("PermissionGrantedBy")
}

model ApprovalRule {
  // ... campos existentes
  approverPermission      String?                   @map("approver_permission")
}

enum UserRole {
  ADMIN
  DIRETOR_COMERCIAL
  DIRETOR_OPERACOES
  DIRETOR_FINANCEIRO
  GESTOR
  ANALISTA
  PARCEIRO
  // GESTOR_INBOUND removido — Sprint 15E migrou pra ADMIN + overrides
}
```

### 5.3. Rollback plan

Se migration 0030 falhar em produção após deploy parcial:

1. Deletar `user_permission_overrides` (não afeta users existentes)
2. Reverter role dos users backfilled (buscar no audit log qual role tinham antes)
3. Recriar `GESTOR_INBOUND` no enum (mesmo cast reverso)
4. Rollback do `cached_permissions` (drop column)

Documentar em `docs/runbooks/rollback-15e.md`.

---

## 6. Refactor da autorização (`src/lib/auth/rbac.ts`)

### 6.1. Estrutura nova

```ts
import type { UserRole } from '@prisma/client';
import { PERMISSIONS_CATALOG, type Permission } from './permissions-catalog';
import { prisma } from '@/server/db/client';

/**
 * Permissions default por role. Cache local pra performance.
 * Fonte da verdade — matriz revisada no Sprint 15E.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, Set<Permission>> = {
  ADMIN: new Set([
    // Ver docs/permission-matrix.md pra lista completa.
    // ~55 permissions.
    'tenant:read', 'tenant:update',
    'user:create', 'user:read', 'user:update', 'user:delete', 'user:grant_permissions',
    // ... (55 total)
  ]),
  DIRETOR_COMERCIAL: new Set([ /* ~35 */ ]),
  DIRETOR_OPERACOES: new Set([ /* ~25 */ ]),
  DIRETOR_FINANCEIRO: new Set([ /* ~18 */ ]),
  GESTOR: new Set([ /* ~30 */ ]),
  ANALISTA: new Set([ /* ~18 */ ]),
  PARCEIRO: new Set([ /* ~6 */ ]),
};

/**
 * Assíncrono: verdade final. Considera role default + overrides.
 * Backend usa em toda procedure.
 */
export async function hasPermission(
  userId: string,
  permission: Permission,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      platformRole: true,
      cachedPermissions: true,
      deletedAt: true,
      active: true,
    },
  });
  if (!user || user.deletedAt || !user.active) return false;

  // Platform Owner bypass (Sprint 15A)
  if (user.platformRole === 'PLATFORM_OWNER') return true;

  // Cache hit
  if (user.cachedPermissions && user.cachedPermissions.length > 0) {
    return user.cachedPermissions.includes(permission);
  }

  // Cache miss — computa e popula
  const effective = await computeAndCacheUserPermissions(userId);
  return effective.has(permission);
}

/**
 * Síncrono: baseado apenas no role (sem overrides).
 * UI usa pra esconder botões. Backend re-valida via hasPermission.
 */
export function hasPermissionByRole(
  role: UserRole | null | undefined,
  permission: Permission,
): boolean {
  if (!role) return false;
  return ROLE_DEFAULT_PERMISSIONS[role].has(permission);
}

/**
 * Computa permissions efetivas: defaults do role + granted − revoked.
 * Popula cache no user.
 */
export async function computeAndCacheUserPermissions(userId: string): Promise<Set<Permission>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, permissionOverrides: true },
  });
  if (!user) return new Set();

  const defaults = ROLE_DEFAULT_PERMISSIONS[user.role];
  const revoked = new Set(user.permissionOverrides.filter(o => o.action === 'revoked').map(o => o.permission as Permission));
  const granted = new Set(user.permissionOverrides.filter(o => o.action === 'granted').map(o => o.permission as Permission));

  const effective = new Set<Permission>();
  defaults.forEach(p => { if (!revoked.has(p)) effective.add(p); });
  granted.forEach(p => { if (!revoked.has(p)) effective.add(p); });

  // Persistir cache
  await prisma.user.update({
    where: { id: userId },
    data: { cachedPermissions: Array.from(effective) },
  });

  return effective;
}

/**
 * Invalida cache de um user. Chamado por:
 *  - users.updateRole
 *  - permissions.grant / revoke / restore
 */
export async function invalidateUserPermissionsCache(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { cachedPermissions: [] },
  });
}
```

### 6.2. Middleware tRPC

```ts
// src/server/trpc/middlewares.ts (expandido)

export function withPermission(permission: Permission) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const ok = await hasPermission(ctx.user.id, permission);
    if (!ok) throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Sem permissão: ${permission}`,
    });
    return next();
  });
}

export const requirePermission = (p: Permission) =>
  protectedProcedure.use(withPermission(p));

// Compat: withCapability legado continua funcionando durante refactor
// (será removido no Sprint 15G quando todas as procedures migrarem)
```

### 6.3. Mapa de migração das 47 procedures

Anexar à PR como `docs/rbac-migration-map.md`. Amostra:

| Router | Antes | Depois |
|---|---|---|
| `users.invite` | `withCapability('user', 'create')` | `withPermission('user:create')` |
| `users.updateRole` | `withRoles('ADMIN')` | `withPermission('user:update')` (com verificação SUPER_ADMIN guard preservada) |
| `users.grantPermission` | (nova) | `withPermission('user:grant_permissions')` |
| `companies.create` | `withCapability('company', 'create')` | `withPermission('company:create')` |
| `opportunities.advanceStage` | `withCapability('opportunity', 'advance_stage')` | `withPermission('opportunity:advance_stage')` |
| `proposals.approve` | `withCapability('proposal', 'approve')` | `withPermission('proposal:approve')` |
| `documents.upload` | `withCapability('document', 'create')` | `withPermission('document:upload')` |
| `tasks.create` | `withCapability('opportunity', 'update')` | `withPermission('task:create')` |
| `inbound.viewQueue` | `withRoles('ADMIN', 'GESTOR_INBOUND', 'DIRETOR_COMERCIAL')` | `withPermission('inbound:view_queue')` |
| `inbound.assign` | `withRoles('ADMIN', 'GESTOR_INBOUND', 'DIRETOR_COMERCIAL')` | `withPermission('inbound:assign_prospects')` |
| `aiConfig.updateGlobal` | `withCapability('ai', 'configure')` | `withPermission('ai:configure_global')` |
| `aiConfig.updateFeature` | `withCapability('ai', 'configure')` | `withPermission('ai:configure_feature')` |
| `aiConfig.testKey` | `withCapability('ai', 'configure')` | `withPermission('ai:test_key')` |
| `aiConfig.clearCircuitBreaker` | `withCapability('ai', 'configure')` | `withPermission('ai:manage_breaker')` |
| `reports.export` | `withCapability('opportunity', 'read')` | `withPermission('reports:export')` |
| `imports.create` | `withCapability('company', 'create')` | `withPermission('import:run')` |
| ... (47 total) | | |

**Regra de decoupling:** cada permission nova (25+) recebe um caller único a princípio, mas se DIRETOR_COMERCIAL ganha tanto `reports:read` quanto `reports:financial` no default, backup do padrão anterior é preservado.

---

## 7. UI — `/admin/users/[id]/permissions`

Nova rota. Acesso protegido por `user:grant_permissions`.

### 7.1. Layout

```
┌────────────────────────────────────────────────────────────┐
│ ← Voltar aos usuários                                      │
│                                                            │
│ Maria Silva                                                │
│ ANALISTA · maria@empresa.com                               │
│                                                            │
│ Total efetivo: 22 permissões (18 do perfil + 5 concedidas  │
│ − 1 revogada)                                              │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ 📁 Inbound                                                 │
│  ✅ Ver fila de prospects inbound        [Revogar]         │
│      concedida em 27/06 por Fred M. — "Migrado do 15E"     │
│  ✅ Alocar prospects inbound             [Revogar]         │
│      concedida em 27/06 por Fred M.                        │
│  ☐ Configurar captura inbound (forms)   [Conceder]         │
│  ✅ Ver relatório Inbound × Outbound     [Revogar]         │
│                                                            │
│ 📁 Reports                                                 │
│  ✅ Ver relatórios (do perfil ANALISTA)                    │
│  ❌ Ver dados financeiros (REVOGADA)     [Restaurar padrão]│
│      revogada em 25/06 por Fred M. — "Não pra estagiária"  │
│  ☐ Exportar relatórios em Excel         [Conceder]         │
│                                                            │
│ 📁 AI                                                      │
│  ✅ Usar resumo de comunicações (do perfil)                │
│  ☐ Configurar provider padrão           [Conceder]         │
│  ...                                                       │
└────────────────────────────────────────────────────────────┘
```

### 7.2. Componentes-chave

- Header: PageHeader (P-02 pattern) com breadcrumb "Usuários › Maria Silva › Permissões"
- Contagem no topo (efetivo + composição transparente)
- Categorias como `<details>` colapsáveis (SUMMARIZATION, GENERATION visíveis por padrão)
- Cada permission linha:
  - Ícone estado (✅ / ❌ / ☐)
  - Label + hint text (categoria)
  - Botão contextual (Conceder / Revogar / Restaurar padrão)
  - Se override, mostrar "concedida/revogada em DATA por PESSOA — 'motivo'" em muted text
- Rodapé: campo `<Textarea placeholder="Motivo (opcional)">` que se aplica ao próximo toggle
- Filtro por categoria no topo (opcional)

### 7.3. tRPC calls

```ts
const { data } = trpc.permissions.forUser.useQuery({ userId });
const grant = trpc.permissions.grant.useMutation({ onSuccess: () => utils.permissions.forUser.invalidate({ userId }) });
const revoke = trpc.permissions.revoke.useMutation({ ... });
const restore = trpc.permissions.restore.useMutation({ ... });
```

---

## 8. Router tRPC — `permissions`

```ts
// src/server/trpc/routers/permissions.ts

export const permissionsRouter = router({
  // Catálogo (qualquer user autenticado — pra UI mostrar labels)
  listCatalog: protectedProcedure.query(() => PERMISSIONS_CATALOG),

  // Effective permissions de um user (defaults + overrides)
  forUser: requirePermission('user:read')
    .input(z.object({ userId: zUuid }))
    .query(async ({ input, ctx }) => {
      const user = await prisma.user.findFirst({
        where: { id: input.userId, tenantId: ctx.tenantId, deletedAt: null },
        include: {
          permissionOverrides: {
            include: { grantedByUser: { select: { id: true, fullName: true } } },
            orderBy: { grantedAt: 'desc' },
          },
        },
      });
      if (!user) throw new TRPCError({ code: 'NOT_FOUND' });

      const defaults = Array.from(ROLE_DEFAULT_PERMISSIONS[user.role]);
      const effective = user.cachedPermissions ?? (await computeAndCacheUserPermissions(user.id)).values();

      return {
        userId: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        defaults,
        overrides: user.permissionOverrides,
        effective: Array.from(effective),
      };
    }),

  // Concede permission
  grant: requirePermission('user:grant_permissions')
    .input(z.object({
      userId: zUuid,
      permission: z.string(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      validatePermissionInCatalog(input.permission);
      await ensureSameTenant(input.userId, ctx.tenantId);

      await prisma.userPermissionOverride.upsert({
        where: { user_permission_unique: { userId: input.userId, permission: input.permission } },
        create: {
          userId: input.userId,
          tenantId: ctx.tenantId,
          permission: input.permission,
          action: 'granted',
          grantedBy: ctx.user.id,
          reason: input.reason ?? null,
        },
        update: {
          action: 'granted',
          grantedBy: ctx.user.id,
          grantedAt: new Date(),
          reason: input.reason ?? null,
        },
      });

      await invalidateUserPermissionsCache(input.userId);

      await audit({
        action: 'user.permission_granted',
        tableName: 'user_permission_overrides',
        recordId: input.userId,
        tenantIdOverride: ctx.tenantId,
        after: { permission: input.permission, reason: input.reason },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { ok: true };
    }),

  // Revoga permission (mesmo padrão de grant, action='revoked')
  revoke: requirePermission('user:grant_permissions')
    .input(z.object({ userId: zUuid, permission: z.string(), reason: z.string().max(500).optional() }))
    .mutation(async ({ input, ctx }) => { /* análogo */ }),

  // Deleta override — volta a usar default do role
  restore: requirePermission('user:grant_permissions')
    .input(z.object({ userId: zUuid, permission: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await prisma.userPermissionOverride.deleteMany({
        where: { userId: input.userId, permission: input.permission, tenantId: ctx.tenantId },
      });
      await invalidateUserPermissionsCache(input.userId);
      await audit({ action: 'user.permission_restored', ... });
      return { ok: true };
    }),

  // Lista users com uma permission (útil pra notificações "quem alocar prospect?")
  whoHas: requirePermission('user:read')
    .input(z.object({ permission: z.string() }))
    .query(async ({ input, ctx }) => {
      return prisma.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          deletedAt: null,
          active: true,
          cachedPermissions: { has: input.permission },
        },
        select: { id: true, fullName: true, email: true, role: true },
      });
    }),
});
```

---

## 9. Compatibilidade

### 9.1. `approval_rules.approver_permission`

Novo campo alternativo a `approver_roles`. Service `approval-engine.service.ts` atualiza:

```ts
async function selectApplicableRules(...): Promise<...> {
  const rules = await prisma.approvalRule.findMany({ ... });
  for (const rule of rules) {
    let approvers: User[];
    if (rule.approverPermission) {
      // Novo: buscar via permission
      approvers = await prisma.user.findMany({
        where: {
          tenantId,
          cachedPermissions: { has: rule.approverPermission },
          deletedAt: null,
          active: true,
        },
      });
    } else if (rule.approverRoles && rule.approverRoles.length > 0) {
      // Antigo: buscar via role
      approvers = await prisma.user.findMany({
        where: {
          tenantId,
          role: { in: rule.approverRoles },
          deletedAt: null,
          active: true,
        },
      });
    }
    // ...
  }
}
```

Backward compatible: regras existentes continuam funcionando.

### 9.2. Sidebar / BottomNav

Renderização condicional. Hoje usa `withRoles` implicit. Mudar pra `hasPermissionByRole`:

```tsx
{hasPermissionByRole(user.role, 'inbound:view_queue') && (
  <SidebarLink href="/inbox/prospects" icon={...}>Inbox de prospects</SidebarLink>
)}
```

Backend sempre re-valida — UI é hint apenas.

### 9.3. `/inbox/prospects` (Sprint 15D)

Antes:
```ts
withRoles('ADMIN', 'GESTOR_INBOUND', 'DIRETOR_COMERCIAL')
```

Depois:
```ts
withPermission('inbound:view_queue')
```

Migration backfilla os 4 grants → comportamento idêntico do ponto de vista do user.

### 9.4. `users.invite` — permissions iniciais opcionais

```ts
users.invite({
  email, fullName, role,
  initialPermissionOverrides: {                     // NOVO opcional
    granted: ['inbound:view_queue'],
    revoked: ['reports:financial'],
  },
});
```

Admin convida ANALISTA mas com permissions extra pré-aplicadas. UI do modal invite ganha collapsible "Permissões avançadas".

---

## 10. Testes

### 10.1. Unit

- `tests/unit/permissions-catalog.test.ts`
  - Catálogo bem formado (keys únicas, categorias válidas)
  - Todos os `Permission` types checados
  - ~65 permissions esperadas

- `tests/unit/role-default-permissions.test.ts`
  - Cada role tem N permissions esperadas (snapshot)
  - PARCEIRO tem só as 6 esperadas (test de isolamento)
  - Nenhum role tem permissions fora do catálogo

- `tests/unit/has-permission-with-overrides.test.ts` (10+ casos)
  - Sem override → usa default do role
  - Granted → true mesmo se default não tem
  - Revoked → false mesmo se default tem
  - Granted + Revoked mesma permission (conflito) → revoked vence
  - Platform Owner → true pra qualquer permission
  - User inativo → false pra qualquer permission
  - User soft-deleted → false
  - Cache hit
  - Cache miss + populate
  - Invalidação após grant/revoke/restore

- `tests/unit/permission-cache-invalidation.test.ts` (4 casos)
  - Mudar role → invalida
  - Grant → invalida
  - Revoke → invalida
  - Restore → invalida

- `tests/unit/rbac-migration-backfill.test.ts`
  - Query SQL do backfill (mock DB): GESTOR_INBOUND vira ADMIN + 4 grants

### 10.2. Integração

- `tests/integration/permissions-router.test.ts`
  - `listCatalog` retorna catálogo
  - `forUser` retorna structure completa
  - `grant` cria override + invalida cache + audit
  - `revoke` idem
  - `restore` deleta override + invalida cache
  - `whoHas` retorna users com a permission
  - Tenant isolation: user tenant A não vê overrides de user tenant B

- `tests/integration/approval-rules-by-permission.test.ts`
  - Rule com `approver_permission` = 'proposal:approve' resolve corretamente
  - Rule com `approver_roles = [ADMIN]` continua funcionando (backward compat)
  - CHECK constraint: rule não pode ter ambos

- `tests/integration/rbac-migrated-procedures.test.ts` (smoke ampla)
  - 5-10 procedures aleatórias migradas ainda respondem 403 sem permission e 200 com

### 10.3. E2E

- ADMIN entra em `/admin/users/[id]/permissions`, concede `inbound:view_queue` a um ANALISTA → ANALISTA passa a ver `/inbox/prospects` sem reload
- ADMIN revoga `reports:financial` de um DIRETOR_COMERCIAL → DIRETOR para de ver coluna de valores em `/reports`
- ANALISTA tenta acessar `/admin/users/[id]/permissions` → 403 (não tem `user:grant_permissions`)

---

## 11. Critérios de aceite

### Funcional
- [ ] Migration 0030 aplicada em dev (Neon)
- [ ] Todos os GESTOR_INBOUND migrados pra ADMIN + 4 permissions grants
- [ ] `permissions_catalog.ts` com ~65 permissions (35 atuais + 30 novas)
- [ ] `ROLE_DEFAULT_PERMISSIONS` refletindo matriz revisada
- [ ] `hasPermission(userId, perm)` async com cache funcional
- [ ] `hasPermissionByRole(role, perm)` síncrono pra UI
- [ ] `withPermission(perm)` middleware tRPC funcional
- [ ] **47 procedures migradas** de `withRoles`/`withCapability` pra `withPermission`
- [ ] Mapping doc `docs/rbac-migration-map.md` completo
- [ ] `permissions.{listCatalog, forUser, grant, revoke, restore, whoHas}` procedures
- [ ] `approval_rules.approver_permission` funciona como alternativa

### UI
- [ ] `/admin/users/[id]/permissions` lista permissions por categoria com 3 estados visuais
- [ ] Botões Conceder/Revogar/Restaurar funcionais
- [ ] Contagem transparente (defaults + granted − revoked)
- [ ] Histórico de mudanças visível inline (quem, quando, por quê)
- [ ] Justification opcional
- [ ] Audit log gerado em cada mudança com `tenantIdOverride`
- [ ] Sidebar/BottomNav renderizam links condicionalmente
- [ ] `users.invite` modal ganha collapsible "Permissões avançadas"

### Sprint 15D compatibility
- [ ] `/inbox/prospects` continua acessível pelos mesmos users
- [ ] Botão "Alocar" continua disponível
- [ ] Notificações inbound continuam chegando
- [ ] `GESTOR_INBOUND` **removido** do enum sem quebrar código

### Sprint 15F compatibility
- [ ] Novas permissions `ai:configure_global` / `ai:configure_feature` / `ai:test_key` / `ai:manage_breaker` funcionam
- [ ] Card A / Card B de `/admin/ai` continuam acessíveis ao ADMIN (default)

### Performance
- [ ] `hasPermission` async + cache ≤ 5ms em request típico (medido com `console.time`)
- [ ] Cache invalidation acontece em < 200ms após mudança (medido em test)
- [ ] Backfill da migration completa em ≤ 30s pro pior caso (1000 GESTOR_INBOUND users)

### Qualidade
- [ ] **576 tests baseline atual** continuam passando
- [ ] **≥ 25 tests novos** (10 unit + 3 integração + 10 E2E-ish + 2 migration)
- [ ] Type-check zero
- [ ] Lint zero
- [ ] PR description tem mapping old → new completo

---

## 12. Esforço revisado

| Atividade | Dias |
|---|---|
| Permissions catalog (65 items) + types + matriz de defaults | 0.75 |
| Migration 0030 + backfill + prisma schema | 1.0 |
| Refactor `rbac.ts` + `middlewares.ts` + cache | 1.5 |
| Refactor das **47 procedures** pra `withPermission` | 2.5 |
| UI `/admin/users/[id]/permissions` + componentes | 1.5 |
| `approval_rules.approver_permission` + service update | 0.75 |
| Sidebar/BottomNav condicional + modal invite advanced | 0.5 |
| Migração de tests existentes que assumiam role-based | 0.5 |
| Testes novos + smoke + E2E | 1.0 |
| **Total** | **~10 dias** |

(v1 estimou 7d com 30 procedures; v2 com 47 procedures + splits granulares em AI = ~10 dias realista.)

---

## 13. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Refactor de 47 procedures introduz regressão silenciosa | Mapping doc + `docs/rbac-migration-map.md` + smoke test por router + PR splittable em 3-4 (por categoria de recurso) |
| Cache stale → user perde/ganha acesso após mudança | Invalidação nas 3 mutations + no update de role + TTL implícito (recomputa sempre que query hidrata `cachedPermissions=null`) |
| Permission errada concedida via UI por engano | Confirmação inline + audit log + UI mostra "concedida em X por Y — motivo" pra rastreabilidade |
| Approval rules quebram por causa de modo dual | Backward compat testado + CHECK constraint garante exclusividade |
| Migration 0030 falha por CAST enum em prod | Padrão migration-pitfalls #1 aplicado (via text intermediário) + rollback plan documentado |
| Sprint 15D adicionou `GESTOR_INBOUND` em `approval_rules.approver_roles` de algum tenant seed | Migration 0030 sanitiza com `array_remove` antes de castar |
| Sprint 15F já tem permission `ai:configure` — colisão com split granular | Preservar `ai:configure` como alias (default para o dueto `ai:configure_global` + `ai:configure_feature`) OU migrar catallers em uma passada só |
| Testes existentes assumem role check em mocks | Refactor mecânico: substituir `role: 'ADMIN'` por `cachedPermissions: ['user:create', ...]` — grep pattern |

---

## 14. Pós-sprint

- Atualizar `CLAUDE.md` marcando Sprint 15E concluído
- Atualizar `docs/Backlog_Pos_MVP.md` zerando débito "proliferação de roles"
- Migration 0030 aplicada em Neon dev + preparar plano de produção
- Memory nova: `rbac-granular-pattern.md` com regras de quando criar permission vs role
- Comunicar Platform Owner: futuras features "Gestor de X" viram permission override, não role nova
- Sprint 15G candidato: audit UI (lista de mudanças de permissions filtrable por usuário)

---

## 15. Ordem de execução recomendada

Sprint deve ser feito em 4 fases sequenciais (cada uma commitável e testável):

**Fase 1 — Fundação (2d)**
1. `permissions-catalog.ts` (65 items)
2. `ROLE_DEFAULT_PERMISSIONS` (7 roles × N permissions)
3. Migration 0030 + prisma schema
4. Refactor `rbac.ts` novo + `middlewares.ts` (`withPermission`)
5. Preservar `withCapability` legado em paralelo (não quebra nada ainda)

**Fase 2 — Refactor procedures (3d)**
1. Grep todas as 47 ocorrências
2. Migrar 10-15 por dia, commitando em grupos por categoria (companies/contacts/opps → proposals/contracts/tasks → inbound/reports/ai → users/audit/imports)
3. Testes de smoke por rota migrada

**Fase 3 — UI (2d)**
1. `/admin/users/[id]/permissions` page + `permissions` router
2. Modal invite avançado
3. Sidebar/BottomNav condicionais

**Fase 4 — Compatibilidade + validação (2d)**
1. `approval_rules.approver_permission`
2. E2E tests
3. Backfill validation
4. CLAUDE.md + backlog + memory

**Buffer:** 1 dia pra imprevistos (backfill lento, mock de tests que quebram etc). Total: **~10 dias com buffer**.

---

## 16. Referências

- Sprint 15D: `docs/Sprint_15D_Inbound_Marketing.md` — origem do `GESTOR_INBOUND` como caso âncora
- Sprint 15F: `docs/Sprint_15F_IA_Multi_Provider.md` — origem das permissions AI granulares
- Memory: `migration-pitfalls.md` — padrões aplicados na 0030
- Rbac atual: `src/lib/auth/rbac.ts`
- Middlewares atual: `src/server/trpc/middlewares.ts`
- Backlog: `docs/Backlog_Pos_MVP.md` — Sprint 15E pendente lá
