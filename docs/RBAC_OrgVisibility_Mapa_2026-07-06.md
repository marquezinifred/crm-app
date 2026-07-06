# Permissões × Estrutura Organizacional × Reportes — Mapa do Existente
**Data:** 2026-07-06 · **Contexto:** pergunta ao PO sobre 3 eixos de RBAC — perfil × funcionalidade, estrutura organizacional × visibilidade, modelo de reportes comerciais.

## Resumo executivo (3 frases)
O CRM cobre **1 dos 3 eixos completamente** (perfil × funcionalidade via Sprint 15E), **1 parcialmente** (visibilidade via `ownerId` + team members), e **1 nada** (hierarquia organizacional formal). O eixo 3 (estrutura + reportes) já está **planejado como débito Sprint 15G** ("row-level permissions"), mas sem spec detalhada. `Territory` e `Segment` existem no schema mas são apenas listas de valores — não têm ownership nem hierarquia.

---

## Os 3 eixos que você levantou

| Eixo | Status | Onde vive |
|------|--------|-----------|
| **1. Perfil × funcionalidade** ("quem pode fazer o quê") | ✅ Completo (Sprint 15E) | `src/lib/auth/permissions-catalog.ts` (61 permissions), `src/lib/auth/rbac.ts` (7 roles + defaults), `user_permission_overrides` (overrides individuais) |
| **2. Visibilidade de dados** ("quem vê qual oportunidade") | 🟡 Parcial — só `owner + team.some + PARCEIRO` | `src/server/trpc/routers/opportunities.ts:46-72` (`visibilityWhere`), replicado em `reports.ts:50-71` |
| **3. Estrutura organizacional / reportes** ("hierarquia gestor→analista→time") | ❌ Inexistente | — |

---

## Eixo 1 — Perfil × funcionalidade (o que já resolvemos)

**Sprint 15E fechou:**
- Catálogo de **61 permissions** em 17 categorias (`proposal:approve`, `opportunity:read_others`, `inbound:assign_prospects`, etc)
- **7 roles** como perfis padrão: ADMIN (60 permissions), DIRETOR_COMERCIAL (39), DIRETOR_OPERACOES (25), DIRETOR_FINANCEIRO (18), GESTOR (31), ANALISTA (23), PARCEIRO (5)
- **Overrides individuais**: admin concede/revoga permission por user sem mudar role (`user_permission_overrides` + `users.cached_permissions`)
- **Guard anti-escalada** (§6.5): caller só delega o que ele próprio tem
- **Kill-switch** `RBAC_GRANULAR_ENABLED` runtime real (P-62)

**Usado em:** `withPermission('resource:action')` em ~34 procedures tRPC + sidebar filter no frontend (`hasPermissionByRole`).

**Consequência:** o eixo 1 é o **único que respeita overrides individuais**. Eixo 2 (visibilidade) e o approval engine legado **ignoram overrides** — mais sobre isso abaixo.

---

## Eixo 2 — Visibilidade de dados (o que existe, parcialmente)

### Modelos que participam da visibilidade

```
Opportunity ── ownerId ──────────► User         (dono principal, obrigatório)
            ── partnerCompanyId ─► Company      (parceiro, opcional)
            ◄─ OpportunityTeam ── userId → User (membros compartilhados)
            ├─ isInbound / inboundSource       (Sprint 15D)
            └─ clientCompany.{territoryId, segmentId}

PartnerEngagement(opportunityId, partnerCompanyId, status)  // gate PARCEIRO
```

### Regra de visibilidade aplicada (opportunities + reports)

```typescript
// opportunities.ts:46-72 (mesma em reports.ts:50-71)
async function visibilityWhere(userId, role, partnerCompanyId) {
  if (role === 'PARCEIRO') {
    if (!partnerCompanyId) return { id: 'zero-uuid' }; // vê nada
    return {
      partnerCompanyId,
      partnerEngagements: { some: { partnerCompanyId, status: 'APPROVED' } },
    };
  }
  const canSeeAll = await hasPermission(userId, 'opportunity:read_others');
  if (canSeeAll) return {}; // ADMIN, DIRETORES, GESTOR por default
  return {
    OR: [{ ownerId: userId }, { team: { some: { userId } } }],
  }; // ANALISTA (breaking change 15E) + qualquer role sem override
}
```

**Tradução em plain English:**
- **PARCEIRO** — vê só as opps que estão sob sua Company + engagement APROVADO. Filtro row-level rígido, ignora RBAC.
- **Todos os outros** — check permission `opportunity:read_others`. Se tem → vê tudo do tenant. Se não → só `ownerId=me OR team.some(userId=me)`.
- **ANALISTA** — não tem `opportunity:read_others` por default (breaking change 15E), então cai no filtro `owner OR team`.

### Report especial

- `reports.performanceByOwner` (reports.ts:174-187): ANALISTA vê **só a própria linha** + `teamAverage` anônima. Comparação social, sem cross-view.
- `reports.timePerStage`, `revenueProjection`, `inboundVsOutbound`: aplicam `loadOpps` que reusa a mesma `visibility()`.

### Gaps do eixo 2

- **Sem hierarquia**: Gestor não tem noção de "meus analistas". Se quer ver as opps de subordinados, precisa: (a) ter permission `opportunity:read_others` (vê tudo do tenant), ou (b) ser owner/team member em cada opp individual.
- **Territory/Segment são invisíveis pra RBAC**: existem só como filtro de UI. Nenhum user "possui" um território.
- **Cross-tenant impossível** (feature): mesmo Platform Owner precisa impersonate.

---

## Eixo 3 — Estrutura organizacional / reportes (o que NÃO existe)

**Zero campos no schema:**
```bash
$ grep "managerId|reportsTo|subordinate|hierarchy|orgUnit|teamId" prisma/schema.prisma
# ← sem hits
```

**Nenhuma entidade** `Team`, `Squad`, `Area`, `Departamento`, `CargoHierarquico`, `OrgUnit`.

**Territory e Segment** existem mas são **listas simples** (nome + tenant + soft delete):
```prisma
model Territory { id, tenantId, name, ... }  // sem ownerId, sem parentId
model Segment   { id, tenantId, name, ... }  // sem ownerId, sem parentId
```

Não têm gestor associado, não têm árvore, não têm herança de visibilidade.

### O que a estrutura atual permite hoje

- Admin cria uma opp e marca 3 users no `OpportunityTeam` como "analista", "consultor", "backup" (campo `roleInTeam` string livre). Todos veem a opp.
- Não há relatório "todas as opps do time do Gestor Fulano" — precisa hidratar via team.some ou aplicar filtro por ownerId de um vendedor específico.

---

## Débitos já registrados que atacam o gap

- **Sprint 15E (fechado) deixou 3 débitos pro Sprint 15G**:
  - "custom roles" (definir role novo pelo admin)
  - "delegação temporária" (X aprova por Y por 5 dias)
  - **"row-level permissions"** ← este é o gancho pro eixo 2/3
- **P-77** (novo, sugerido durante o P-67 diagnóstico): **approvals fósseis quando rule/role muda** — sintoma do fato de que aprovações são snapshot point-in-time enquanto RBAC é dinâmico
- **P-57** (aberto): design da IA bloqueada por dirty state (não relacionado, contextual)

---

## Descompasso entre RBAC dinâmico × Aprovações snapshot

Descoberto durante P-67. Vale destacar aqui porque toca o mesmo tema:

- Approval engine legado (`approver_roles` — todas as 2 rules do seed) faz `findFirst({ where: { role, active } })` no momento da criação da approval. **Ignora `cached_permissions` e overrides individuais.**
- Approval engine novo (`approver_permission`) faz `findMany({ where: { cached_permissions has 'X' } })` — respeita overrides.
- **Nenhum dos dois** re-avalia quando role/permission/rule muda depois.
- Bug direto: se admin editar rule ou promover user, approvals PENDING antigas ficam órfãs. `/approvals` do novo aprovador correto fica vazio.

---

## Perguntas abertas pro PO (sugeridas)

1. **Modelo de estrutura**: prefere árvore livre (`orgUnit` com `parentId`) ou hierarquia formal fixa (Diretoria → Gerência → Time → Analista)?
2. **Herança de visibilidade**: gestor de um time vê **automaticamente** todas as opps dos subordinados? Ou precisa ter permission explícita?
3. **Reporte transversal**: cross-time (Analista A ajuda em opp do Time B) é caso comum? Se sim, `OpportunityTeam` continua sendo o mecanismo?
4. **Territory/Segment**: viram nós da árvore organizacional ou continuam sendo listas paralelas?
5. **Aprovações órfãs (P-77)**: quando rule muda ou user é promovido, re-avalia approvals PENDING? Ou o admin resolve caso a caso?
6. **Delegação temporária** (débito 15G): mesmo motor que resolveria eixo 3, ou features separadas?
7. **Escopo mínimo**: qual o menor recorte que resolve o problema imediato do Fred (ver as opps do time como Gestor)?

---

## Se o PO responder e for aprovar Sprint 15G/16

**Escopo mínimo sugerido** (pra caber em 1 sprint):
1. Nova entidade `OrgUnit` (id, tenantId, name, parentId, managerId nullable)
2. `User.orgUnitId` opcional
3. `Opportunity` adiciona `orgUnitId` opcional (derivado de owner.orgUnitId no create)
4. `visibilityWhere` novo caminho: `hasPermission('opportunity:read_own_org') ? { orgUnitId: { in: descendantIds(user.orgUnitId) } } : ...`
5. Nova permission `opportunity:read_own_org` no catálogo
6. UI `/admin/organizations` (CRUD árvore) + sidebar
7. Migração: seed com OrgUnit "Root" pra cada tenant existente

**Não incluir na primeira versão:**
- Custom roles (mais complexo, pode virar 15H)
- Delegação temporária (idem)
- Re-avaliação automática de approvals quando estrutura muda (P-77 separado)

**Esforço:** ~5-7 dias.
