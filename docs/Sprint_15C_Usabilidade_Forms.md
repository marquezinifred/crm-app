# Sprint 15C — Usabilidade: Forms, Listas Configuráveis e QuickCreate

## Contexto

Durante o uso real do cadastro de oportunidades, foram identificados
padrões de UX que se repetem negativamente em múltiplos formulários
da aplicação. Este sprint resolve esses padrões de forma sistêmica
— não apenas nos formulários reportados, mas em toda a app.

**Leia antes de começar:**
- `docs/venzo_ux_spec.docx` — design system (especialmente seções 4, 5 e 7: componentes base, dados e feedback)
- `docs/venzo_brand_guide.docx` — voz e tom (empty states, mensagens de sucesso/erro)
- Este documento — plano de execução

**Pré-requisito:** Sprint 15B (AI Operations + Plataforma Estratégica)
fechado. Sem 15B fechado, há risco de conflito em arquivos
compartilhados (AppShell.tsx, layout.tsx, schema.prisma) porque 15B
mexe em ContextBanners + migrations 0017–0021. Aguardar fechamento.

**NÃO fazer neste sprint:**
- Novas features de negócio
- Mudanças em lógica tRPC/services existentes
- i18n
- Sprint 15A (Platform Admin) ou 15B (AI Ops) — sprints separados

---

## 🔧 Ajustes vs proposta original

A spec original tinha **3 áreas de overlap** com trabalho já entregue
que foram removidas ou reformuladas. Lista:

### ❌ Removido: Seção 3 — CNPJ Auto-fill base
**Já está feito.** Commit `ff8cf85` (chip CNPJ via BrasilAPI) entregou:
- `src/lib/cnpj/lookup.ts` — service com 5 estados (ok / not-found / inactive / rate-limited / error)
- `src/lib/cnpj/autofill.ts` — integração
- `src/components/companies/CompanyForm.tsx` consome com debounce 500ms + AbortController
- Tests cobrindo cenários

**Deltas legítimos a entregar neste sprint:** ver Seção 3 (reduzida)
abaixo — máscara visual, CEP auto-fill, e novos campos de endereço
(exige migration).

### ❌ Reformulado: Seção 4 — Listas Configuráveis
A proposta original criava tabela genérica `configurable_lists` com
`list_key`. **Conflita com schema existente:**
- `Territory` já é tabela dedicada com FK em opportunities/companies/contacts
- `Segment` já é tabela dedicada com FK em opportunities/companies

Criar `configurable_lists` paralelo duplica modelo. Solução: usar
Territory/Segment existentes (estender CRUD se faltar) + criar APENAS
3 tabelas novas pra listas que não existem: `lead_sources`,
`industries`, `contact_roles`. Mesmo padrão de Territory.

### ❌ Simplificado: Seção 5e — Empty states com voz Venzo
Sprint 14.5 já fez **17 substituições** de "Nenhum.*encontrado". Grep
atual revela só **2 ocorrências residuais**. Não precisa de pass
completo na app inteira — só finalizar as 2.

---

## Passo 0 — Auditoria (executar ANTES de qualquer código)

Antes de implementar qualquer coisa, mapear o estado atual com os
greps abaixo. Salvar o resultado em `docs/auditoria_forms_15C.md`
para ter um mapa do que será corrigido.

```bash
# 1. Selects com opções hardcoded (candidatos a listas configuráveis)
#    Foco nos 3 NOVOS: lead_sources, industries, contact_roles
#    (Territory e Segment já têm tabelas — verificar só se UI usa)
grep -rnE "origem|source|setor|industry|cargo|role.*Decisor|role.*Influenciador" \
  src/components src/app --include="*.tsx" -i

# 2. Formulários sem toast de sucesso após submit
grep -rn "onSubmit\|handleSubmit" src/components src/app --include="*.tsx" | \
  grep -v "toast\|Toast\|sonner" | head -40

# 3. Dialogs/Sheets sem overflow-y-auto (scroll quebrado)
#    DetailSheet do Sprint 14.5 já tem; verificar Modais/Dialogs restantes
grep -rn "DialogContent\|SheetContent" src/components src/app --include="*.tsx" | \
  grep -v "overflow\|scroll" | head -30

# 4. Campos referenciando entidades sem opção de criar inline
grep -rn "companyId\|contactId\|empresaId\|contatoId" \
  src/components --include="*.tsx" | grep -v "QuickCreate\|inline"

# 5. Empty states com texto negativo/genérico (esperado: ~2 ocorrências)
grep -rnE "Nenhum.*encontrado|Não há registros|No results|nenhum item" \
  src/components src/app --include="*.tsx" -i | grep -v "node_modules"

# 6. CEP sem máscara ou auto-fill (CNPJ já feito — não regrep)
grep -rnE "cep|CEP|zip" src/components src/app --include="*.tsx"
```

Registrar em `docs/auditoria_forms_15C.md`:
- Quantos formulários afetados por categoria
- Lista de arquivos a modificar por seção deste sprint
- Confirmar 2 ocorrências residuais de empty states e quais arquivos

---

## Seção 1 — QuickCreate Pattern (componente reutilizável)

### O problema
Ao cadastrar uma oportunidade e a empresa não existir, o usuário é
obrigado a: (1) cancelar o formulário, (2) ir para /companies,
(3) cadastrar a empresa, (4) voltar para /pipeline, (5) recomeçar o
cadastro da oportunidade. Isso acontece também ao criar um contato
e a empresa não existir, e em outros fluxos.

### Solução: componente `<QuickCreateTrigger>`

Criar `src/components/ui/quick-create-trigger.tsx` — um padrão
reutilizável que funciona ao lado de qualquer campo de busca de
entidade.

**Comportamento:**
1. Campo de busca de empresa (Combobox) não encontra resultado
2. Ao lado do campo aparece botão `+ Criar empresa` (visível sempre
   que campo estiver vazio ou sem match)
3. Clicar abre `<Dialog>` com formulário mínimo da entidade (campos
   obrigatórios apenas)
4. Ao salvar: fecha o Dialog, seleciona automaticamente a entidade
   criada no campo original, exibe toast
   `"Empresa [Nome] cadastrada e selecionada"`
5. O formulário pai continua com todos os outros campos preenchidos —
   zero perda de contexto

**Interface do componente:**
```tsx
// Uso no formulário de oportunidade
<QuickCreateTrigger
  entity="company"              // 'company' | 'contact' | 'product'
  onCreated={(id, name) => {    // callback com o novo registro
    form.setValue('companyId', id)
  }}
  triggerLabel="+ Criar empresa"
/>
```

**Formulários mínimos por entidade (dentro do Dialog):**

`entity="company"`:
- Nome/Razão Social (obrigatório)
- CNPJ (opcional, **com auto-fill já existente** — reusa
  `useCompanyForm` ou similar)
- Segmento (select da tabela `Segment`)
- Telefone principal

`entity="contact"`:
- Nome completo (obrigatório)
- E-mail (obrigatório, unique check)
- Empresa (Combobox — com QuickCreate recursivo limitado a 1 nível)
- Cargo (select de `contact_roles` — tabela nova, ver Seção 4)

`entity="product"`:
- Nome (obrigatório)
- Preço unitário
- Unidade

**Onde aplicar após criar o componente:**
- `/pipeline/new` → campo Empresa e campo Contato principal
- `/contacts/new` → campo Empresa
- `/contracts/new` → campo Empresa, Contato, Produto
- `/activities/new` → campo Empresa, Contato
- Qualquer futuro formulário que referencie entidade

### Caso especial: QuickCreate recursivo
Ao criar um contato via QuickCreate e a empresa do contato também
não existir, permitir QuickCreate de empresa **dentro** do Dialog de
contato (limitado a 1 nível de profundidade). UI: indicar com
breadcrumb "Novo contato › Nova empresa" no header do segundo Dialog.

---

## Seção 2 — Correções no Formulário de Empresa

O formulário de empresa tem pelo menos 4 problemas identificados.
Corrigir todos:

### 2a. Scroll quebrado — não vê o botão Salvar

O `DialogContent` ou `SheetContent` do formulário de empresa não tem
`overflow-y-auto`. O formulário ultrapassa a altura da viewport e o
botão Salvar fica oculto abaixo da dobra.

**Nota:** o componente Sheet do Sprint 14.5 (DetailSheet com
intercepting routes) já tem este tratamento. Auditar Dialog/Modal
genéricos restantes (provavelmente em forms admin/* e quickly created
dialogs).

**Correção padrão para TODOS os modais/sheets com formulário:**
```tsx
<DialogContent className="max-h-[90vh] overflow-y-auto">
  <DialogHeader>...</DialogHeader>
  <form>
    {/* campos */}
  </form>
  {/* botões de ação fixos na base */}
  <DialogFooter className="sticky bottom-0 bg-background pt-4 border-t">
    <Button variant="ghost" onClick={onClose}>Cancelar</Button>
    <Button type="submit" disabled={isSubmitting}>
      {isSubmitting ? <Spinner /> : 'Salvar empresa'}
    </Button>
  </DialogFooter>
</DialogContent>
```

**Aplicar em TODOS os formulários identificados na auditoria
(Passo 0).**

### 2b. Sem toast de sucesso após salvar

Após qualquer create/update/delete bem-sucedido, exibir toast com
voz Venzo (não genérico). ToastProvider já existe (Sprint 14.5).

| Ação | Toast |
|------|-------|
| Criar empresa | `"[Nome da empresa] adicionada ao seu portfólio."` |
| Atualizar empresa | `"Dados de [Nome] atualizados."` |
| Criar contato | `"[Nome] adicionado como contato."` |
| Criar oportunidade | `"Oportunidade [Nome] criada no pipeline."` |
| Excluir registro | `"[Nome] removido. Desfazer?"` (com action de undo por 5s) |

**Padrão de implementação:**
```tsx
const { mutate } = trpc.companies.create.useMutation({
  onSuccess: (data) => {
    toast.success(`${data.name} adicionada ao seu portfólio.`)
    onCreated?.(data.id, data.name)
    onClose()
  },
  onError: (err) => {
    toast.error('Não foi possível salvar. Tente novamente.')
  }
})
```

**Aplicar em TODOS os formulários identificados na auditoria.**

### 2c. Campos País / Estado / Cidade

**País:** simplificar. 95%+ das empresas do Venzo serão brasileiras.
Campo País com valor default "Brasil" preenchido automaticamente,
editável se necessário. Lista de países: usar array estático de ~30
países mais comuns em `src/lib/data/paises.ts`. Sem API externa.

**Estado (UF):** 27 estados brasileiros — lista estática em
`src/lib/data/brasil.ts`. Não precisa de CRUD nem API. Ordenar
alfabeticamente. Ao selecionar Estado, filtrar cidades.

**Cidade:** usar API do IBGE para listar municípios do estado
selecionado:
```
GET https://servicodados.ibge.gov.br/api/v1/localidades/estados/{uf}/municipios
```
Resposta cached em memória após primeira chamada por UF (via
TanStack Query `staleTime: Infinity`). Exibir como Combobox com
busca. Sem necessidade de salvar no banco — é dado de referência
público.

```tsx
// src/lib/data/brasil.ts
export const ESTADOS_BR = [
  { uf: 'AC', nome: 'Acre' },
  { uf: 'AL', nome: 'Alagoas' },
  // ... todos os 27
]

// hook para cidades
export function useCidadesByUF(uf: string | null) {
  return useQuery({
    queryKey: ['cidades', uf],
    queryFn: () => uf
      ? fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`)
          .then(r => r.json())
      : [],
    enabled: !!uf,
    staleTime: Infinity, // municípios não mudam
  })
}
```

### 2d. Migration nova para campos de endereço completos

O schema atual de `Company` tem `country`, `state`, `city` apenas.
A spec original previa endereço completo (logradouro, numero,
complemento, bairro, cep) que não cabia. Adicionar nesta sprint:

**Migration `0022_company_address`:**
```sql
ALTER TABLE companies
  ADD COLUMN cep              TEXT,
  ADD COLUMN logradouro       TEXT,
  ADD COLUMN numero           TEXT,
  ADD COLUMN complemento      TEXT,
  ADD COLUMN bairro           TEXT;

-- Índice CEP pode ser útil pra agrupamentos territoriais futuros
CREATE INDEX companies_cep_idx ON companies(tenant_id, cep) WHERE cep IS NOT NULL;
```

Atualizar `prisma/schema.prisma` com os campos opcionais.

---

## Seção 3 — CEP Auto-fill + Máscara CNPJ

### Contexto
CNPJ auto-fill já está implementado (commit `ff8cf85`,
`src/lib/cnpj/lookup.ts` + `autofill.ts`). **Esta seção entrega
APENAS os deltas que faltam:**

1. **Máscara visual no input de CNPJ** — hoje aceita digitação livre
2. **CEP auto-fill** — análogo ao CNPJ, novo
3. **Preencher campos novos** de endereço criados na Seção 2d

### 3a. Máscara visual CNPJ

```tsx
// src/lib/utils/format.ts (criar formatCNPJ/unformatCNPJ se não
// existir)
export function formatCNPJ(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0,2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8)}`;
  return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8,12)}-${digits.slice(12)}`;
}

export function unformatCNPJ(value: string): string {
  return value.replace(/\D/g, '');
}
```

**Integração no CompanyForm:**
```tsx
<Input
  placeholder="00.000.000/0000-00"
  value={formatCNPJ(form.cnpj)}
  onChange={e => setForm({ ...form, cnpj: unformatCNPJ(e.target.value) })}
  maxLength={18}
/>
```

Manter a chamada de `lookupCnpj()` já implementada que dispara em
debounce 500ms quando 14 dígitos válidos.

### 3b. CEP auto-fill via BrasilAPI

**API:** `GET https://brasilapi.com.br/api/cep/v2/{cep}`

Retorna: `cep`, `state`, `city`, `neighborhood`, `street`, `service`
+ `location.coordinates` (opcional).

**Service:** `src/lib/cep/lookup.ts`:
```ts
const ENDPOINT = 'https://brasilapi.com.br/api/cep/v2';

export interface CepData {
  cep: string;
  state: string;       // 'SP'
  city: string;        // 'São Paulo'
  neighborhood: string;
  street: string;
}

export type CepLookupResult =
  | { status: 'ok'; data: CepData }
  | { status: 'not-found' }
  | { status: 'rate-limited' }
  | { status: 'error'; message: string };

export async function lookupCep(cep: string): Promise<CepLookupResult> {
  const digits = cep.replace(/\D/g, '');
  if (digits.length !== 8) return { status: 'error', message: 'CEP deve ter 8 dígitos' };

  try {
    const res = await fetch(`${ENDPOINT}/${digits}`, {
      headers: { 'Accept': 'application/json' },
    });
    if (res.status === 404) return { status: 'not-found' };
    if (res.status === 429) return { status: 'rate-limited' };
    if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
    const raw = await res.json();
    return {
      status: 'ok',
      data: {
        cep: digits,
        state: String(raw.state || '').trim(),
        city: String(raw.city || '').trim(),
        neighborhood: String(raw.neighborhood || '').trim(),
        street: String(raw.street || '').trim(),
      },
    };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}
```

**Máscara:** `00000-000` (8 dígitos). Similar a CNPJ:
```ts
export function formatCEP(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0,5)}-${digits.slice(5)}`;
}
```

**Integração no CompanyForm:**
- Debounce 500ms no input CEP
- Quando ok: pre-fill `logradouro` (street), `bairro` (neighborhood),
  `state`, `city`. NÃO sobrescrever campos já preenchidos manualmente.
- Toast discreto: `"Endereço preenchido via CEP ✓"`
- Erro silencioso (sem toast) pra rate-limited / not-found —
  vendedor digita manual

### Onde aplicar
- `src/components/companies/CompanyForm.tsx` (form principal de
  empresa criar/editar — modal inline pós-fix 54dab90)
- Form mínimo do `<QuickCreateTrigger entity="company">` se for
  útil ali (decidir: pode aumentar latência do quick create; sugiro
  só na criação completa, não no quick)

---

## Seção 4 — Listas Configuráveis pelo Admin

### O problema
Campos como Origem do Lead, Setor de Indústria, Cargo padrão de
Contato estão hardcoded no código. Admin não consegue adicionar
"Inbound" como origem nem "Agronegócio" como setor sem deploy.

### Solução: aproveitar Territory/Segment existentes + criar 3 tabelas novas

Territory e Segment já são tabelas dedicadas no schema (Sprint 1).
Verificar/garantir que têm CRUD completo no admin (`/admin/listas?tab=territorios`
e `?tab=segmentos`). Se faltar UI, criar — sem mexer no schema dessas.

**Criar 3 tabelas novas** (mesmo padrão de Territory/Segment):

**Migration `0023_configurable_lists`:**
```sql
-- Origens de lead/oportunidade
CREATE TABLE lead_sources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  position    INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES users(id),
  updated_by  UUID REFERENCES users(id),
  deleted_at  TIMESTAMPTZ,
  UNIQUE(tenant_id, name) WHERE deleted_at IS NULL
);

CREATE INDEX lead_sources_tenant_active_idx
  ON lead_sources(tenant_id, is_active, position)
  WHERE deleted_at IS NULL;

-- Setores de indústria (vertical da empresa cliente)
CREATE TABLE industries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  cnae_prefix TEXT,                  -- opcional: prefixo CNAE pra auto-mapear
  position    INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES users(id),
  updated_by  UUID REFERENCES users(id),
  deleted_at  TIMESTAMPTZ,
  UNIQUE(tenant_id, name) WHERE deleted_at IS NULL
);

-- Cargos/funções de contato (decisor/influenciador/usuário…)
CREATE TABLE contact_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  weight      INT NOT NULL DEFAULT 1,   -- influência decisória (1-5)
  position    INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES users(id),
  updated_by  UUID REFERENCES users(id),
  deleted_at  TIMESTAMPTZ,
  UNIQUE(tenant_id, name) WHERE deleted_at IS NULL
);

-- Adicionar FK opcional em opportunities/contacts pra usar as listas
ALTER TABLE opportunities
  ADD COLUMN lead_source_id UUID REFERENCES lead_sources(id);

ALTER TABLE companies
  ADD COLUMN industry_id UUID REFERENCES industries(id);

ALTER TABLE contacts
  ADD COLUMN contact_role_id UUID REFERENCES contact_roles(id);
```

**Seed com valores padrão** (atualizar `prisma/seed.ts` pra criar
em cada tenant novo):

| Tabela | Valores padrão |
|---|---|
| `lead_sources` | Indicação · Site · LinkedIn · Evento · Cold Outreach · Parceiro · Inbound |
| `industries` | Tecnologia · Manufatura · Saúde · Financeiro · Varejo · Agronegócio · Construção · Logística · Educação |
| `contact_roles` | Decisor · Influenciador · Usuário · Técnico · Financeiro · Jurídico |

**tRPC routers** `src/server/trpc/routers/lead-sources.ts`,
`industries.ts`, `contact-roles.ts` (mesmo padrão de
`territories.ts` se existir):

```typescript
leadSources.list()                    // GET — usado pelos selects
leadSources.create({ name })          // POST — admin only
leadSources.update({ id, name, position, isActive })
leadSources.delete({ id })            // soft delete (rejeita se em uso)
leadSources.reorder({ ids })          // drag-to-reorder
```

Mesmo padrão para `industries.*` e `contactRoles.*`.

**Página unificada** `src/app/admin/listas/page.tsx`:
- Tabs: **Territórios** | **Segmentos** | **Origens** | **Setores** |
  **Cargos**
- Cada tab: lista com drag-to-reorder (usando `@dnd-kit/sortable`),
  toggle ativo/inativo, botão editar nome, botão excluir (só se não
  usado em nenhum registro — checar `count(*)` via tRPC)
- Botão "+ Adicionar" abre inline form na lista (não modal)

**Soft delete inteligente:**
```ts
// no delete procedure, antes do soft delete:
const inUseCount = await prisma.opportunity.count({
  where: { leadSourceId: input.id, deletedAt: null },
});
if (inUseCount > 0) {
  throw new TRPCError({
    code: 'CONFLICT',
    message: `Esta origem está em uso em ${inUseCount} oportunidade(s). Desative em vez de excluir.`,
  });
}
```

**Botão de atalho nos formulários** — para usuários com role `ADMIN`
ou superior, adicionar ícone ⚙️ ao lado de cada Select configurável:
```tsx
<div className="flex items-center gap-1">
  <Select name="leadSourceId" ... />
  {isAdmin && (
    <Tooltip content="Gerenciar origens">
      <Link href="/admin/listas?tab=origens" target="_blank">
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Settings2Icon className="h-3.5 w-3.5" />
        </Button>
      </Link>
    </Tooltip>
  )}
</div>
```

**Substituição dos hardcoded** — após criar a infraestrutura, fazer
um passe em todos os selects identificados na auditoria e substituir
arrays estáticos por:
```tsx
const { data: leadSources } = trpc.leadSources.list.useQuery();
```

---

## Seção 5 — Form UX Hardening (aplicar em toda a app)

Lista de correções a aplicar sistematicamente em TODOS os
formulários identificados na auditoria do Passo 0.

### 5a. Scroll e botões de ação fixos
Já coberto na Seção 2a. Padrão a seguir em todos os modais/sheets.

### 5b. Auto-focus no primeiro campo
```tsx
// Em todo Dialog/Sheet com formulário
const firstFieldRef = useRef<HTMLInputElement>(null);
useEffect(() => {
  if (open) {
    setTimeout(() => firstFieldRef.current?.focus(), 50);
  }
}, [open]);
```

### 5c. Dirty state warning
Se o usuário clicar em Cancelar ou fechar o modal com alterações não
salvas:
```tsx
const isDirty = form.formState.isDirty;
const [showConfirm, setShowConfirm] = useState(false);

function handleClose() {
  if (isDirty) {
    setShowConfirm(true);
    return;
  }
  onClose();
}

// AlertDialog do shadcn (não confirm() nativo):
<AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Há alterações não salvas.</AlertDialogTitle>
      <AlertDialogDescription>Deseja sair mesmo assim?</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Continuar editando</AlertDialogCancel>
      <AlertDialogAction onClick={onClose}>Sair sem salvar</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Adicionar `npx shadcn-ui@latest add alert-dialog` se ainda não tiver.

### 5d. Loading state no botão de submit
```tsx
<Button type="submit" disabled={isSubmitting}>
  {isSubmitting
    ? <><Spinner className="mr-2 h-4 w-4" /> Salvando...</>
    : 'Salvar'
  }
</Button>
```

Padrão pra TODOS os botões de submit.

### 5e. Finalizar voz Venzo (2 ocorrências residuais)

Sprint 14.5 fez 17 substituições. Grep atual identifica ~2 ocorrências
ainda. Localizar exatas no Passo 0 e finalizar:

| Antes (proibido) | Depois (voz Venzo) |
|------------------|-------------------|
| (texto residual 1) | (substituir com voz Venzo) |
| (texto residual 2) | (substituir com voz Venzo) |

Critério geral pra escolha do texto:
- Direto e afirmativo
- CTA destacado em **negrito**
- Sem "Nenhum/Não há/No items" → começar com afirmação ("Sem...",
  "Você ainda não...") + CTA

Componente `<EmptyState>` já existe (Sprint 14):
```tsx
<EmptyState
  title="Seu pipeline está vazio."
  description="Adicione oportunidades para acompanhar o progresso das suas vendas."
  action={{ label: "Nova oportunidade", href: "/pipeline/new" }}
  icon={<PipelineIcon />}
/>
```

### 5f. CEP auto-fill (referência cruzada — Seção 3b)
Implementação coberta na Seção 3.

---

## Seção 6 — Auditoria e Correção Cross-Forms

Após implementar os padrões das Seções 1–5, aplicar em todos os
formulários encontrados na auditoria. Lista esperada de formulários
a corrigir (confirmar com output do Passo 0):

| Formulário | Scroll | Toast | QuickCreate | Lista config. | CEP |
|-----------|--------|-------|-------------|---------------|---------|
| `/pipeline/new` | ✓ | ✓ | Empresa + Contato | Origem, Território, Segmento | — |
| `/companies/new` | ✓ | ✓ | — | Setor, Território, Segmento | ✓ |
| `/contacts/new` | ✓ | ✓ | Empresa | Cargo, Setor | — |
| `/contracts/new` | ✓ | ✓ | Empresa + Contato | — | — |
| `/activities/new` | ✓ | ✓ | Empresa + Contato | Tipo atividade | — |
| `/admin/users/invite` | ✓ | ✓ | — | — | — |
| `/admin/products/new` | ✓ | ✓ | — | Categoria | — |
| Qualquer outro identificado no Passo 0 | ✓ | ✓ | conforme contexto | conforme contexto | — |

**Não regredir** formulários do Sprint 15A (`/platform/*`) — esses
têm padrão Platform Owner específico e não devem misturar com este
hardening.

---

## Critérios de Aceite

### Funcionais
- [ ] QuickCreate funciona em `/pipeline/new`: criar empresa sem
  sair do formulário, empresa selecionada automaticamente após
  criação
- [ ] QuickCreate funciona em `/pipeline/new`: criar contato inline
- [ ] QuickCreate recursivo (contato → empresa) limitado a 1 nível
- [ ] Formulário de empresa com scroll funcionando — botão Salvar
  sempre visível
- [ ] Toast de sucesso em TODOS os creates/updates com mensagem
  específica (não genérica)
- [ ] Máscara visual `00.000.000/0000-00` no input CNPJ
- [ ] Máscara visual `00000-000` no input CEP
- [ ] CEP lookup preenche logradouro, bairro, cidade, estado
- [ ] Migration 0022_company_address aplicada (campos novos:
  cep, logradouro, numero, complemento, bairro)
- [ ] Migration 0023_configurable_lists aplicada (3 tabelas novas)
- [ ] Seed cria valores padrão das 3 listas novas para tenants
- [ ] `/admin/listas` com 5 tabs: Territórios, Segmentos, Origens,
  Setores, Cargos — drag-to-reorder funcional, soft delete com
  proteção quando em uso
- [ ] Ícone ⚙️ ao lado de selects configuráveis visível para ADMIN+
- [ ] Select de Estado mostra os 27 estados brasileiros
- [ ] Select de Cidade filtra por Estado via IBGE API com cache
  perpétuo
- [ ] Default country = "Brasil" preenchido automaticamente

### UX / Voz
- [ ] `grep -rnE "Nenhum.*encontrado|Não há registros|No results"
  src/` → zero ocorrências
- [ ] Todos os dialogs/sheets com formulário têm `overflow-y-auto` e
  footer sticky
- [ ] Dirty state warning ao tentar fechar formulário com alterações
  não salvas (AlertDialog shadcn, não confirm())
- [ ] Loading state no botão de submit em todos os formulários
- [ ] Auto-focus no primeiro campo ao abrir modal

### Qualidade
- [ ] Testes unitários para `formatCNPJ`, `unformatCNPJ`, `formatCEP`
- [ ] Testes unitários para `lookupCep` (5 cenários igual ao
  `lookupCnpj`)
- [ ] Testes unitários para `useCidadesByUF` (mock da API IBGE)
- [ ] Testes unitários para `<QuickCreateTrigger>` (3 entidades)
- [ ] Testes E2E: QuickCreate fluxo completo (criar empresa durante
  cadastro de oportunidade)
- [ ] Testes E2E: CEP auto-fill
- [ ] Testes unitários para CRUD das 3 listas novas com soft delete
  rejeitando exclusão quando em uso
- [ ] 308+ testes anteriores continuam passando + ≥ 20 novos
- [ ] Nenhuma regressão nos formulários existentes

---

## Estimativa de Esforço

| Seção | Dias |
|-------|------|
| Passo 0 — Auditoria | 0,5 |
| Seção 1 — QuickCreate Pattern | 1,5 |
| Seção 2 — Correções formulário empresa + migration 0022 | 0,75 |
| Seção 3 — Máscaras + CEP auto-fill | 0,75 |
| Seção 4 — Listas configuráveis + /admin/listas + migration 0023 | 1,75 |
| Seção 5 — Form UX Hardening (cross-app) | 0,75 |
| Seção 6 — Aplicação cross-forms + testes | 1,0 |
| **Total** | **~7 dias** |

(Original era 8 dias; CNPJ já entregue economiza ~1 dia.)

Se o prazo for restrito, priorizar nesta ordem:
1. **Seção 2** (scroll + toast) — impacto imediato, baixo risco
2. **Seção 3** (CEP + máscaras) — alto valor percebido, baixo esforço
3. **Seção 1** (QuickCreate) — maior impacto de fluxo
4. **Seção 4** (Listas configuráveis) — mais complexo, pode ir para
   15D se necessário

## Dependências externas

- **BrasilAPI** (`brasilapi.com.br`) — usado pra CEP. Mesma
  dependência do CNPJ. Tolerância a indisponibilidade implementada
  como no `lookupCnpj` (degrada graciosamente).
- **IBGE Localidades** (`servicodados.ibge.gov.br`) — usado pra
  cidades. Cache perpétuo no client (`staleTime: Infinity`).
- **shadcn/ui — alert-dialog** — `npx shadcn-ui@latest add
  alert-dialog` (instalação one-shot durante o sprint)
- **@dnd-kit/sortable** — verificar se já está instalado pelo
  Sprint 4 (kanban) ou Sprint 14 (DetailSheet drag-drop); senão
  `npm install @dnd-kit/sortable @dnd-kit/core`

## Pós-sprint

Quando fechado:
- Atualizar `CLAUDE.md` marcando Sprint 15C concluído
- Atualizar `docs/Backlog_Pos_MVP.md`: remover items P-01 já
  parcialmente cobertos, marcar quais sprints fechados
- Migrations 0022 + 0023 aplicadas no Neon
