# Auditoria — Sprint 15C (2026-06-30)

Resultado dos greps do Passo 0 da spec.

## 1. Selects hardcoded candidatos a listas configuráveis

| Local | O que está hardcoded | Vira tabela |
|---|---|---|
| `src/app/pipeline/new/page.tsx:105-119` | `OpportunitySource` enum (Object.values) | `lead_sources` (FK opcional, mantém enum como fallback) |
| `src/app/contacts/page.tsx:153` | Campo Cargo texto livre (`position`) | `contact_roles` (FK opcional) |
| `src/components/contacts/ContactDetailContent.tsx:82` | Idem | Idem |

**Decisão:** as 3 listas novas (`lead_sources`, `industries`, `contact_roles`) ficam como **FK opcional**, sem quebrar o enum `OpportunitySource` nem o campo `position` que existem hoje. Pipeline/new ganha o select novo se `lead_sources` retornar registros; senão cai no enum como hoje. Sem migration destrutiva.

## 2. Formulários sem toast de sucesso (alvos do hardening cross-form)

- `CompanyForm.tsx` (principal)
- `src/app/pipeline/new/page.tsx`
- `src/app/contacts/page.tsx` (form inline)
- `src/app/admin/products/page.tsx`
- `src/app/admin/contracts/page.tsx`
- `src/app/admin/approval-rules/page.tsx`
- `src/app/admin/conversion-rates/page.tsx`
- `src/app/admin/alerts/page.tsx`
- `src/app/admin/ai/page.tsx`
- `src/app/admin/partners/page.tsx`
- `src/app/admin/users/page.tsx`
- `src/components/pipeline/ProposalsSection.tsx`
- `src/components/pipeline/DocumentsSection.tsx`

**Excluídos do escopo (15A — Platform):** `platform/broadcasts`, `platform/tenants`, `platform/impersonate`.

## 3. Dialogs/Sheets sem `overflow-y-auto`

**Zero ocorrências fora do design system.** O componente `Modal` (Sprint 14.5) e `Sheet` (Sprint 14.5) já têm o tratamento. Não há `DialogContent` cru — todos os modais passam pelo `Modal` wrapper que já tem scroll. **Item 2a resolvido sistemicamente — não precisa correção arquivo a arquivo.**

## 4. Campos referenciando entidades sem QuickCreate

- `companyId` em `pipeline/new` — **alvo principal QuickCreate empresa**
- `contactId` em `pipeline/new` — alvo QuickCreate contato
- `companyId` em `contacts/page` (form inline) — QuickCreate empresa
- `companyId` em `contracts/page` — QuickCreate empresa
- `productId` em `contracts/page` — QuickCreate produto

## 5. Empty states residuais

**Zero ocorrências reais.** Único match é um comentário em `ui/empty-state.tsx`. Item 5e da spec **completo desde Sprint 14.5**.

## 6. CEP / endereço atual

Schema `Company` tem apenas `country` (default 'BR'), `state`, `city`. Nada de CEP/logradouro/bairro. Migration 0022 necessária.

## 7. Dependências

- ✅ `@dnd-kit/sortable@^8` e `@dnd-kit/core@^6` já instalados (Sprint 2)
- ✅ `@radix-ui/react-dialog` (usado em Modal/Sheet)
- ❌ AlertDialog: precisa criar wrapper Radix em `src/components/ui/alert-dialog.tsx`
- ✅ TanStack Query: via tRPC client (mas IBGE não passa por tRPC — usa hook próprio)
- ✅ BrasilAPI tolerância: padrão já estabelecido no CNPJ lookup

## 8. Plano de execução

1. Migrations 0022 + 0023 + schema.prisma
2. Helpers: format CNPJ/CEP, lookup CEP, brasil.ts
3. Routers tRPC: lead-sources, industries, contact-roles
4. AlertDialog primitive + useDirtyConfirm
5. QuickCreateTrigger
6. CompanyForm refactor (consome tudo acima)
7. /admin/listas (5 tabs)
8. Aplicar toast/QuickCreate cross-forms
9. Testes
10. CLAUDE.md
