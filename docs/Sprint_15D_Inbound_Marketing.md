# Sprint 15D — Inbound Marketing Pipeline

## Objetivo

Permitir que prospects de inbound marketing (site, landing pages,
LinkedIn lead gen, Typeform, RD Station etc) entrem **automaticamente**
no pipeline do tenant — sem o vendedor digitar nada. Cada lead vira
uma `Opportunity` com `lead_source_id = INBOUND`, estágio `PROSPECT`,
sem `ownerId` (não-atribuída), com flag `is_inbound = true`
persistente pra rastreio de origem em relatórios.

Após criação automática, o lead cai numa **fila pública** que o
**Gestor de Inbound** vê em `/inbox/prospects`. Ele aloca um
responsável (vendedor) que assume a partir do estágio PROSPECT
e segue o fluxo padrão de qualificação.

## Pré-requisitos

- ✅ Sprint 15A (Platform Console) — disponível
- ✅ Sprint 15B (AI Ops) — `callAiFeature` disponível pro fallback IA
- ✅ Sprint 15C (Listas Configuráveis) — `lead_sources` table com
  valor `Inbound` seedado por default. **Pré-requisito hard:** sem
  15C, o `lead_source_id` não existe e o tracking de origem não
  funciona
- ✅ Sprint 6 (Comunicações) — endpoint `/api/v1/inbound/email` já
  existe e será estendido aqui

## NÃO fazer neste sprint

- Refatorar sistema RBAC pra permissões granulares (vira **Sprint 15E**)
- Integrações nativas com providers específicos (RD Station OAuth,
  HubSpot API, Typeform direto) — usar webhook genérico que cobre
  todos via Zapier/n8n
- Pipeline paralelo de inbound — usar pipeline único com
  `lead_source_id` distinguindo (decisão arquitetural definida)
- IA training próprio — usar Claude Haiku como fallback de extração

---

## Decisão arquitetural — Role `GESTOR_INBOUND` (temporária)

**Por que role temporária:** após Sprint 15E (RBAC granular), o
`GESTOR_INBOUND` será removido do enum e transformado em uma
**permission flag** (`inbound.assign_prospects`) que pode ser
atribuída a qualquer user (`ADMIN`, `GESTOR`, `GESTOR_OPERACOES`,
até `ANALISTA` se o admin quiser).

Pra desbloquear a entrega de inbound rapidamente, criamos a role
`GESTOR_INBOUND` agora. Sprint 15E faz a migração estrutural sem
breaking change pra usuários — todos que tinham `GESTOR_INBOUND`
ganham automaticamente a permission `inbound.assign_prospects`.

**Migration `0024_inbound_marketing` adiciona:**

```sql
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
CREATE TYPE "UserRole" AS ENUM (
  'ADMIN',
  'DIRETOR_COMERCIAL',
  'DIRETOR_OPERACOES',
  'DIRETOR_FINANCEIRO',
  'GESTOR',
  'GESTOR_INBOUND',         -- NOVO
  'ANALISTA',
  'PARCEIRO'
);

-- Migrar users.role
ALTER TABLE users ALTER COLUMN role DROP DEFAULT;
ALTER TABLE users ALTER COLUMN role TYPE "UserRole" USING role::text::"UserRole";
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'ANALISTA';

-- Migrar approval_rules.approver_roles (mesmo padrão do 0016)
UPDATE approval_rules
   SET approver_roles = (
     SELECT array_agg(r::"UserRole_old")
     FROM unnest(approver_roles) AS r
   )
 WHERE TRUE;

ALTER TABLE approval_rules
  ALTER COLUMN approver_roles TYPE "UserRole"[]
  USING approver_roles::text[]::"UserRole"[];

DROP TYPE "UserRole_old";
```

**Atualizar `src/lib/auth/rbac.ts`:**

```ts
GESTOR_INBOUND: new Set<Permission>([
  'tenant:read',
  'user:read',
  'company:read', 'company:create',
  'contact:read', 'contact:create',
  'opportunity:read',
  'opportunity:assign',          // NOVA permission — alocar opp não-atribuída
  'opportunity:set_inbound_owner', // NOVA — específica pra inbound
  'inbound:view_queue',          // NOVA — vê /inbox/prospects
  'alert:read',
]),
```

**Atualizar UI `/admin/users` dropdown de role:** mostrar
`GESTOR_INBOUND` com label "Gestor de Inbound".

---

## Schema novo

### Opportunity — novos campos

```sql
-- Adicionados pela migration 0024_inbound_marketing
ALTER TABLE opportunities
  ADD COLUMN is_inbound boolean NOT NULL DEFAULT false,
  ADD COLUMN inbound_source text,           -- 'email' | 'webhook_custom' | 'typeform' | 'rd_station' | etc
  ADD COLUMN inbound_form_id text,          -- ID do form/source no provider (se aplicável)
  ADD COLUMN inbound_payload jsonb,         -- raw payload pra auditoria
  ADD COLUMN inbound_received_at timestamptz,
  ADD COLUMN inbound_parsed_by text;        -- 'regex:typeform-v1' | 'ai:claude-haiku' | 'manual'

CREATE INDEX opportunities_is_inbound_idx
  ON opportunities(tenant_id, is_inbound, owner_id)
  WHERE is_inbound = true AND deleted_at IS NULL;
```

### Fila de prospects não-atribuídos

Query base — não precisa de tabela nova:

```sql
SELECT o.* FROM opportunities o
WHERE tenant_id = $1
  AND is_inbound = true
  AND owner_id IS NULL
  AND stage = 'PROSPECT'
  AND deleted_at IS NULL
ORDER BY inbound_received_at DESC NULLS LAST;
```

Performance OK com o índice composto acima.

### Configuração de captura por tenant

```sql
CREATE TABLE inbound_capture_config (
  tenant_id          uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Email config
  email_enabled      boolean NOT NULL DEFAULT true,
  email_slug         text,                  -- 'leads-acme' → leads-acme@inbound.crm
  email_default_stage text NOT NULL DEFAULT 'PROSPECT',
  -- Webhook config
  webhook_enabled    boolean NOT NULL DEFAULT true,
  webhook_secret     text,                  -- HMAC sign / token; gerado no admin
  webhook_default_stage text NOT NULL DEFAULT 'PROSPECT',
  -- Notification
  notify_on_arrival  boolean NOT NULL DEFAULT true,
  notify_user_ids    uuid[] DEFAULT '{}',   -- a quem mandar push/email; default = todos GESTOR_INBOUND
  -- Auto-assign rules (opcional, futuro)
  auto_assign_by_territory boolean NOT NULL DEFAULT false,
  -- Audit
  updated_by         uuid REFERENCES users(id),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
```

---

## Canais de captura

### Canal 1 — Email dedicado

Endereço do tenant: `<slug>@inbound.<DOMAIN>` (slug configurável no
`/admin/email-inbound`).

Site/landing dispara email **estruturado** pra esse endereço. Exemplos
de conteúdo aceito:

**Formato A — Plain text estruturado** (qualquer form que dispara email):
```
Nome: Maria Silva
Email: maria@empresa.com
Empresa: Empresa LTDA
CNPJ: 12.345.678/0001-99
Telefone: (11) 91234-5678
Cargo: Diretora de Compras
Mensagem: Tenho interesse no plano Pro para minha equipe de 25 vendedores.
```

**Formato B — HTML form submission** (Contact Form 7, Cal.com, etc):
```html
<table>
  <tr><td>Nome</td><td>Maria Silva</td></tr>
  <tr><td>Email</td><td>maria@empresa.com</td></tr>
  ...
</table>
```

**Formato C — Email "natural"** (sem estrutura):
> Oi, queria saber mais sobre os planos. Sou da Empresa LTDA, sou
> diretora de compras. Meu email é maria@empresa.com.

### Canal 2 — Webhook custom

Endpoint público: `POST /api/v1/inbound/lead?secret=<webhook_secret>`

JSON estruturado (schema flexível, todos os campos opcionais):

```json
{
  "source": "rd_station",
  "form_id": "landing-page-pro-2026-q1",
  "received_at": "2026-06-30T14:32:00Z",
  "contact": {
    "name": "Maria Silva",
    "email": "maria@empresa.com",
    "phone": "+5511912345678",
    "role": "Diretora de Compras"
  },
  "company": {
    "name": "Empresa LTDA",
    "cnpj": "12345678000199",
    "website": "https://empresa.com.br",
    "segment": "Tecnologia"
  },
  "interest": {
    "message": "Tenho interesse no plano Pro pra equipe de 25 vendedores",
    "estimated_value": 12000,
    "expected_close_at": "2026-08-15"
  },
  "tracking": {
    "utm_source": "google",
    "utm_medium": "cpc",
    "utm_campaign": "pro-q1-2026"
  }
}
```

Validação: HMAC-SHA256 do body + secret no header `X-Webhook-Signature`
OU `?secret=` na URL (mais simples pra Zapier/n8n).

### Canal 3 — Integrações nativas (FUTURO, NÃO neste sprint)

Anotar como roadmap pós-15D:
- RD Station (OAuth, mais usado BR)
- HubSpot Forms (OAuth)
- Typeform Webhook nativo (com dynamic redirect)
- LinkedIn Lead Gen Forms (Marketing API)

Cada uma vira chip de sustentação dedicado de ~2-3 dias quando cliente
pedir.

---

## Parser de leads

**Service:** `src/server/services/inbound-parser.service.ts`

### Estratégia Misto (Opção D — regex prioritário + IA fallback)

```ts
export type ParsedLead = {
  contact: { name?: string; email?: string; phone?: string; role?: string };
  company: { name?: string; cnpj?: string; website?: string; segment?: string };
  interest: { message?: string; estimated_value?: number; expected_close_at?: Date };
  tracking?: Record<string, string>;
  confidence: number;        // 0..1
  parsed_by: string;         // 'regex:typeform-v1' | 'ai:claude-haiku' | 'manual'
};

export type ParseSource = 'email' | 'webhook_custom';

export async function parseLead(
  raw: string | Record<string, any>,
  source: ParseSource,
): Promise<ParsedLead> {
  // 1. Tentar regex/template matchers conhecidos (ordem por especificidade)
  for (const matcher of REGEX_MATCHERS) {
    const parsed = matcher.tryParse(raw, source);
    if (parsed && parsed.confidence >= 0.8) return parsed;
  }
  // 2. Fallback IA via callAiFeature (Sprint 15B gate)
  return await callAiFeature('inbound-parser', { tenantId }, async (model) => {
    return aiParseLead(raw, source, model);
  });
}
```

### Matchers regex (priorizados por especificidade)

**1. Typeform form submission** (regex match em header `From:` ou
estrutura HTML típica):
```ts
{
  id: 'typeform-v1',
  tryParse(raw): ParsedLead | null {
    if (!raw.includes('typeform') && !raw.includes('Typeform')) return null;
    // Extrai pares "Question: Answer" do template Typeform
    ...
    return { ...extracted, confidence: 0.95, parsed_by: 'regex:typeform-v1' };
  }
}
```

**2. RD Station form submission** (analiza estrutura RD).

**3. Estrutura `Campo: Valor` plain text** (genérico):
```ts
{
  id: 'plain-key-value',
  tryParse(raw): ParsedLead | null {
    const lines = raw.split('\n').filter(l => l.match(/^\s*\w+:\s*.+/));
    if (lines.length < 3) return null;
    const dict = Object.fromEntries(
      lines.map(l => l.split(':').map(s => s.trim()))
    );
    return mapDictToLead(dict);
  }
}
```

**4. HTML table form** (Contact Form 7, Cal.com, etc):
```ts
{
  id: 'html-table-form',
  tryParse(raw): ParsedLead | null {
    const $ = cheerio.load(raw);
    const rows = $('tr').toArray().map(r => $(r).find('td').map((_, td) => $(td).text().trim()).get());
    ...
  }
}
```

**5. Webhook custom JSON** (alta confiança):
```ts
{
  id: 'webhook-custom-json',
  tryParse(raw, source): ParsedLead | null {
    if (source !== 'webhook_custom' || typeof raw !== 'object') return null;
    return normalizeWebhookPayload(raw);  // confidence: 0.99
  }
}
```

### Fallback IA via Claude Haiku

Quando nenhum regex bate com confidence ≥ 0.8:

```ts
const prompt = `
Você é um extrator de leads. Recebe um email/mensagem e devolve JSON
estruturado seguindo este schema:

${SCHEMA_DESCRIPTION}

Email recebido:
"""
${raw}
"""

Devolva apenas o JSON, sem markdown.
`;

const response = await anthropic.messages.create({ model, prompt, ... });
const parsed = parseAiJsonResponse(response);
return { ...parsed, confidence: 0.7, parsed_by: 'ai:claude-haiku' };
```

PII masking aplicado antes de enviar pro Claude (Sprint 4
`DataMaskingService` já existe e mascara emails reais → tokens).

### Casos onde NÃO criar opportunity

Algumas regras de proteção contra spam/ruído:

1. **Email sem endereço de origem identificável** (`From:` ausente)
   → descarta + log
2. **Confidence final < 0.4** → cria `inbound_leads_rejected` row
   pra revisão manual; não vira opp
3. **Email do próprio tenant** (vendedor mandou pra si mesmo por
   engano) → descarta
4. **Domínio na blacklist do tenant** (configurável em
   `inbound_capture_config.blacklist_domains text[]`)
5. **Rate limit por sender** (mesmo email mandando > 10 leads/h) →
   marca como suspeito, requer aprovação manual

---

## Worker — criação automática

`src/jobs/inbound-lead-creator.worker.ts`:

```ts
import { Queue } from 'bullmq';

export const inboundLeadQueue = new Queue('inbound-lead-create', { connection });

inboundLeadQueue.add('process', { tenantId, source, raw, receivedAt });

// Worker
new Worker('inbound-lead-create', async (job) => {
  const { tenantId, source, raw, receivedAt } = job.data;
  return runWithTenant({ tenantId, userId: null, role: 'ADMIN' }, async () => {

    // 1. Parser
    const parsed = await parseLead(raw, source);
    if (parsed.confidence < 0.4) {
      await saveRejectedLead(tenantId, source, raw, parsed);
      return;
    }

    // 2. Resolver Company (lookup CNPJ se tiver; senão por nome+email-domínio)
    const company = await findOrCreateCompany(parsed.company, {
      preferCnpjLookup: true,        // chama src/lib/cnpj/lookup.ts
      tenantId,
    });

    // 3. Resolver Contact (lookup por email; senão criar)
    const contact = await findOrCreateContact(parsed.contact, {
      companyId: company.id,
      tenantId,
    });

    // 4. Resolver lead_source_id (default INBOUND)
    const leadSourceId = await getOrCreateLeadSource(tenantId, 'Inbound');

    // 5. Criar Opportunity
    const opp = await prisma.opportunity.create({
      data: {
        tenantId,
        companyId: company.id,
        primaryContactId: contact.id,
        ownerId: null,                  // não atribuído ainda
        stage: 'PROSPECT',
        leadSourceId,
        isInbound: true,
        inboundSource: source,
        inboundFormId: parsed.tracking?.utm_campaign ?? null,
        inboundPayload: raw,
        inboundReceivedAt: receivedAt,
        inboundParsedBy: parsed.parsed_by,
        estimatedValue: parsed.interest.estimated_value ?? null,
        expectedCloseAt: parsed.interest.expected_close_at ?? null,
        description: parsed.interest.message ?? null,
      },
    });

    // 6. Audit log com tenantIdOverride (lição do bug audit-trpc-context-loss)
    await audit({
      action: 'opportunity.inbound_created',
      tableName: 'opportunities',
      recordId: opp.id,
      tenantIdOverride: tenantId,
      after: { confidence: parsed.confidence, parsed_by: parsed.parsed_by },
    });

    // 7. Notificar Gestor(es) de Inbound
    await notifyInboundManagers(tenantId, opp);

  });
});
```

### Notificação aos Gestores de Inbound

```ts
async function notifyInboundManagers(tenantId: string, opp: Opportunity) {
  const config = await prisma.inboundCaptureConfig.findUnique({ where: { tenantId } });
  if (!config?.notify_on_arrival) return;

  let recipients: User[] = [];
  if (config.notify_user_ids.length > 0) {
    recipients = await prisma.user.findMany({
      where: { id: { in: config.notify_user_ids }, deletedAt: null }
    });
  } else {
    // Default: todos GESTOR_INBOUND ativos do tenant
    recipients = await prisma.user.findMany({
      where: { tenantId, role: 'GESTOR_INBOUND', active: true, deletedAt: null }
    });
  }

  for (const user of recipients) {
    // Push notification (PWA — Sprint 10)
    await sendPushToUser(user.id, {
      title: 'Novo lead inbound',
      body: `${opp.company.name} — ${opp.estimatedValue ? formatBRL(opp.estimatedValue) : 'valor não estimado'}`,
      url: `/inbox/prospects?highlight=${opp.id}`,
    });
    // Email (opcional, configurável)
    await sendEmail(user.email, 'inbound-lead-alert', { opp });
  }
}
```

---

## UI — `/inbox/prospects`

### Rota e permissão

- **Path:** `/inbox/prospects`
- **Middleware:** acessível pra users com permission
  `inbound:view_queue` (que GESTOR_INBOUND, ADMIN, DIRETOR_COMERCIAL
  têm via `rbac.ts`)
- Outros users tentando acessar → 403 + redirect pra `/inbox`

### Layout

Mobile-first como o resto da app:

```
┌────────────────────────────────────────────────────┐
│  Prospects Inbound (27)            [Filtros ▾]     │
├────────────────────────────────────────────────────┤
│  Hoje                                              │
│  ┌──────────────────────────────────────────────┐ │
│  │ Empresa LTDA       há 12min  💬 ai-haiku     │ │
│  │ Maria Silva — Diretora de Compras            │ │
│  │ Plano Pro / 25 vendedores                    │ │
│  │ R$ 12.000 estimado · close 15/ago            │ │
│  │ [👤 Alocar] [👁 Ver detalhes]                │ │
│  └──────────────────────────────────────────────┘ │
│  ...                                               │
└────────────────────────────────────────────────────┘
```

### Componentes

**`<ProspectQueueCard>`** — card da fila:
- Header: nome da empresa + tempo desde recebido + badge parser
  (regex: verde / ai: violeta)
- Corpo: contato principal + cargo + descrição do interesse
- Métricas: valor estimado em gold + data de fechamento esperada
- Footer: 2 botões
  - **Alocar** → abre Popover com lista de vendedores do tenant
    (ADMIN/GESTOR/ANALISTA) ordenados por carga atual (asc).
    Selecionar vendedor → mutation `opportunities.assignInbound`
  - **Ver detalhes** → abre DetailSheet (mesmo padrão pipeline)

**Filtros (Popover):**
- Source (email/webhook/typeform/rd_station/etc)
- Tempo recebido (hoje / esta semana / mês)
- Confidence (todos / só alta ≥0.8 / só média < 0.8)
- Territory (se config.auto_assign_by_territory)

**Empty state com voz Venzo:**
```
Sem leads aguardando alocação.
Bom trabalho, fila zerada.
```

### Atribuição (mutation)

`opportunities.assignInbound`:

```ts
// Procedure
assignInbound: protectedProcedure
  .input(z.object({ opportunityId: z.string().uuid(), ownerId: z.string().uuid() }))
  .mutation(async ({ input, ctx }) => {
    // Verificar permissão (GESTOR_INBOUND / ADMIN / DIRETOR_COMERCIAL)
    if (!hasPermission(ctx.user.role, 'opportunity:set_inbound_owner')) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    // Verificar que opp é inbound e não-atribuída
    const opp = await prisma.opportunity.findFirst({
      where: { id: input.opportunityId, tenantId: ctx.tenantId, isInbound: true, ownerId: null },
    });
    if (!opp) throw new TRPCError({ code: 'NOT_FOUND' });
    // Verificar que ownerId é user do tenant
    const owner = await prisma.user.findFirst({
      where: { id: input.ownerId, tenantId: ctx.tenantId, deletedAt: null, active: true },
    });
    if (!owner) throw new TRPCError({ code: 'BAD_REQUEST' });
    // Atribuir
    const updated = await prisma.opportunity.update({
      where: { id: opp.id },
      data: { ownerId: input.ownerId },
    });
    // Notificar o vendedor alocado
    await sendPushToUser(input.ownerId, {
      title: 'Novo prospect atribuído',
      body: `${opp.company.name} foi alocado a você. Comece a qualificação.`,
      url: `/pipeline/${opp.id}`,
    });
    // Audit
    await audit({
      action: 'opportunity.inbound_assigned',
      tableName: 'opportunities',
      recordId: opp.id,
      tenantIdOverride: ctx.tenantId,
      after: { ownerId: input.ownerId, assignedBy: ctx.user.id },
    });
    return updated;
  });
```

---

## Configuração admin

`/admin/email-inbound` (já existe do Sprint 6) ganha tabs:
- **E-mails recebidos** (Sprint 6 — emails que vincularam à
  opportunity existente)
- **NOVO: Forms de captura** — config de inbound:
  - Email enabled + slug (read-only se tenant já tem; orientação
    pra mudar)
  - Webhook enabled + secret (botão "Regenerar" + cópia "Como
    configurar no seu provedor")
  - Notificação — quem receber push/email quando chega lead novo
    (multi-select de users; default = todos GESTOR_INBOUND)
  - Domínio em blacklist (textarea, 1 domínio por linha)
  - Auto-assign por território (toggle, futura)
  - Histórico de leads recebidos (últimos 30 — com status: criada
    opp / rejeitada / em revisão)

Procedure `inboundCaptureConfig.update` (ADMIN only).

---

## Relatórios — `/reports/inbound-vs-outbound`

Nova rota `src/app/reports/inbound-vs-outbound/page.tsx`.

### Visualização

Funil comparativo lado a lado:

```
INBOUND                           OUTBOUND
PROSPECT     127  (R$ 980k)       PROSPECT       45   (R$ 1.2M)
LEAD          89  (R$ 720k)       LEAD           38   (R$ 1.0M)
OPPORTUNITY   54  (R$ 460k)       OPPORTUNITY    28   (R$ 850k)
PROPOSAL      31  (R$ 280k)       PROPOSAL       19   (R$ 620k)
NEGOCIACAO    18  (R$ 165k)       NEGOCIACAO     12   (R$ 410k)
GANHA         11  (R$ 98k)        GANHA           7   (R$ 280k)

Conversion rate (PROSPECT → GANHA): 8.7% / 15.6%
Ticket médio: R$ 8.900 / R$ 40.000
Tempo médio: 23 dias / 67 dias
```

### Métricas calculadas

Service novo `src/server/services/inbound-analytics.service.ts`:

- `computeInboundFunnel(tenantId, period)` — agrupa por
  `is_inbound` boolean
- `compareConversionRates(tenantId, period)` — taxa estágio×estágio
  por origem
- `averageTicketByOrigin(tenantId, period)` — média de
  `estimated_value` final
- `averageCycleTime(tenantId, period)` — dias entre `created_at` e
  `won_at` (ou `lost_at`)

### Filtros

- Período (default 90d)
- Lead source (filtra outbound também por origem: indicação/cold/
  evento/etc, não só inbound vs todo o resto)
- Owner (qual vendedor)
- Territory / Segment

### Export

Botão "Exportar Excel" reusa o `excel-export.service.ts` do Sprint 5.

---

## Procedures tRPC

Novo router `src/server/trpc/routers/inbound.ts`:

```ts
inbound.config.get
inbound.config.update              // ADMIN only
inbound.config.regenerateWebhookSecret
inbound.queue.list                 // /inbox/prospects feed
inbound.queue.count                // pra badge no BottomNav/Sidebar
inbound.history.list               // últimos leads recebidos pro
                                   // /admin/email-inbound histórico
inbound.rejectedList               // pra revisão manual
inbound.rejectedRetry              // forçar reprocesso de rejected
opportunities.assignInbound        // (descrito acima)
```

Relatório:
```ts
reports.inboundFunnel
reports.inboundVsOutboundComparison
reports.inboundConversionByOwner
```

---

## Endpoint público — webhook

`src/app/api/v1/inbound/lead/route.ts`:

```ts
export async function POST(req: Request) {
  // 1. Rate limit por IP (sprint 11 — 10 req/min público)
  await PUBLIC_FORM_LIMIT.check(req);

  // 2. Validar webhook secret (?secret= ou header)
  const secret = req.nextUrl.searchParams.get('secret') ?? req.headers.get('x-webhook-secret');
  if (!secret) return new Response('Unauthorized', { status: 401 });

  // 3. Identificar tenant pelo secret
  const config = await prisma.inboundCaptureConfig.findFirst({
    where: { webhookSecret: secret, webhookEnabled: true }
  });
  if (!config) return new Response('Invalid secret', { status: 401 });

  // 4. Parse body
  const body = await req.json();

  // 5. Enfileirar pro worker
  await inboundLeadQueue.add('process', {
    tenantId: config.tenantId,
    source: body.source ?? 'webhook_custom',
    raw: body,
    receivedAt: body.received_at ? new Date(body.received_at) : new Date(),
  });

  return new Response(JSON.stringify({ status: 'queued' }), {
    status: 202,
    headers: { 'content-type': 'application/json' }
  });
}
```

### Email — endpoint existente estendido

`src/app/api/v1/inbound/email/route.ts` (Sprint 6) já recebe webhooks
Postmark/Resend. **Estender:**

- Detectar se email tem formato estruturado (regex matchers acima)
- Se sim, em vez de criar `Activity` linkada à opp existente
  (comportamento atual), criar opp nova via `inboundLeadQueue`
- Se não, manter comportamento atual (linka como atividade)

Lógica decisória:
```ts
const parsed = await parseLead(emailRaw, 'email');
if (parsed.confidence >= 0.7 && parsed.contact?.email && parsed.company?.name) {
  await inboundLeadQueue.add('process', { ... });
} else {
  // Comportamento antigo: linkar atividade
  await emailLinkService.link(emailRaw);
}
```

---

## Testes

### Unit
- `tests/unit/inbound-parser.test.ts` — 6+ cases (typeform, RD,
  plain key:value, HTML table, JSON webhook, fallback IA)
- `tests/unit/inbound-blacklist.test.ts` — blacklist domains
- `tests/unit/inbound-rate-limit-per-sender.test.ts`
- `tests/unit/inbound-confidence-threshold.test.ts`
- `tests/unit/parse-utm-tracking.test.ts`

### Integration
- `tests/integration/inbound-webhook-flow.test.ts` — POST endpoint
  com secret válido + cria opp PROSPECT sem owner
- `tests/integration/inbound-email-flow.test.ts` — email estruturado
  recebido → cria opp; email não-estruturado → linka atividade
- `tests/integration/inbound-rejected.test.ts` — confidence baixa
  vai pra `inbound_leads_rejected`

### E2E
- E2E: Gestor de Inbound entra em `/inbox/prospects`, aloca lead
  pra vendedor X, vendedor recebe notificação, opp aparece no
  pipeline dele em estágio PROSPECT
- E2E: ADMIN configura webhook secret em `/admin/email-inbound`,
  copia URL, simula curl → opp criada

---

## Critérios de aceite

### Funcionalidade
- [ ] Migration 0024_inbound_marketing aplicada (campos
  is_inbound/inbound_source/etc + UserRole ganha GESTOR_INBOUND +
  inbound_capture_config + opcionalmente
  `inbound_leads_rejected`)
- [ ] Email com formato `Campo: Valor` enviado pro slug do tenant
  cria opp PROSPECT sem owner, lead_source_id=Inbound,
  is_inbound=true
- [ ] Email "natural" (sem estrutura) cai pro fallback IA via
  callAiFeature
- [ ] Webhook POST `/api/v1/inbound/lead?secret=...` com JSON cria
  opp idem
- [ ] Webhook sem secret retorna 401
- [ ] Webhook com secret inválido retorna 401
- [ ] CNPJ auto-lookup via BrasilAPI (commit `ff8cf85`) é chamado
  quando payload tem CNPJ
- [ ] Lookup de Contact por email reusa contato existente
- [ ] Lookup de Company por CNPJ ou nome reusa empresa existente
- [ ] Lead com confidence < 0.4 vai pra rejected sem criar opp

### UX
- [ ] `/inbox/prospects` lista todos os inbound não-atribuídos
  ordenados por `received_at` desc
- [ ] Acesso a `/inbox/prospects` exige permission
  `inbound:view_queue` (GESTOR_INBOUND/ADMIN/DIRETOR_COMERCIAL têm)
- [ ] Botão "Alocar" abre Popover com lista de vendedores
  ordenados por carga
- [ ] Após alocar, opp some da fila, aparece no pipeline do
  vendedor alocado, vendedor recebe push
- [ ] Empty state com voz Venzo quando fila vazia
- [ ] Filtros (source, tempo, confidence, territory) funcionais
  e persistem em query string
- [ ] Badge no BottomNav (mobile) e Sidebar (desktop) com count
  de prospects pendentes

### Admin
- [ ] `/admin/email-inbound` ganha tab "Forms de captura" com
  config completa (email/webhook/notify/blacklist)
- [ ] Botão "Regenerar webhook secret" funciona + invalida secret
  anterior
- [ ] Histórico de leads recebidos (últimos 30) com status
  (created/rejected/manual_review)

### Notificação
- [ ] Push push pros GESTOR_INBOUND quando entra novo lead
  (config.notify_on_arrival=true)
- [ ] Email opcional (Resend) com link pro `/inbox/prospects`
- [ ] Push pro vendedor alocado quando recebe novo prospect

### Relatórios
- [ ] `/reports/inbound-vs-outbound` mostra funis comparativos
- [ ] Conversion rate calculada por origem
- [ ] Ticket médio e cycle time comparados
- [ ] Filtros: período, owner, territory, segment
- [ ] Export Excel funcional

### Qualidade
- [ ] 308+ testes anteriores continuam passando + ≥ 22 novos
- [ ] Type-check zero, lint zero
- [ ] Sem regressão no `/api/v1/inbound/email` (Sprint 6)

---

## Esforço

| Atividade | Dias |
|---|---|
| Migration 0024 + role GESTOR_INBOUND + rbac.ts | 0,5 |
| Schema inbound_capture_config + Opportunity fields | 0,5 |
| Parser service (5 matchers + IA fallback) | 1,5 |
| Worker inbound-lead-creator + notificações | 1,0 |
| Endpoints públicos (email estendido + webhook novo) | 0,5 |
| /inbox/prospects UI + assignInbound mutation | 1,0 |
| /admin/email-inbound tab Forms de captura | 0,75 |
| /reports/inbound-vs-outbound + service | 0,75 |
| Testes (unit + integration + E2E) | 0,75 |
| **Total** | **~6 dias** |

---

## Roadmap pós-15D — integrações nativas

Não cabem neste sprint mas vale registrar:

| Integração | Cliente típico | Esforço |
|---|---|---|
| **RD Station** (OAuth + Webhook nativo) | empresas BR de mkt B2B | ~3d |
| **HubSpot Forms** (OAuth + Workflows) | empresas com stack HubSpot | ~3d |
| **Typeform direto** (sem Zapier intermediário) | landing pages premium | ~2d |
| **LinkedIn Lead Gen Forms** (Marketing API) | empresas com adv pago LI | ~4d (OAuth + LinkedIn approval) |
| **Pipedrive Forms** (raros mas existem) | empresas migrando | ~2d |
| **Mautic** (self-hosted) | empresas técnicas | ~2d |
| **Sharpspring / Klaviyo / ActiveCampaign** | enterprise marketing | ~3d cada |

Cada uma vira **chip de sustentação** quando um cliente específico
pedir. Não há razão de criar todas de cara — webhook custom + Zapier
cobre 80% dos casos.

## Pós-sprint

Quando fechado:
- Atualizar `CLAUDE.md` marcando Sprint 15D concluído
- Atualizar `docs/Backlog_Pos_MVP.md` adicionando integrações
  nativas como itens novos (não bloqueantes)
- Migration 0024 aplicada no Neon
- Verificar que primeira opp inbound cria corretamente em ambiente
  de teste
