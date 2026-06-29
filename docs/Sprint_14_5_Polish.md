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

**Problema:** Tooltip foi entregue, Popover não.

**Solução:** **NÃO construir do zero.** O projeto já usa shadcn/ui +
Radix; o `Popover` do Radix tem focus trap, Escape, posicionamento
automático via Floating UI e é totalmente acessível.

```bash
npx shadcn-ui@latest add popover
```

Isso adiciona `@radix-ui/react-popover` no `package.json` e cria
`src/components/ui/popover.tsx` como wrapper estilizado do Radix.
Depois é só customizar pra consumir tokens Venzo:

```tsx
// src/components/ui/popover.tsx (após shadcn add)
// — confirmar que PopoverContent usa:
//   bg-card border-border rounded-lg shadow-lg p-4
//   max-w-80 z-50
//   data-[state=open]:animate-in data-[state=closed]:animate-out
```

**Usos imediatos:**
- Filtros do pipeline (substituir dropdown nativo)
- Settings inline do card de oportunidade
- Métricas detalhadas do funil (hover no valor total da coluna)

**Esforço:** ~1h (era 3h — shadcn add economiza ~2h).

---

## 6. DetailSheet com tabs + bottom sheet mobile (sem swipe gesture)

**Problema:** Sprint 14 entregou as intercepting routes (URL preservada,
sheet de 400px no desktop) mas **falta:**
- Tabs internas (Visão Geral / Atividades / Documentos / Histórico)
- Bottom sheet mobile 85vh
- Animação slide-in 200ms

**Decisão arquitetural — swipe-down fica fora do escopo:**
O projeto **não tem `framer-motion`** (confirmado no `package.json`).
Implementar swipe-down com snap e threshold corretos exige adicionar
`framer-motion` (~130kb) + decisões sobre snap intermediário,
threshold de velocidade, etc. Pra evitar inflar bundle e inventar
comportamentos sem spec, **bottom sheet fecha apenas via:**
- Botão X no header
- Tap no overlay
- Tecla Escape
- Botão Voltar do navegador (intercepting route já cuida)

Swipe-down entra num sprint futuro **se** framer-motion for adotado
oficialmente (provavelmente Sprint 15+ pra microinterações).

**Solução:**

```tsx
// app/pipeline/@modal/(.)[id]/page.tsx
<Sheet variant={isMobile ? 'bottom' : 'right'} onClose={...}>
  <SheetHeader title={opp.name} status={opp.stage} onClose={...} />
  <Tabs defaultValue="overview">
    <TabsList>
      <TabsTrigger value="overview">Visão Geral</TabsTrigger>
      <TabsTrigger value="activities">Atividades</TabsTrigger>
      <TabsTrigger value="documents">Documentos</TabsTrigger>
      <TabsTrigger value="history">Histórico</TabsTrigger>
    </TabsList>
    <TabsContent value="overview"><OpportunityOverview /></TabsContent>
    {/* ... */}
  </Tabs>
</Sheet>
```

- Desktop: `slide-in-right` 400px via CSS transition (300ms), overlay dim 40%
- Mobile (`< 768px`): bottom sheet 85vh com slide-up via CSS transition; overlay tap fecha
- Escape fecha; foco retorna ao trigger
- Handle de arrastar mantido como **decoração visual** (linha cinza
  ao topo) mesmo sem ser arrastável — sinaliza affordance pra
  futuro swipe

**Arquivos:** `src/components/ui/sheet.tsx` (novo, **sem** framer-motion;
puro CSS + Radix Dialog), `src/components/ui/tabs.tsx` (via
`npx shadcn-ui@latest add tabs` se ainda não existe),
`app/pipeline/@modal/(.)[id]/page.tsx`.

**Esforço:** ~3h (era 4h — sem swipe economiza ~1h).

---

## 7. Banners contextuais completos

**Problema:** Sprint 14 entregou `TrialExpiryBanner` e refinou
`OnboardingChecklist`. Faltam:
- Past due (pagamento em atraso)
- Offline (sem conexão)
- Manutenção programada

**Solução:**

`<ContextBanners />` no `<AppShell>` no topo, abaixo do
`<TrialExpiryBanner>`:

```tsx
// src/components/layout/ContextBanners.tsx
export function ContextBanners() {
  return (
    <>
      <PastDueBanner />     {/* checa subscription.status === 'past_due' */}
      <OfflineBanner />     {/* navigator.onLine listener */}
      <MaintenanceBanner /> {/* env NEXT_PUBLIC_MAINTENANCE_MESSAGE */}
    </>
  );
}
```

Spec §7.3:
- **Past due** — vermelho, link pra `/admin/billing`, não descartável
- **Offline** — amarelo, ícone `wifi-off`, reconecta automaticamente
- **Manutenção** — info azul, descartável

**Formato do env de manutenção (decidido):**

```bash
# .env.local — vazio (default) = banner oculto
NEXT_PUBLIC_MAINTENANCE_MESSAGE=

# Qualquer string não-vazia = banner visível com aquela mensagem
NEXT_PUBLIC_MAINTENANCE_MESSAGE=Manutenção programada até 14h. Sistema disponível em breve.
```

Simples, flexível, ops controla pelo Vercel env vars sem deploy.
Sem parsing de range temporal, sem ISO date, sem boolean. Se ops
quiser que o banner suma, esvazia o env e revalida.

Atualizar `src/lib/env.ts`:
```ts
NEXT_PUBLIC_MAINTENANCE_MESSAGE: z.string().optional().default(''),
```

`MaintenanceBanner` retorna `null` se mensagem vazia, render do banner
caso contrário.

**Esforço:** ~2h.

---

## 8. Lighthouse audit ≥ 90 (🟡 do Sprint 14)

Script `scripts/lighthouse-audit.ts` provavelmente já existe. Depende
de staging operacional.

**Plano:**

1. Configurar `STAGING_URL` no GitHub Actions
2. Rodar Lighthouse contra 4 rotas-chave:
   - `/dashboard`
   - `/pipeline`
   - `/contacts`
   - `/admin/billing`
3. Bloquear PR se Accessibility < 90 ou Performance < 85
4. Reportar resultados num PR comment automático

**Bloqueador atual:** staging não está operacional ainda. Esse item
fica em standby até definirmos staging (Sprint 15 hardening de prod).

**Esforço:** ~3h (quando staging existir).

---

## 9. Visual regression baseline capturado (🟡 do Sprint 14)

Script `scripts/visual-baseline.ts` já existe. Depende de app rodando
com seed E2E.

**Plano:**

1. Rodar app local com `npm run dev` + seed (`npm run db:seed`)
2. Login E2E via fixture (já criada no Sprint 11)
3. Executar `npx tsx scripts/visual-baseline.ts`
4. Commit dos PNGs em `tests/visual/baseline/`
5. Workflow CI compara com `tests/visual/current/` em cada PR
6. Diffs apresentados pra aprovação manual via GitHub action

**Pode ser feito agora** se quiser — não depende de staging.
Captura o estado atual pós-Sprint 14 como baseline. Próximos sprints
(incluindo este 14.5) terão diffs visuais documentados.

**Esforço:** ~1.5h (rodar script + commit baseline).

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
