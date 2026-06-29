# Sprint 14.5 — Polish Pass (pós Venzo Design System)

Complementa o Sprint 14 que entregou foundation + componentes base +
refactor mecânico das 25+ telas. Esse sprint fecha **9 ajustes
específicos** identificados em uso real após o Sprint 14, mais
2 itens 🟡 que ficaram em continuação operacional.

Esforço estimado: **3–4 dias** (não exige migrations nem novas APIs;
é puramente UI/UX).

---

## ⚠️ Ordem de execução obrigatória

Pra evitar invalidar o baseline visual e retrabalho:

1. **Item 2** (border-radius) — **PRIMEIRO**, antes de qualquer outra
   coisa. Muda tokens globais e afeta cada canto da app.
2. **Itens 1, 3, 4, 5, 6, 7** — em qualquer ordem.
3. **Item 9** (visual baseline) — **POR ÚLTIMO**, após todas as
   mudanças visuais terem aterrissado. Captura o estado final como
   baseline pra próximos sprints.
4. **Item 8** (Lighthouse) — standby (depende de staging — Sprint 15).

---

## 1. PipelineBoard + OpportunityCard — overflow de valor

**Problema:** valores monetários ultrapassam a largura dos cards
("R$ 287.55**5**" cortado, "R$ 296.163" sai do card). Nome longo
empacota em 4 linhas. Coluna do kanban ~200px (spec Venzo §5.2
exige 280px mínimo).

**Solução:**

1. **Coluna ≥ 280px:**
   ```css
   .pipeline-column { min-width: 280px; max-width: 320px; flex-shrink: 0; }
   ```
   Container do kanban com `overflow-x-auto` + `scroll-snap-x mandatory`,
   cada coluna `scroll-snap-align: start`.

2. **Header do card: nome em cima, valor abaixo (stack vertical):**
   ```tsx
   <header className="space-y-1">
     <h3 className="line-clamp-2 text-sm font-semibold text-text-1">{nome}</h3>
     <p className="font-mono tabular-nums text-base font-bold text-brand-accent">
       {formatBRLCompact(valor)}
     </p>
   </header>
   ```
   - `line-clamp-2` trunca nome com ellipsis automático
   - `tabular-nums` alinha dígitos entre cards
   - `text-brand-accent` (gold) cumpre brand guide pra monetários

3. **Formatação compacta + tooltip com valor completo:**
   ```ts
   export function formatBRLCompact(value: number): string {
     if (value >= 1_000_000) return `R$ ${(value/1e6).toFixed(1)}M`;
     if (value >= 1_000)     return `R$ ${(value/1e3).toFixed(0)}k`;
     return `R$ ${value.toFixed(0)}`;
   }
   ```
   `<span title={formatBRL(valor)}>{formatBRLCompact(valor)}</span>` —
   hover mostra valor completo, ARIA label pra screen reader.

4. **Empresa em sub-text:** `<p className="line-clamp-1 text-xs text-text-2">{empresa}</p>`

5. **Badge de estágio no rodapé, não no header** (alinha com spec §6.1):
   rodapé tem avatar do responsável + dias no estágio + badge.

**Arquivos:** `src/components/crm/OpportunityCard.tsx`,
`src/app/pipeline/page.tsx`, `src/lib/utils/format.ts` (criar
`formatBRLCompact`).

**Esforço:** ~2–3h.

---

## 2. Border-radius mais generoso (equilíbrio visual)

**Problema:** cards com `--radius-md: 8px` e modais com `--radius-lg: 12px`
ficaram em "ângulos retos" demais. Falta respiro visual.

**Solução:** subir uma marcha em todos os tokens:

```css
/* globals.css :root */
--radius-sm: 6px;   /* +2 — pills, badges */
--radius:    8px;   /* +2 — botões, inputs */
--radius-md: 12px;  /* +4 — cards de seção, cards do kanban */
--radius-lg: 16px;  /* +4 — modais, sheets, painéis */
--radius-xl: 20px;  /* NOVO — cards hero/landing apenas */
```

**Não aplicar (manter):**
- Badges de status `rounded-full` (continuam pílula)
- Avatares `rounded-full`
- Linhas de tabela (sem radius)
- Bordas externas de container topo-da-página

**Esforço:** ~30 min. Todos os componentes que consomem `rounded-md`,
`rounded-lg` do Tailwind herdam porque `tailwind.config.ts` referencia
os tokens via CSS vars.

---

## 3. FunnelChart `/reports` — layout + matemática

**Problema (4 sintomas):**

| # | Sintoma | Causa |
|---|---|---|
| a | Labels R$ e taxa de conversão **fora do card** | Layout em 3 colunas externas em vez de grid interno |
| b | Largura conta valor em R$ (não headcount) | Confunde visualmente — funil narra contagem |
| c | Seta `↓114.3%` com sinal trocado | Aritmética: 16/14 = 1.143 mas exibe como queda |
| d | Sem forma de funil (retângulos enfileirados) | Componente desenha `<div>` simples |

**Solução:**

1. **Grid interno no card** (em vez de colunas externas):
   ```css
   .funnel-row {
     display: grid;
     grid-template-columns: 110px 1fr 90px;
     align-items: center;
     gap: 12px;
   }
   ```
   - Esq: valor R$ (`text-right text-sm text-text-2`)
   - Centro: barra com label "Prospect · 14" centralizado
   - Dir: taxa de conversão (sem seta)

2. **Largura por contagem:**
   ```ts
   const maxCount = Math.max(...stages.map(s => s.count));
   const width = (stage.count / maxCount) * 100;
   ```
   Toggle opcional no header: "Por contagem | Por valor".

3. **Sinal e cor corretos:**
   ```ts
   const rate = (next / current) * 100;
   const display = rate >= 100 ? `+${(rate - 100).toFixed(1)}%` : `${rate.toFixed(1)}%`;
   const color = rate >= 100 ? 'text-success' : 'text-text-2'; // neutro, não danger
   ```
   Eliminar setas ↓↑ — usar "→" simples ou só percentual.

4. **Forma de funil real (opcional, alto UX win):**
   ```tsx
   <svg viewBox="0 0 100 [rows*60]" aria-label="Funil: 14 prospects, 16 leads...">
     {rows.map((r, i) => (
       <polygon points={trapezoidPoints(r, nextRow)} fill="url(#brandGradient)" />
     ))}
   </svg>
   ```
   Gradiente `--brand-primary` → `--brand-primary-dark`. Última etapa
   (FECHADA_GANHA) usa `--success`.

5. **A11y:** `role="img"` + `aria-label` descritivo no SVG; tabela
   `<table class="sr-only">` como alternativa textual.

**Arquivos:** `src/components/reports/FunnelChart.tsx`, `src/app/reports/page.tsx`.

**Esforço:** ~3–4h (sem forma SVG = 2h; com SVG = 4h).

---

## 4. Polish individual das telas internas críticas (~21 rotas)

**Problema:** Sprint 14 entregou refactor **mecânico** das 25+ telas
(perl pass substituindo `bg-white` → `bg-card` etc) mas só 8 telas
**públicas** receberam polish individual (`/sign-in`, `/sign-up`,
`/privacy`, `/terms`, `/privacy-request`, `/`, `/onboarding`,
`/onboarding/setup`, `/p/[slug]/contact`).

As **telas internas** ainda têm potencial de inconsistências:
hierarquia tipográfica, espaçamento, voz Venzo profunda, empty states
ricos, microcopy.

**Solução:** pass de polish em **9 operacionais + 12 admin = 21 rotas**.
`/admin/branding` e `/admin/billing` já receberam polish profundo no
Sprint 14 (são as 2 telas mais maduras do admin) — listadas abaixo
mas a verificação é leve.

| Rota | Foco |
|---|---|
| `/companies` | Header com título + descrição + ação primária; tabela com mobile cards; empty state com voz Venzo + CTA |
| `/contacts` | Mesmo padrão de `/companies`; filtros persistentes em URL |
| `/pipeline` | (item 1 acima cuida do board) — header do `/pipeline` em si |
| `/reports` | (item 3 acima cuida do funil) — header + cards de KPI no topo com valores em gold |
| `/inbox` | Lista densa estilo email (item compacto, badge não lido), preview no detail sheet |
| `/search` | Input grande hero no topo (display 32px), resultados agrupados por entidade |
| `/approvals` | Lista densa com badge status, ações rápidas (Aprovar/Rejeitar inline com confirm modal) |
| `/contracts` | Tabela com filtros (status, lead time), badge status semântico |
| `/imports` | Wizard com steps refinados (number+label, ativo highlight, completed check) |
| `/admin/ai` | PageHeader + form do design system |
| `/admin/alerts` | PageHeader + config card |
| `/admin/approval-rules` | PageHeader + Table de regras + Modal de criar/editar |
| `/admin/billing` | ✅ já polida no Sprint 14 — verificação leve |
| `/admin/branding` | ✅ já polida no Sprint 14 — verificação leve |
| `/admin/contracts` | PageHeader + config card (handoff emails, lead times) |
| `/admin/conversion-rates` | PageHeader + Table de estágios editável + Sugestão IA |
| `/admin/email-inbound` | PageHeader + config card (slug, webhook secret) |
| `/admin/partners` | PageHeader + Table de parceiros + Modal de convite |
| `/admin/privacy` | PageHeader + Table de pedidos LGPD com badge de SLA |
| `/admin/products` | PageHeader + Table de produtos + Modal de criar/editar |
| `/admin/templates` | PageHeader + Table de templates por categoria |
| `/admin/users` | PageHeader + Table de usuários + Modal de convite |

Aplicar em cada rota (exceto as 2 já marcadas ✅):
- `<PageHeader title="X" description="Y" primaryAction={<Button>}>`
- Tabela/lista usando `Table` + `TableEmpty` + `TableSkeleton`
- Empty state com `<EmptyState icon title description action>`
- Verificar grep `text-gray-*` `text-slate-*` zerado em src/app

**Esforço:** ~1.5–2 dias (varia conforme estado atual de cada tela).

---

## 5. Popover (via shadcn — não from scratch)

**Problema:** Tooltip foi entregue no Sprint 14, Popover não.
Spec Venzo §4.6 define Popover como container até 320px com
conteúdo rico (não só texto curto como tooltip), focus trap,
posicionamento auto-adjust, Escape fecha, ARIA `role="dialog"` +
`aria-labelledby`.

**Solução:** **NÃO construir do zero.** O projeto já usa
shadcn/ui + Radix (vi `@radix-ui/react-dialog`,
`react-dropdown-menu`, `react-label`, `react-slot`, `react-toast`
no `package.json`). O `Popover` do Radix tem focus trap, Escape,
posicionamento automático via Floating UI e é totalmente acessível
— construir do zero é duplicar trabalho e criar superfície extra
de bug.

### Passo a passo

1. **Instalar via shadcn CLI:**
   ```bash
   npx shadcn-ui@latest add popover
   ```
   Isso adiciona `@radix-ui/react-popover` ao `package.json` e cria
   `src/components/ui/popover.tsx` como wrapper estilizado.

2. **Customizar tokens Venzo** — após `shadcn add`, ajustar o
   `PopoverContent` em `src/components/ui/popover.tsx`:
   ```tsx
   <PopoverPrimitive.Content
     align={align}
     sideOffset={sideOffset}
     className={cn(
       'z-50 max-w-80 rounded-lg border border-border bg-card p-4 shadow-lg',
       'text-sm text-text-1',
       'data-[state=open]:animate-in data-[state=closed]:animate-out',
       'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
       'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
       'data-[side=bottom]:slide-in-from-top-2',
       'data-[side=left]:slide-in-from-right-2',
       'data-[side=right]:slide-in-from-left-2',
       'data-[side=top]:slide-in-from-bottom-2',
       className,
     )}
     {...props}
   />
   ```

3. **Respeitar `prefers-reduced-motion`** — já tratado globalmente
   em `globals.css` (animações duram 0.01ms).

### Usos imediatos (criar no mesmo sprint)

**a) Filtros do pipeline** (`/pipeline`) — substituir o `<select>`
nativo que filtra responsável/território/segmento por Popover com
checkbox list:

```tsx
// src/app/pipeline/page.tsx (trecho)
<Popover>
  <PopoverTrigger asChild>
    <Button variant="secondary" size="sm" leftIcon={<FilterIcon />}>
      Filtros {activeCount > 0 && <Badge variant="primary">{activeCount}</Badge>}
    </Button>
  </PopoverTrigger>
  <PopoverContent align="start" className="w-80">
    <h4 className="mb-3 text-sm font-semibold">Filtrar pipeline</h4>
    <FilterGroup label="Responsável" options={owners} value={filter.ownerId} onChange={...} />
    <FilterGroup label="Território" options={territories} value={filter.territoryId} onChange={...} />
    <FilterGroup label="Segmento" options={segments} value={filter.segmentId} onChange={...} />
    <div className="mt-3 flex justify-between">
      <Button variant="ghost" size="sm" onClick={clearAll}>Limpar</Button>
      <Button variant="primary" size="sm" onClick={apply}>Aplicar</Button>
    </div>
  </PopoverContent>
</Popover>
```

**b) Métricas detalhadas no funil** (`/reports`) — hover no valor
total da coluna mostra deal médio, win rate histórica, dias médios
no estágio (referência: spec §6.5):

```tsx
<Popover>
  <PopoverTrigger asChild>
    <button className="text-brand-accent font-mono tabular-nums">
      {formatBRLCompact(columnTotal)}
    </button>
  </PopoverTrigger>
  <PopoverContent className="w-64">
    <dl className="space-y-2 text-xs">
      <div className="flex justify-between"><dt>Deal médio</dt><dd className="font-mono">{formatBRL(avg)}</dd></div>
      <div className="flex justify-between"><dt>Win rate (90d)</dt><dd>{winRate}%</dd></div>
      <div className="flex justify-between"><dt>Dias médios no estágio</dt><dd>{avgDays}d</dd></div>
    </dl>
  </PopoverContent>
</Popover>
```

**c) Quick actions no card de oportunidade** — substitui o
"3 dots" menu por Popover com ações:

```tsx
<Popover>
  <PopoverTrigger asChild>
    <Button variant="ghost" size="sm" aria-label="Mais ações">
      <DotsVerticalIcon className="h-4 w-4" />
    </Button>
  </PopoverTrigger>
  <PopoverContent align="end" className="w-48 p-1">
    <button className="popover-item">Editar</button>
    <button className="popover-item">Duplicar</button>
    <button className="popover-item">Mover para...</button>
    <hr className="my-1 border-border" />
    <button className="popover-item text-danger">Cancelar</button>
  </PopoverContent>
</Popover>
```

### Testes

- E2E: abrir popover, navegar com Tab, Escape fecha, clique fora
  fecha, foco retorna ao trigger
- A11y: axe-core valida `role="dialog"` + `aria-labelledby`

**Esforço:** ~1h (era 3h — shadcn add economiza ~2h, mais 30min
pra cada um dos 3 usos imediatos = 1h30 se quiser todos).

---

## 6. DetailSheet com tabs + bottom sheet mobile (sem swipe gesture)

**Problema:** Sprint 14 entregou as intercepting routes (URL preservada,
sheet de 400px no desktop) mas **falta:**
- Tabs internas (Visão Geral / Atividades / Documentos / Histórico)
- Bottom sheet mobile 85vh
- Animação slide-in 200ms documentada

### Decisão arquitetural — swipe-down fica fora do escopo

O projeto **não tem `framer-motion`** (confirmado no `package.json`:
só `@radix-ui/*`, `class-variance-authority`, `clsx`, etc).
Implementar swipe-down com snap intermediário e threshold de
velocidade corretos exige:
- Adicionar `framer-motion` (~130kb gzipped)
- OU adicionar `@use-gesture/react` + animação manual via
  `react-spring` (também ~80kb)
- Decisões sobre: snap em 50% (half-open)? Threshold pra fechar?
  Velocidade mínima de flick pra fechar mesmo sem cobrir 50%?

Sem essas decisões formalmente especificadas, o resultado é
"inventar números" e geralmente fica esquisito. Pra **NÃO inflar
bundle e nem inventar comportamentos**, este sprint entrega:

- Botão X no header da sheet (close padrão)
- Tap no overlay fecha
- Tecla Escape fecha
- Botão Voltar do navegador fecha (intercepting route já cuida)
- Handle visual ("grip" no topo) **mantido como affordance** —
  mostra ao usuário que o componente "vai abrir/fechar" mesmo
  sem swipe funcional

Swipe-down entra **se e quando** framer-motion for adotado
oficialmente (provavelmente Sprint 15+ pra microinterações —
animações de drag-drop do kanban, transitions de página, etc).

### Estrutura do componente

**`src/components/ui/sheet.tsx`** (novo, wrapper sobre Radix Dialog):

```tsx
'use client';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

type SheetVariant = 'right' | 'bottom';

export function Sheet({ open, onOpenChange, variant = 'right', children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: SheetVariant;
  children: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn(
          'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          'data-[state=open]:duration-300 data-[state=closed]:duration-200',
        )} />
        <DialogPrimitive.Content className={cn(
          'fixed z-50 flex flex-col bg-card shadow-2xl',
          'focus-visible:outline-none',
          variant === 'right' && [
            'right-0 top-0 h-full w-[400px]',
            'border-l border-border',
            'data-[state=open]:slide-in-from-right',
            'data-[state=closed]:slide-out-to-right',
          ],
          variant === 'bottom' && [
            'inset-x-0 bottom-0 h-[85vh] rounded-t-2xl',
            'border-t border-border',
            'data-[state=open]:slide-in-from-bottom',
            'data-[state=closed]:slide-out-to-bottom',
          ],
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'duration-300',
        )}>
          {variant === 'bottom' && (
            <div className="flex justify-center pt-2 pb-1" aria-hidden>
              <div className="h-1 w-10 rounded-full bg-border" />
            </div>
          )}
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function SheetHeader({ title, status, onClose }: {
  title: string;
  status?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <header className="flex items-start justify-between border-b border-border p-4">
      <div className="min-w-0">
        <DialogPrimitive.Title className="line-clamp-2 text-base font-semibold text-text-1">
          {title}
        </DialogPrimitive.Title>
        {status && <div className="mt-1">{status}</div>}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="ml-2 flex h-8 w-8 items-center justify-center rounded text-text-2 hover:bg-bg-hover hover:text-text-1 focus-visible:outline-2 focus-visible:outline-brand-primary"
      >
        <XIcon className="h-4 w-4" />
      </button>
    </header>
  );
}

export function SheetBody({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 overflow-y-auto p-4">{children}</div>;
}
```

### Tabs (via shadcn add)

Se ainda não houver `src/components/ui/tabs.tsx`:

```bash
npx shadcn-ui@latest add tabs
```

Customizar `TabsList` e `TabsTrigger` pra usar tokens Venzo:

```tsx
<TabsList className="border-b border-border bg-transparent p-0">
  <TabsTrigger
    value="overview"
    className="data-[state=active]:border-brand-primary data-[state=active]:text-brand-primary border-b-2 border-transparent px-3 py-2 text-sm text-text-2 hover:text-text-1"
  >
    Visão Geral
  </TabsTrigger>
  {/* ... */}
</TabsList>
```

### Integração com intercepting route

**`app/pipeline/@modal/(.)[id]/page.tsx`** (já existe, refatorar):

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { Sheet, SheetHeader, SheetBody } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { trpc } from '@/lib/trpc/client';
import { useMediaQuery } from '@/lib/utils/hooks';

export default function OpportunityModal({ params }: { params: { id: string } }) {
  const router = useRouter();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const oppQ = trpc.opportunities.byId.useQuery({ id: params.id });

  if (oppQ.isLoading) return null; // skeleton opcional
  const opp = oppQ.data;
  if (!opp) return null;

  return (
    <Sheet
      open
      onOpenChange={(v) => !v && router.back()}
      variant={isMobile ? 'bottom' : 'right'}
    >
      <SheetHeader
        title={opp.name}
        status={<Badge variant="primary">{opp.stage}</Badge>}
        onClose={() => router.back()}
      />
      <SheetBody>
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Visão Geral</TabsTrigger>
            <TabsTrigger value="activities">
              Atividades
              {opp.activitiesCount > 0 && <Badge variant="default">{opp.activitiesCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="documents">
              Documentos
              {opp.documentsCount > 0 && <Badge variant="default">{opp.documentsCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="history">Histórico</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OpportunityOverview opp={opp} />
            {/* Empresa, contatos, valor, dias no estágio, IA score,
                próximos passos, owner + team */}
          </TabsContent>

          <TabsContent value="activities">
            <ActivityTimeline opportunityId={opp.id} />
            {/* Já existe do Sprint 14 */}
          </TabsContent>

          <TabsContent value="documents">
            <DocumentsSection opportunityId={opp.id} />
            {/* Já existe do Sprint 7 */}
          </TabsContent>

          <TabsContent value="history">
            <OpportunityAuditTrail opportunityId={opp.id} />
            {/* Lista cronológica de mudanças de estágio,
                proposals adicionadas, approvals, etc */}
          </TabsContent>
        </Tabs>
      </SheetBody>
    </Sheet>
  );
}
```

### Conteúdo das 4 tabs

| Tab | Conteúdo | Reusa de |
|---|---|---|
| **Visão Geral** | Empresa, contato principal, valor monetário em gold, dias no estágio, IA score com `<Sparkles>`, próximos passos, owner + team avatares | Novo |
| **Atividades** | Timeline cronológica de atividades + input pra adicionar nota inline | `ActivityTimeline` (Sprint 14) |
| **Documentos** | Lista de docs por categoria, upload, versionamento, comparar | `DocumentsSection` (Sprint 7) |
| **Histórico** | Audit trail filtrado por `recordId = opp.id`: mudanças de estágio com before/after, proposals criadas, approvals decididos, contracts criados | tRPC novo `opportunities.history` ou query direta em `audit_logs` |

### Animação CSS (sem framer-motion)

`tailwindcss-animate` plugin (provavelmente já está no projeto via
shadcn) provê as classes `slide-in-from-right`, `slide-out-to-right`,
`slide-in-from-bottom`, `slide-out-to-bottom`. Confirmar
`tailwind.config.ts` tem `require('tailwindcss-animate')` nos
plugins. Se não tiver, `npm install -D tailwindcss-animate` e adicionar.

Durações:
- Desktop right slide: `duration-300` (300ms)
- Mobile bottom slide: `duration-300` (300ms)
- Overlay fade: `duration-200` (200ms)
- `prefers-reduced-motion`: respeitado globalmente

### Testes

- E2E: clique em card do kanban abre sheet com URL atualizada;
  Escape fecha; F5 cai em full-page
- E2E mobile viewport: sheet abre no bottom; tap no overlay fecha
- A11y: axe-core valida `role="dialog"` + `aria-labelledby` no Title

**Arquivos a criar/editar:**
- `src/components/ui/sheet.tsx` **(novo)**
- `src/components/ui/tabs.tsx` (via shadcn add, se ausente)
- `src/components/crm/OpportunityOverview.tsx` **(novo)** — extração
  da view atual de `app/pipeline/[id]/page.tsx`
- `src/components/crm/OpportunityAuditTrail.tsx` **(novo)** — pode
  ser inline na primeira versão
- `app/pipeline/@modal/(.)[id]/page.tsx` (refatorar)
- `src/server/trpc/routers/opportunities.ts` (talvez +1 query
  `history` ou adicionar `activitiesCount`/`documentsCount` em `byId`)

**Esforço:** ~3h (era 4h — sem swipe economiza ~1h).

---

## 7. Banners contextuais completos

**Problema:** Sprint 14 entregou `TrialExpiryBanner` e refinou
`OnboardingChecklist`. Faltam 3 banners da spec §7.3:
- Past due (pagamento em atraso)
- Offline (sem conexão)
- Manutenção programada

### Componente base reutilizável

Antes dos 3 banners específicos, criar um componente compartilhado:

**`src/components/ui/banner.tsx`** (novo):

```tsx
'use client';
import { cn } from '@/lib/utils/cn';
import { XIcon, WifiOffIcon, AlertTriangleIcon, InfoIcon } from 'lucide-react';

type BannerVariant = 'info' | 'warning' | 'danger';

const VARIANTS: Record<BannerVariant, { bg: string; text: string; Icon: any }> = {
  info:    { bg: 'bg-info-bg',    text: 'text-info-text',    Icon: InfoIcon },
  warning: { bg: 'bg-warning-bg', text: 'text-warning-text', Icon: WifiOffIcon },
  danger:  { bg: 'bg-danger-bg',  text: 'text-danger-text',  Icon: AlertTriangleIcon },
};

export function Banner({
  variant,
  icon,
  children,
  dismissible = false,
  onDismiss,
  action,
}: {
  variant: BannerVariant;
  icon?: React.ReactNode;
  children: React.ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
  action?: React.ReactNode;
}) {
  const { bg, text, Icon } = VARIANTS[variant];
  return (
    <div role="status" aria-live="polite" className={cn(
      'flex items-center gap-3 px-4 py-2 text-sm',
      bg, text,
    )}>
      <span className="shrink-0">{icon ?? <Icon className="h-4 w-4" />}</span>
      <div className="flex-1 min-w-0">{children}</div>
      {action}
      {dismissible && (
        <button
          type="button"
          aria-label="Dispensar aviso"
          onClick={onDismiss}
          className="shrink-0 rounded p-1 hover:bg-black/5"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
```

### Agregador `<ContextBanners />`

**`src/components/layout/ContextBanners.tsx`** (novo):

```tsx
'use client';
import { PastDueBanner } from './PastDueBanner';
import { OfflineBanner } from './OfflineBanner';
import { MaintenanceBanner } from './MaintenanceBanner';

export function ContextBanners() {
  return (
    <div className="space-y-px">
      {/* Ordem importa: manutenção > past due > offline */}
      <MaintenanceBanner />
      <PastDueBanner />
      <OfflineBanner />
    </div>
  );
}
```

Inserir no `<AppShell>` **antes** do conteúdo, abaixo do
`<TrialExpiryBanner>` (que já existe do Sprint 12).

### 7.1. PastDueBanner — pagamento em atraso

**`src/components/layout/PastDueBanner.tsx`** (novo):

```tsx
'use client';
import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import { Banner } from '@/components/ui/banner';

export function PastDueBanner() {
  const subQ = trpc.billing.currentSubscription.useQuery(undefined, {
    refetchInterval: 60_000, // 1min
  });

  if (subQ.data?.status !== 'PAST_DUE') return null;

  return (
    <Banner
      variant="danger"
      action={
        <Link
          href="/admin/billing"
          className="rounded bg-danger px-3 py-1 text-xs font-semibold text-white hover:bg-danger/90"
        >
          Resolver agora
        </Link>
      }
    >
      <strong>Pagamento em atraso.</strong> Regularize pra continuar usando todos os recursos.
    </Banner>
  );
}
```

- **Não descartável** — fica até a sub virar `ACTIVE` de novo
- Refetch a cada 60s pra detectar mudança de status
- Link primário pra `/admin/billing`

### 7.2. OfflineBanner — sem conexão

**`src/components/layout/OfflineBanner.tsx`** (novo):

```tsx
'use client';
import { useEffect, useState } from 'react';
import { Banner } from '@/components/ui/banner';

export function OfflineBanner() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // Estado inicial do navigator
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (online) return null;

  return (
    <Banner variant="warning">
      <strong>Sem conexão.</strong> Trabalhando offline — alterações serão sincronizadas ao reconectar.
    </Banner>
  );
}
```

- Listener `online`/`offline` do `window`
- Reconecta automaticamente quando o navegador detecta rede
- Não descartável (some sozinho quando reconectar)
- SSR-safe (estado inicial `true`, ajusta no `useEffect`)

### 7.3. MaintenanceBanner — manutenção programada

**Formato do env (decidido):**

```bash
# .env.local — vazio (default) = banner oculto
NEXT_PUBLIC_MAINTENANCE_MESSAGE=

# Qualquer string não-vazia = banner visível com aquela mensagem
NEXT_PUBLIC_MAINTENANCE_MESSAGE=Manutenção programada até 14h. Sistema disponível em breve.
```

Simples, flexível, ops controla pelo Vercel env vars sem deploy.
Sem parsing de range temporal, sem ISO date, sem boolean. Se ops
quiser que o banner suma, esvazia o env e revalida.

**`src/lib/env.ts`** — adicionar:

```ts
NEXT_PUBLIC_MAINTENANCE_MESSAGE: z.string().default(''),
```

**`.env.example`** — documentar:

```bash
# Banner de manutenção (vazio = oculto, qualquer string = visível)
NEXT_PUBLIC_MAINTENANCE_MESSAGE=
```

**`src/components/layout/MaintenanceBanner.tsx`** (novo):

```tsx
'use client';
import { useEffect, useState } from 'react';
import { Banner } from '@/components/ui/banner';
import { env } from '@/lib/env';

const DISMISS_KEY = 'maintenance-banner-dismissed';

export function MaintenanceBanner() {
  const msg = env.NEXT_PUBLIC_MAINTENANCE_MESSAGE?.trim() ?? '';
  const [dismissed, setDismissed] = useState(true); // SSR-safe default

  useEffect(() => {
    // Hidrata estado de dismiss do sessionStorage
    // Usa sessionStorage e não localStorage: ao recarregar dia
    // seguinte, banner volta a aparecer (caso ainda tenha mensagem)
    const key = `${DISMISS_KEY}:${msg}`;
    setDismissed(sessionStorage.getItem(key) === '1');
  }, [msg]);

  if (!msg) return null;
  if (dismissed) return null;

  function handleDismiss() {
    const key = `${DISMISS_KEY}:${msg}`;
    sessionStorage.setItem(key, '1');
    setDismissed(true);
  }

  return (
    <Banner variant="info" dismissible onDismiss={handleDismiss}>
      {msg}
    </Banner>
  );
}
```

- **Descartável**, mas com chave atrelada à mensagem: se ops mudar
  a mensagem, o banner volta a aparecer (sessionStorage key inclui
  a mensagem). Se ops esvaziar a mensagem, banner some imediatamente
- `sessionStorage` (não `localStorage`): some quando fecha tab,
  evita usuário esquecer o banner persistentemente fora do dia

### Render no AppShell

**`src/components/layout/AppShell.tsx`** — inserir:

```tsx
<div className="flex h-screen flex-col">
  <Topbar />
  <TrialExpiryBanner /> {/* já existe */}
  <ContextBanners />    {/* NOVO */}
  <div className="flex flex-1 overflow-hidden">
    <Sidebar />
    <main id="main-content" className="flex-1 overflow-y-auto">
      {children}
    </main>
  </div>
  <BottomNav />
</div>
```

### Testes

- Unit `tests/unit/maintenance-banner.test.ts`: env vazio → null;
  env com texto → render; dismiss persiste em sessionStorage;
  mudar mensagem reaparece
- Unit `tests/unit/offline-banner.test.ts`: mock `navigator.onLine`
  → render condicional; listener fire → atualiza
- Unit `tests/unit/past-due-banner.test.ts`: status `ACTIVE` → null;
  `PAST_DUE` → render com link
- E2E `axe-smoke`: banners têm `role="status"` + `aria-live="polite"`

**Esforço:** ~2h (4 componentes novos + 3 unit tests + integração no AppShell).

---

## 8. Lighthouse audit ≥ 90 (🟡 do Sprint 14)

Verificar primeiro se `scripts/lighthouse-audit.ts` (ou `.mjs`) já
existe — o CLAUDE.md do Sprint 14 menciona "script pronto". Se não,
criar.

### Spec do script

**`scripts/lighthouse-audit.mjs`** (criar se ausente):

```js
import { chromium } from 'playwright';
import lighthouse from 'lighthouse';
import { writeFile } from 'node:fs/promises';

const STAGING_URL = process.env.STAGING_URL ?? 'http://localhost:3000';
const ROUTES = ['/dashboard', '/pipeline', '/contacts', '/admin/billing'];
const THRESHOLDS = {
  accessibility: 90,
  performance: 85,
  'best-practices': 90,
  seo: 80,
};

const browser = await chromium.launch();
const results = [];
let failed = false;

for (const route of ROUTES) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Login E2E se necessário — depende de bypass /api/e2e/login
  // implementado no Sprint 11. Pode ser injeção de cookie de sessão.
  await page.goto(STAGING_URL + route);

  const { lhr } = await lighthouse(STAGING_URL + route, {
    port: new URL(browser.wsEndpoint()).port,
    output: 'json',
    onlyCategories: Object.keys(THRESHOLDS),
  });

  const scores = Object.fromEntries(
    Object.entries(lhr.categories).map(([k, v]) => [k, v.score * 100]),
  );
  results.push({ route, scores });

  for (const [cat, threshold] of Object.entries(THRESHOLDS)) {
    if (scores[cat] < threshold) {
      console.error(`✗ ${route} ${cat}: ${scores[cat]} < ${threshold}`);
      failed = true;
    } else {
      console.log(`✓ ${route} ${cat}: ${scores[cat]}`);
    }
  }
}

await writeFile(
  'tests/lighthouse/results.json',
  JSON.stringify(results, null, 2),
);
await browser.close();
process.exit(failed ? 1 : 0);
```

### CI workflow

**`.github/workflows/lighthouse.yml`** (criar):

```yaml
name: lighthouse
on:
  pull_request:
    paths:
      - 'src/**'
      - 'tests/**'
      - 'package.json'
  workflow_dispatch:

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npx playwright install chromium
      - run: node scripts/lighthouse-audit.mjs
        env:
          STAGING_URL: ${{ secrets.STAGING_URL }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: lighthouse-results
          path: tests/lighthouse/results.json
```

### Comentário automático no PR

```yaml
      - name: Comment PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const results = require('./tests/lighthouse/results.json');
            const body = '## 🔦 Lighthouse Results\n\n' +
              results.map(r =>
                `### ${r.route}\n` +
                Object.entries(r.scores).map(([k, v]) => `- ${k}: **${v}**`).join('\n')
              ).join('\n\n');
            await github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body,
            });
```

### Thresholds (bloqueantes pra merge em main)

| Categoria | Mínimo | Justificativa |
|---|---|---|
| Accessibility | 90 | WCAG AA é requisito legal (LBI/ADA/EAA) |
| Performance | 85 | LCP < 2.5s, FID < 100ms, CLS < 0.1 |
| Best Practices | 90 | HTTPS, sem libs vulneráveis, console.error limpo |
| SEO | 80 | Não-crítico (app B2B logado), só baseline |

**Bloqueador atual:** staging não está operacional ainda. Esse item
fica em standby até definirmos staging (Sprint 15 hardening de prod).
Localmente o script pode ser rodado contra `http://localhost:3000`
mas as métricas variam muito por causa de HMR + sem build de
produção; não bate threshold de Performance.

**Esforço:** ~3h (quando staging existir): criar script + workflow +
configurar STAGING_URL como secret no GitHub repo + rodar
manualmente uma vez pra calibrar.

---

## 9. Visual regression baseline capturado (🟡 do Sprint 14)

Script `scripts/visual-baseline.ts` já existe (criado no Sprint 14
como P0). Depende de app rodando com seed E2E.

### ⚠️ Por que esse item fica POR ÚLTIMO no sprint

Se o baseline for capturado no início do sprint, **todas as mudanças
visuais (border-radius, PipelineBoard, FunnelChart, polish das 21
telas, banners, popovers, DetailSheet refinado)** vão aparecer como
"regressão" no diff — o que torna o baseline inútil pra detectar
regressão real de UI.

A ordem correta é:
1. Aplicar **todos** os ajustes visuais do sprint
2. Validar manualmente as 25+ telas (smoke test)
3. **Então** capturar o baseline congelando o estado final
4. Próximos PRs (Sprint 15+) usam esse baseline pra detectar
   regressões visuais não-intencionais

### Procedimento

**Passo 1 — Preparar ambiente:**

```bash
cd ~/Claude/crm-app
npm run dev   # terminal 1
npm run db:seed  # terminal 2
```

Verificar que:
- Postgres responde (`npx prisma db execute --file /dev/null --schema prisma/schema.prisma` não erra)
- App responde em `http://localhost:3000` (`curl -fI` retorna 200)
- Seed populou 3 tenants (`acme`, `beta`, `gamma`)

**Passo 2 — Login E2E via fixture (do Sprint 11):**

```bash
# Setar env do tenant de teste no .env.test.local
E2E_TEST_TENANT_ID=<uuid do tenant 'acme'>
E2E_TEST_USER_ID=<uuid do user admin do acme>
NODE_ENV=test
```

A fixture `tests/e2e/fixtures/auth.ts` injeta cookie de sessão via
`POST /api/e2e/login` (gated por `NODE_ENV=test`) sem precisar
passar por Clerk de verdade.

**Passo 3 — Rodar o script:**

```bash
npx tsx scripts/visual-baseline.ts
```

O script percorre **25 rotas × 3 viewports** (375 / 768 / 1280):

| Categoria | Rotas |
|---|---|
| Auth | `/sign-in`, `/sign-up` |
| Public | `/`, `/privacy`, `/terms`, `/privacy-request`, `/p/[slug]/contact` |
| Onboarding | `/onboarding`, `/onboarding/setup` |
| Core ops | `/dashboard`, `/pipeline`, `/pipeline/[id]`, `/companies`, `/contacts`, `/reports`, `/inbox`, `/search` |
| Workflow | `/approvals`, `/contracts`, `/imports` |
| Admin | `/admin/ai`, `/admin/alerts`, `/admin/approval-rules`, `/admin/billing`, `/admin/branding`, `/admin/contracts`, `/admin/conversion-rates`, `/admin/email-inbound`, `/admin/partners`, `/admin/privacy`, `/admin/products`, `/admin/templates`, `/admin/users` |

Total: ~30 rotas × 3 viewports = ~90 PNGs salvos em
`tests/visual/baseline/{route-slug}-{viewport}.png`.

**Passo 4 — Validar visualmente uma amostra:**

```bash
# Abrir alguns dos PNGs e confirmar visualmente
open tests/visual/baseline/dashboard-1280.png
open tests/visual/baseline/pipeline-375.png
open tests/visual/baseline/admin-branding-1280.png
```

Se algum PNG estiver com erro (ex: 404 render, modal de Clerk
aparecendo por cima, banner de erro), corrigir antes de commitar
o baseline.

**Passo 5 — Commitar o baseline:**

```bash
git add tests/visual/baseline/
git commit -m "chore: capture visual baseline after Sprint 14.5

Estado final do Sprint 14.5 — 30 rotas × 3 viewports = 90 PNGs.
Servirá como baseline pra detectar regressões visuais não-intencionais
nos próximos sprints. Diffs serão gerados em tests/visual/diff/ a
cada PR e apresentados pra aprovação manual."
git push
```

### CI workflow (futuro, opcional pra este sprint)

```yaml
name: visual-regression
on: pull_request
jobs:
  diff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npx playwright install chromium
      - run: npm run db:seed
      - run: npx tsx scripts/visual-baseline.ts --output current
      - run: npx tsx scripts/visual-diff.mjs  # gera diff/ comparando current/ vs baseline/
      - uses: actions/upload-artifact@v4
        with:
          name: visual-diffs
          path: tests/visual/diff/
```

Aprovação manual: revisor olha os PNGs em `diff/`. Se diff
intencional, copia `current/*` pra `baseline/*` e re-commita.

**Esforço:** ~1.5h (preparar env + rodar script + validar amostra +
commit). NÃO requer staging, pode rodar local.

---

## Resumo de esforço

| Item | Esforço | Ajuste vs v1 |
|---|---|---|
| **2. Border-radius bump (PRIMEIRO)** | 30min | — |
| 1. PipelineBoard + OpportunityCard overflow | 2–3h | — |
| 3. FunnelChart `/reports` | 3–4h | — |
| 4. Polish 21 rotas internas (9 + 12 admin) | 1.5–2 dias | escopo explícito |
| 5. Popover via `shadcn add popover` | **1h** | ⬇️ era 3h, não from scratch |
| 6. DetailSheet tabs + bottom sheet (sem swipe) | **3h** | ⬇️ era 4h, sem framer-motion |
| 7. Banners (past due, offline, maintenance) | 2h | NEXT_PUBLIC_MAINTENANCE_MESSAGE definido |
| **9. Visual baseline (POR ÚLTIMO)** | 1.5h | move pro fim |
| 8. Lighthouse audit (depende staging) | standby | — |

**Total: ~3 dias** de trabalho de design polish (era 3–4; ajustes
de escopo apertaram).

## Não é escopo desse sprint

- Novas features
- Migrations
- Mudanças no schema Prisma
- Mudanças em procedures tRPC (a não ser que sejam pra suportar UI nova, ex: `pipeline.list` retornando dados pra FunnelChart)
- Sentry/Axiom wiring (Sprint 15 hardening)
- Carga (k6) — Sprint 15

## Critérios de aceite

- ✅ Border-radius dos cards mais generoso aplicado **primeiro**
  (sm 6 / 8 / md 12 / lg 16 / xl 20)
- ✅ Pipeline kanban: colunas ≥ 280px, valores em gold/tabular-nums abaixo do nome, sem overflow
- ✅ FunnelChart com layout interno, largura por contagem, sinal correto, opcionalmente SVG funil
- ✅ **21 rotas internas** com `<PageHeader>` consistente + empty
  states com voz Venzo + tabelas refinadas (9 operacionais + 12
  admin, exceto `/admin/branding` e `/admin/billing` que já tinham
  polish profundo)
- ✅ Popover via shadcn (`@radix-ui/react-popover` agregado no package)
- ✅ DetailSheet com 4 tabs no desktop + bottom sheet mobile (fecha
  via X, overlay, Escape; swipe-down fora do escopo — Sprint 15+)
- ✅ Past due / offline / maintenance banners funcionando.
  `NEXT_PUBLIC_MAINTENANCE_MESSAGE` controla manutenção (vazio = oculto)
- ✅ Visual baseline capturado **por último**, após todos os items
  visuais, e commitado em `tests/visual/baseline/`
- ✅ 235+ testes anteriores continuam passando + ≥ 10 novos
- 🟡 Lighthouse ≥ 90 (aguarda staging — Sprint 15)
