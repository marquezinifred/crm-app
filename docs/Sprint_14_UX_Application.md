# Sprint 14 — UX Application Pass (Venzo Design System)

Complementa `docs/venzo_ux_spec.docx` (spec completo do design
system) e `docs/venzo_ui_preview.html` (protótipo executável).

## Por que esse sprint existe

Os Sprints 0–13 entregaram funcionalidade end-to-end mas com Tailwind
genérico (`bg-white`, `border-neutral-200`, sem hierarquia tipográfica,
sem voz Venzo no microcopy). O Sprint 10.5 entregou o **engine de
theming** (`--brand-*`, validação WCAG, switching) mas **não refatorou
os componentes existentes** — eles continuam consumindo classes
neutras em vez do design system Venzo.

Resultado prático: tenant Enterprise pode trocar a cor primária e
verá os botões mudarem, mas a app continua "Tailwind cru" no resto.
Falta a aplicação consciente do brand guide em toda a UI.

Este sprint é a **camada de aplicação** — não é nova feature.

## Objetivo

Refatorar todas as ~25 telas + componentes shared para implementar o
design system Venzo:
- **Dark mode first** com light mode funcional
- **Plus Jakarta Sans** com hierarquia explícita (display/h1/h2/h3/body/caption/mono)
- **Sidebar 240px** refinada com seções agrupadas (Operação / Documentos / Parceiros / Admin)
- **Componentes refeitos** seguindo spec (botões, inputs, badges, avatares, tabelas, modais, toasts)
- **Componentes CRM-específicos** (card oportunidade com IA badge, timeline atividades, detail sheet, kanban refinado)
- **Voice & tone Venzo** no microcopy (substituir "Nenhum item encontrado" por "3 negócios aguardando sua atenção")
- **WCAG 2.1 AA** verificado em CI via axe-core

## Escopo detalhado

### 1. Design tokens (foundation)

- [ ] CSS custom properties em `:root` (dark) e `[data-theme="light"]`:
  - `--color-bg-page`, `--color-bg-card`, `--color-bg-hover`
  - `--color-border`, `--color-border-strong`
  - `--text-primary`, `--text-secondary`, `--text-muted`
  - `--brand-primary`, `--brand-primary-dark`, `--brand-primary-mid`,
    `--brand-primary-light`, `--brand-primary-pale`, `--brand-accent`
  - Semânticas: `--success/-bg/-text`, `--danger/-bg/-text`,
    `--warning/-bg/-text`, `--info/-bg/-text`
  - Espaçamento: `--space-1/2/3/4/5/6/8/12` (4/8/12/16/20/24/32/48px)
  - Raios: `--radius-sm/-/-md/-lg/-full`
- [ ] Alternância dark/light: `<html data-theme="dark|light">` controlada
  via `ThemeToggle` no topbar. Default dark. Persistência localStorage.
  Respeita `prefers-color-scheme` se nunca escolheu.
- [ ] Plus Jakarta Sans via Google Fonts com `preconnect` + Inter fallback
- [ ] Atualizar `tailwind.config.ts` pra consumir as CSS vars como tokens
  Tailwind: `colors.brand.primary = 'var(--brand-primary)'`, etc.

### 2. AppShell refinado

- [ ] **Sidebar 240px desktop** (`>= md`):
  - Logo Venzo no topo (22px 900 violet-light, sub-text 10px muted)
  - Grupos: **Operação** (Dashboard, Pipeline, Contatos, Empresas, Atividades, Tarefas) /
    **Documentos** (Propostas, Contratos, Documentos) /
    **Parceiros** (Parceiros, Comissões) /
    **Admin** (Usuários, Produtos, Billing, Configurações)
  - Cada item: ícone Tabler 16px + label 13.5px, padding 8px 10px
  - Item ativo: bg `rgba(124,58,237,0.12)` + border-left 2px violeta +
    cor violet-light + `aria-current="page"`
  - Colapsável pra 56px (só ícones + tooltips), atalho `Cmd+B/Ctrl+B`,
    persiste em localStorage
  - Footer: avatar 28px + nome + role + dropdown (Perfil/Config/Sair)

- [ ] **BottomNav mobile** (`< md`):
  - 5 tabs: Início, Pipeline, Atividades (badge tarefas vencidas),
    Alertas (badge não lidos), Mais
  - Badges com contador (dot vermelho 16px)
  - Safe-area-inset-bottom respeitado

- [ ] **Topbar 56px** desktop / 48px mobile:
  - Breadcrumb com separadores (`Dashboard › Pipeline › Acme Corp`)
  - Busca global 280px → ativa Command Palette (`Cmd+K`/`Ctrl+K`)
  - Ações primárias contextuais (botão `+ Nova Oportunidade` quando aplicável)
  - Notificações (sininho com badge)
  - ThemeToggle (`☀️` / `🌙`)

- [ ] **Skip link** como primeiro elemento focável: "Pular para conteúdo principal"

### 3. Componentes base (substitui shadcn/ui genérico)

Cada componente abaixo é refatorado pra consumir tokens e respeitar
estados WCAG. Onde já existe em `src/components/ui/`, atualizar; onde
não, criar.

- [ ] **Button** — 5 variants (Primary/Secondary/Ghost/Danger/Link),
  3 tamanhos (sm 32px / md 40px / lg 48px), ícone+texto com gap 6px,
  loading state com spinner, focus ring 2px offset 2px
- [ ] **Input/Textarea/Select** — 6 estados (default/hover/focus/filled/
  error/disabled/readonly), altura 40px, label 14px 500 acima,
  helper text 12px muted, erro 12px danger com `role="alert"` e
  `aria-describedby`
- [ ] **Badge** — 7 tipos (Default/Primary/Success/Danger/Warning/Info/Gold),
  altura 20px, font-size 11px 600, radius-full
- [ ] **Avatar** — foto OU iniciais (violet 10% bg, violet-light text),
  tamanhos 24/32/40/48/64px, avatar-group sobreposto, online status dot
- [ ] **Checkbox/Radio/Switch** — 16×16px (controles), 32×16px (switch),
  area clicável 44×44px via padding invisível
- [ ] **Tooltip** — delay 300ms hover, máx 240px, `role="tooltip"` +
  `aria-describedby`
- [ ] **Popover** — até 320px, focus trap, Escape fecha

### 4. Componentes de dados

- [ ] **Table** — header 13px 500 uppercase, linha 48px hover bg,
  zebra striping em > 10 linhas, célula de ação aparece no row hover,
  paginação no rodapé, empty state com ícone+CTA, loading com
  skeleton shimmer (não spinner!), busca/filtro persiste em URL
- [ ] **Mobile cards** — tabelas viram cards empilhados em `< 768px`,
  border-left 3px de status quando aplicável
- [ ] **Estados especiais**:
  - Empty state: ícone 48px + título + CTA. Copy estilo Venzo
    ("Você não tem oportunidades ainda. Crie a primeira.")
  - Loading: skeleton com shimmer animation
  - Error: ícone `ti-alert-triangle` + mensagem humana + botão Tentar novamente
  - Offline: banner topo full-width amarelo
  - Filtro vazio: variação do empty + botão Limpar filtros

### 5. Componentes CRM-específicos

- [ ] **OpportunityCard** (Kanban) —
  - Header: nome empresa 16px 600 + badge estágio + valor 14px gold bold
  - Corpo: contato (avatar 20px) + próxima atividade (ícone calendar)
    + % probabilidade
  - Rodapé: responsável (avatar 24px) + dias no estágio + ícone alerta
  - **border-left 3px danger** se follow-up vencido / warning se ≤ 48h
  - **IA badge** (`ti-sparkles`) com score de probabilidade calculado

- [ ] **ContactCard** —
  - Avatar 40px + badge de tipo (decisor/influenciador/usuário)
  - E-mail/Telefone/LinkedIn clicáveis (ícones Tabler 16px)
  - Banner de próxima data importante se aplicável
  - Ações rápidas (E-mail/Ligar/Agendar/Mais)

- [ ] **ActivityTimeline** —
  - Linha vertical 1px com dots coloridos por tipo (Manual/Sistema/
    E-mail/Reunião/Alerta)
  - Cards de item com expandir se > 3 linhas
  - Agrupamento por dia com sticky header
  - Input inline no topo pra adicionar nota (Ctrl+Enter salva)

- [ ] **DetailSheet** (slide-in 400px direita) —
  - Substituir o `/pipeline/[id]/page.tsx` full-page por sheet
  - Tabs: Visão Geral / Atividades / Documentos / Histórico
  - Escape fecha, click overlay fecha, foco retorna ao trigger
  - Mobile: bottom sheet 85vh com handle de arrastar

- [ ] **PipelineBoard** —
  - Colunas com header (nome + count + valor total gold)
  - drag-and-drop via `@dnd-kit/sortable` (já está no projeto?)
  - Coluna colapsada 56px com nome vertical
  - Filtros globais persistentes em URL

### 6. Feedback e notificações

- [ ] **Toast** — 4 tipos com cor border-left, 360px, auto-dismiss
  (success/info/warning 4-6s; error manual), aria-live polite/assertive
- [ ] **Modal** — `role="dialog"` + `aria-modal="true"`, overlay dim,
  focus trap, Escape fecha, ordem botões sempre Cancelar antes de
  Confirmar, ação destrutiva em Danger nunca Primary
- [ ] **Banners de contexto** — trial expirando, past due, setup
  incompleto (já tem), offline, manutenção

### 7. Refactor das telas existentes

Cada rota abaixo recebe o pass de design. Foco: substituir Tailwind
genérico por componentes do novo design system + aplicar voice & tone.

| Rota | Refactor |
|---|---|
| `/dashboard` | Cards de KPI com Gold pra valores, timeline de atividades, checklist de setup já estilizado |
| `/pipeline` | Kanban com OpportunityCard refinado, filtros persistentes URL |
| `/pipeline/new`, `/pipeline/[id]` | DetailSheet em vez de full-page; form com Input refinado |
| `/companies` | Table com mobile cards, empty state com voz Venzo |
| `/contacts` | ContactCard, busca persistente |
| `/reports` | KPIs no topo, gráficos com cores semânticas |
| `/inbox` | Lista densa estilo e-mail (item compacto), badge não lido |
| `/search` | Input grande no topo, resultados agrupados por entidade |
| `/approvals` | Lista densa com badge status, ações rápidas |
| `/contracts` | Table com filtros, badge status |
| `/imports` | Wizard com steps refinados |
| `/admin/*` | Layout consistente: header com título+descrição+ação primária, conteúdo em card |
| `/admin/branding` | Já está mais polida — passar o design tokens nela também |
| `/onboarding/setup` | Checklist visual com voz Venzo (já implementado, refinar) |
| `/sign-in`, `/sign-up` | Layout centralizado escuro com logo Venzo destacado |
| `/privacy`, `/terms` | Tipografia editorial (line-height 1.6, max-width 720px) |
| `/privacy-request` | Form público com Venzo branding |
| `/p/[tenantSlug]/contact` | Form público estilizado (tenant pode customizar via theme) |

### 8. Voice & tone (microcopy)

Substituir mensagens robóticas por voz Venzo (do brand guide). Cada
empty state, erro técnico, sucesso, alerta deve ser revisado.

**Exemplos antes/depois:**

| Contexto | Atual | Venzo |
|---|---|---|
| Pipeline vazio | "Nenhuma oportunidade encontrada." | "**3 negócios aguardando sua atenção.**" (com dados reais) ou "Você ainda não criou oportunidades. **Crie a primeira.**" |
| Negócio fechado | "Status atualizado com sucesso." | "**Ganhou!** +R$ 280K no pipeline de outubro." |
| Alerta de inatividade | "Registro desatualizado detectado." | "**Horizonte Construtora: 7 dias sem contato.**" |
| Erro de permissão | "Acesso negado. Erro 403." | "**Só gestores acessam relatórios financeiros.**" |
| Primeiro cadastro | "Registro criado com sucesso!" | "**Primeiro negócio criado. Bom trabalho.**" |
| Meta atingida | "Quota reached for current period." | "**Meta de outubro: 100%.** Equipe incrivel." |
| Erro técnico | "Internal server error. Code 500." | "**Algo saiu errado.** Tente novamente." |

**Princípios:**
- Direto. Vai ao ponto.
- Confiante. Afirma, não sugere.
- Orientado a resultado.
- Humano. "Pessoas", não "usuários".
- Celebra fechamento sem exagero.
- Erros técnicos viram linguagem humana, sem stack/HTTP codes.

### 9. Acessibilidade WCAG 2.1 AA (verificação em CI)

- [ ] Focus ring visível em **todos** os elementos interativos
- [ ] Contraste ≥ 4.5:1 (texto normal) / ≥ 3:1 (texto grande, ícones)
- [ ] Touch targets ≥ 44×44px em mobile
- [ ] Navegação por teclado completa (Tab, Shift+Tab, Enter, Space,
  Escape, Arrow keys em menus/tabs/radio groups)
- [ ] `prefers-reduced-motion` reduz durations a 0.01ms
- [ ] `@axe-core/playwright` integrado em testes E2E — zero violações AA
- [ ] Lighthouse Accessibility ≥ 90 em `/dashboard`, `/pipeline`,
  `/contacts`, `/admin/billing` (bloqueante pra merge em main)
- [ ] Testado com VoiceOver no fluxo login → criar oportunidade → salvar

### 10. Performance

- [ ] LCP < 2.5s (prefetch fonts, `next/image`, SSR de dados críticos)
- [ ] FID/INP < 100ms (sem tarefas JS > 50ms no main thread)
- [ ] CLS < 0.1 (dimensões explícitas em imagens e skeletons)
- [ ] Lighthouse Performance ≥ 85 nas mesmas rotas
- [ ] Bundle analysis: identificar e code-split bibliotecas pesadas
  por rota

### 11. Testes

- [ ] Unit: tokens, theme switching, color contrast computation
- [ ] Component (Storybook? ou Playwright component tests): cada
  variant de Button/Input/Badge etc
- [ ] E2E: dark/light toggle, sidebar collapse, kanban drag-drop
- [ ] A11y: axe-core em cada PR, Lighthouse na CI semanal

## Critérios de aceite

- ✅ Dark mode é o default — usuário vê app escura no primeiro acesso
- ✅ Light mode funciona igualmente bem — toggle no topbar
- ✅ Sidebar desktop 240px, agrupada, colapsável, persistente
- ✅ Plus Jakarta Sans carregada em todas as telas, hierarquia visível
- ✅ Botão primário violeta tem 1 só ocorrência por tela
- ✅ Kanban tem OpportunityCard refinado com IA badge
- ✅ Empty states em **toda** a app têm voz Venzo (verificar por grep
  de "Nenhum encontrado" — não pode sobrar nenhum)
- ✅ Contraste validado: dark mode passa em 100% das combinações,
  light mode também
- ✅ axe-core zero violações AA em PR
- ✅ Lighthouse Accessibility ≥ 90 em 4 rotas-chave
- ✅ 217 testes anteriores continuam passando + ≥ 20 novos de design
  system
- ✅ Visual regression: 25 screenshots de telas-chave comparadas a
  versão anterior (Playwright)

## Esforço estimado

- **Foundation (tokens + theme switch + AppShell)**: ~2 dias
- **Componentes base refeitos**: ~2 dias
- **Componentes CRM-específicos**: ~2 dias
- **Refactor das 25 telas existentes**: ~3 dias
- **Voice & tone pass**: ~1 dia
- **A11y + Performance + Testes**: ~1 dia

**Total: 10–11 dias** (~2 semanas)

## NÃO fazer neste sprint (escopo fora)

- Animações elaboradas além das ~150–300ms da spec
- Novo schema de banco
- Novas features de negócio
- Internacionalização (i18n) — fica pra sprint posterior
- Storybook completo (componente library standalone) — pode entrar
  num sprint dedicado se necessário
