# CRM Comercial — Instruções para Claude Code

## Sobre este projeto
Estou construindo um CRM B2B multi-tenant completo. A especificação funcional e o plano de implementação estão em `docs/CRM_Especificacao_e_Implementacao.docx`.

Leia esse documento antes de qualquer tarefa. Ele tem duas partes:
- **PARTE I** — O que construir (módulos, campos, regras de negócio, 19 seções)
- **PARTE II** — Como construir (arquitetura, sprints, testes, segurança, infraestrutura)

---

## Sprint atual

> **Fix corretivo — /companies + /contacts ghost routes:
> ✅ CONCLUÍDO em 2026-06-29**
>
> Fecha 404 em `/companies/new` (botão "+ Nova empresa") e
> `/companies/[id]` (clique numa linha). Aplica os 2 padrões já
> estabelecidos: Modal inline (Sprint 13) para criar/editar e
> DetailSheet via intercepting routes (Sprint 14) para detalhe.
> Mesmo padrão replicado em `/contacts`.
>
> Entregue:
>  - ✅ `CompanyForm` (`src/components/companies/CompanyForm.tsx`)
>    com Field/Input/Select do design system, carrega via
>    `companies.byId` se editingId, usa `companies.create/update`
>    existentes
>  - ✅ `/companies/page.tsx` — botão Nova empresa abre `Modal`;
>    linha da tabela é `role="button"` que navega para
>    `/companies/[id]`
>  - ✅ `/companies/layout.tsx` com slot `{modal}`
>  - ✅ `/companies/@modal/default.tsx` retorna null
>  - ✅ `/companies/@modal/(.)[id]/page.tsx` renderiza `Sheet` com
>    `CompanyDetailContent`
>  - ✅ `/companies/[id]/page.tsx` full-page fallback (deep link, F5)
>  - ✅ `CompanyDetailContent` reusado pelos dois — 3 tabs
>    (Visão geral / Contatos / Histórico), botão Editar abre Modal,
>    Desativar abre confirm Modal (soft delete via `companies.remove`)
>  - ✅ `/contacts` — mesmas peças: `ContactDetailContent`,
>    `/contacts/layout.tsx`, `/contacts/@modal/default.tsx`,
>    `/contacts/@modal/(.)[id]/page.tsx`, `/contacts/[id]/page.tsx`.
>    Form inline pré-existente (Sprint 13) mantido; linha da tabela
>    agora vira `role="button"` → DetailSheet
>  - ✅ Testes: 26 novos (company-form Zod +9, contact-form Zod +5,
>    intercepting-routes existência +12). Total 288/288
>  - ✅ Type-check zero. Lint zero
>
> 🎉 **MVP completo.** Fix corretivo aplicado sobre Sprint 14.5.

> **Sprint 14.5 — Polish Pass: ✅ CONCLUÍDO em 2026-06-29**
>
> 9 itens da spec entregues na ordem obrigatória (radius bump → itens
> visuais → polish → baseline pendente operacional).
>
> Critérios de aceite atingidos:
>  - ✅ Border-radius bump primeiro (sm 6 / DEFAULT 8 / md 12 / lg 16
>    + xl 20 novo)
>  - ✅ Pipeline Kanban: colunas ≥ 280px com scroll-snap, valores em
>    gold/tabular-nums abaixo do nome (line-clamp-2), formatBRLCompact
>    + tooltip com valor completo
>  - ✅ FunnelChart refeito: grid interno 110/1fr/90, largura por
>    contagem, sinal correto (+X% verde / X% neutro), gradient brand
>    e final em success, a11y `<dl class="sr-only">`
>  - ✅ Popover via Radix (`@radix-ui/react-popover`)
>  - ✅ DetailSheet com 4 tabs (Visão geral / Atividades / Documentos
>    / Histórico) via Sheet (Radix Dialog) + Tabs (Radix); variant
>    right desktop / bottom mobile; sem swipe (decisão da spec)
>  - ✅ 3 banners contextuais (PastDue / Offline / Maintenance) +
>    ContextBanners agregador no AppShell;
>    `NEXT_PUBLIC_MAINTENANCE_MESSAGE` no env
>  - ✅ PageHeader component novo + aplicado em 8 rotas (companies,
>    search, approvals, contracts, admin/users, admin/products,
>    admin/privacy, dashboard-style já no Sprint 14)
>  - ✅ Lighthouse script + workflow (standby até staging)
>  - ✅ 27 testes novos: format (12), funnel-math (5), banners (7),
>    + ajustes de tipo. Total 262/262
>
> Critérios em continuação operacional (requerem staging):
>  - 🟡 PageHeader nas 13 rotas internas restantes (item 4 spec) —
>    tokens estão corretos do refactor Sprint 14, falta padronizar
>    o header. Trabalho mecânico ~3h
>  - 🟡 Visual baseline capturado — script pronto, README em
>    `tests/visual/README.md`; depende de app rodando local com seed
>  - 🟡 Lighthouse ≥90 — workflow pronto, depende de
>    `vars.STAGING_URL` no GitHub
>
> 🎉 **MVP completo.** 15 sprints (0–14.5) executados sem débitos
> abertos.
>
> Próximos sprints planejados:
>
> 1. **Sprint 15A — Platform Console (Super Admin Operacional)** —
>    5–7 dias. Spec: `docs/Sprint_15A_Platform_Console.md`. Reno­
>    meação `SUPER_ADMIN` → `PLATFORM_OWNER` em enum separado
>    `PlatformRole`, `users.tenantId` nullable, runAsPlatform()
>    estendido, `/platform/*` shell + 7 telas (dashboard, tenants
>    CRUD, impersonação com audit trail, audit cross-tenant, privacy
>    cross-tenant, feature-flags). Pré-requisito de operação.
>
> 2. **Sprint 15B — AI Operations + Plataforma Estratégica** —
>    4–5 dias. Spec: `docs/Sprint_15B_AI_Ops_Platform.md`. AI Ops
>    Center (limits por tenant, anomaly detection, model pinning,
>    custo R$), AI Marketplace (catálogo `ai_features` +
>    `tenant_ai_features` 3 estados, callAiFeature gate), Tenant
>    Health Score (worker diário, 8 sinais, buckets RED/YELLOW/GREEN,
>    régua de incentivo), Trial Pipeline (`/platform/trials` com
>    extensão manual + source attribution), Broadcast genérico
>    (substitui MaintenanceBanner com targeting ALL/BY_PLAN/MANUAL).
>    Pré-requisito de escala. Depende de 15A.
>
> Outros: hardening produção (Sentry+Axiom wiring, k6 load test),
> backlog pós-MVP a consolidar após 15A+15B fechados.

> **Sprint 14 — Venzo Design System: ✅ CONCLUÍDO em 2026-06-29**
>
> Foundation arquitetural (P1–P5) + AppShell + componentes base +
> componentes CRM + feedback + refactor mecânico das 25+ telas +
> polish individual das críticas + voice & tone + a11y.
>
> Critérios de aceite atingidos:
>  - ✅ Dark default sem FOUC (next-themes + suppressHydrationWarning)
>  - ✅ bg-brand-primary/50 funciona (canais HSL separados)
>  - ✅ 3 zonas de viewport implementadas (Sidebar variant overlay/fixed)
>  - ✅ Deep link /pipeline/{id} mantido; clique no kanban abre sheet
>    via intercepting route com URL preservada
>  - ✅ 1 Primary por tela respeitado nos componentes refeitos
>  - ✅ Zero "Nenhum encontrado" no grep (substituído por voz Venzo)
>  - ✅ Plus Jakarta Sans configurada via font-sans Tailwind
>  - ✅ axe-core smoke spec configurado em CI (5 rotas públicas + 4
>    rotas autenticadas)
>  - ✅ 25+ telas refatoradas para tokens do design system
>    (bg-card/bg-page/text-text-{1,2,3}/border-border/semânticos)
>  - ✅ Telas públicas (sign-in, sign-up, /privacy, /terms,
>    /privacy-request, /p/[slug]/contact, /, /onboarding,
>    /onboarding/setup) com layout Venzo dedicado
>
> Critérios em continuação operacional (requerem staging):
>  - 🟡 Lighthouse audit ≥ 90 em /dashboard, /pipeline, /contacts,
>    /admin/billing — script pronto, depende de staging operacional
>  - 🟡 Visual regression baseline capturado — script pronto, depende
>    de app rodando com seed E2E
>
> 🎉 **MVP completo.** 14 sprints (0–14) executados sem débitos abertos.
>
> Próximo: **Sprint 14.5 — Polish Pass** — 9 ajustes de design polish
> identificados em uso após Sprint 14: PipelineBoard com overflow de
> valor + colunas estreitas, border-radius mais generoso, FunnelChart
> em `/reports` com layout e matemática quebrados, polish individual
> de 9 telas internas críticas (refactor mecânico foi feito mas falta
> hierarquia tipográfica e empty states ricos), Popover (não entregue
> no 14), DetailSheet com tabs e bottom sheet mobile, banners
> contextuais completos (past due / offline / maintenance), captura
> do visual baseline (🟡 do 14). Esforço: ~3–4 dias.
>
> Spec completa: `docs/Sprint_14_5_Polish.md`.
>
> Specs:
> - `docs/venzo_ux_spec.docx` (10 capítulos: princípios, tokens,
>   shell/navegação, componentes base, dados, CRM-específicos,
>   feedback, acessibilidade WCAG 2.1 AA, responsividade,
>   checklist)
> - `docs/venzo_ui_preview.html` (protótipo HTML executável com
>   dark/light toggle, 631 linhas — referência visual concreta)
> - `docs/venzo_brand_guide.docx` (paleta, tipografia, voz —
>   continua sendo fonte da verdade)
> - `docs/Sprint_14_UX_Application.md` (plano de execução,
>   refactor map, voice & tone com exemplos antes/depois)
>
> Depois: hardening de produção (Sentry+Axiom wiring real,
> Lighthouse audit, smoke test contra ambiente staging, load test
> com k6). Roadmap futuro: módulo de comissões automáticas,
> integração nativa WhatsApp Business, marketplace de templates
> de proposta, agente autônomo de prospecção.
>
> Histórico Sprint 11: migration `0013_lgpd_security`
> (`data_subject_requests` com SLA 15d ANPD + `policy_acceptances`
> imutável + `connection_logs` WORM Marco Civil), middleware aplica
> security headers globais (HSTS, CSP, X-Frame-Options DENY,
> Permissions-Policy), rate limiter Redis sliding window (5
> login/15min/IP, 10 form público/min, 1000 req/min/tenant),
> cookie banner granular 4 categorias com ConsentLog integration,
> workflows LGPD `collectPersonalData` (export JSON) +
> `anonymizeSubject` (preserva FKs, scrubba activities), endpoint
> público `POST /api/v1/privacy-request` + router tRPC `privacy`,
> UI `/privacy-request` + `/admin/privacy`, Política Privacidade
> + Termos versionados com `PolicyAcceptGate` que força aceite,
> Dependabot 3 ecossistemas (npm/actions/docker) + GH Actions
> security workflow (npm audit, Semgrep p/owasp-top-ten, ZAP
> baseline semanal).

> **Débitos zerados na Sprint 11:**
>  - Sprint 1: middleware grava x-real-ip a partir de
>    x-forwarded-for em paralelo ao webhook Clerk ✅
>  - Sprint 2: E2E `pipeline-7-stages.spec.ts` agora roda via
>    fixture (E2E_TEST_TENANT_ID + E2E_RESET_URL + bypass
>    `/api/e2e/login` ativo só em NODE_ENV=test) ✅
>
> Histórico Sprint 10.5: (tabela `tenant_settings.theme_config` JSONB,
> CSS custom props `--brand-*` injetadas no RootLayout, cache Redis
> TTL 1h com invalidação imediata, UI self-service de paleta + fontes
> Google + logo, validação WCAG AA (contraste ≥ 4.5:1) com sugestão
> automática se reprovar, badge "Powered by Venzo" three-state
> (`visible` Starter / `subtle` Growth / `hidden` Enterprise) com
> enforcement server-side, matriz de permissões por plano, feature
> flag Unleash `tenant_theming_enabled`, audit log com before/after).
>
> Specs:
> - `docs/Arquitetura_e_Plano_Implantacao_CRM.docx` (Sprint 10.5)
> - `docs/CRM_Especificacao_e_Implementacao.docx` (Sprint 10.5)
> - `docs/venzo_brand_guide.docx` (paleta, tipografia Plus Jakarta
>   Sans, componentes, voz/tom — fonte da verdade do design system)
> - `docs/Sprint_10_5_WCAG_Refinements.md` (5 refinamentos da
>   validação WCAG: combinatorial, sugestão dupla, regra texto
>   grande, relatório pós-publicação, override Enterprise com
>   aceite formal — sobrescreve a validação simples descrita nos
>   .docx; +3 dias de esforço)
>
> Depois: **Sprint 11 — Segurança, LGPD e Conformidade** (Cloudflare
> WAF, rate limiting, security headers, cookie banner LGPD, workflows
> de exportação/anonimização, logs imutáveis, OWASP ZAP).

---

## Débitos técnicos com dependência cruzada (registrados para sprints futuros)

_Nenhum débito aberto._ (Sprints 1 e 2 foram fechados na Sprint 11.)

---

### Sprint 14.5 — Polish Pass (concluído)
- [x] **Item 2 (primeiro) — Border-radius bump**: tokens HSL globais
      `--radius-sm: 6` / `--radius: 8` / `--radius-md: 12` / `--radius-lg: 16`
      + `--radius-xl: 20` (novo). Tailwind `borderRadius.xl` exposto
- [x] **Item 1 — Pipeline overflow corrigido**:
  - `src/lib/utils/format.ts` novo com `formatBRL`, `formatBRLCompact`
    (`R$ 288k` / `R$ 1,2M`), `formatPercent`, `formatRelativeDate`
  - `crm/OpportunityCard.tsx` refatorado: header stack vertical
    (título line-clamp-2 + valor em gold tabular-nums); badge de
    estágio movido para o rodapé; tooltip com valor completo via `title`
  - `pipeline/OpportunityCard.tsx` segue mesma estrutura
  - `PipelineKanban.tsx`: colunas com `minWidth: 280, maxWidth: 320,
    scrollSnapAlign: start`; total da coluna em gold/tabular-nums com
    tooltip completo
- [x] **Item 5 — Popover via Radix**:
  - `npm i @radix-ui/react-popover`
  - `src/components/ui/popover.tsx` wrapper com tokens Venzo (bg-card,
    border-border, radius-lg, animações via tailwindcss-animate)
- [x] **Item 6 — Sheet + Tabs + DetailSheet**:
  - `npm i @radix-ui/react-tabs`
  - `src/components/ui/sheet.tsx` (Radix Dialog) variants `right` (400px
    desktop) / `bottom` (85vh mobile com handle visual); sem swipe
  - `src/components/ui/tabs.tsx` (Radix Tabs) com border-bottom
    violet no ativo
  - `app/pipeline/@modal/(.)[id]/page.tsx` refatorado com 4 tabs
    (Visão geral / Atividades / Documentos / Histórico); Overview e
    History implementados, Activities/Documents apontam para a
    página completa
- [x] **Item 3 — FunnelChart refeito**:
  - Grid interno 3 colunas (110px / 1fr / 90px): valor R$ esquerda,
    barra com label central, conversão direita
  - Largura por contagem (não por valor)
  - Sinal correto: `≥100% → +X.X%` em `text-success`;
    `<100% → X.X%` em neutro/text-2 (eliminado o falso `↓114.3%`)
  - Última etapa: gradient `--success`; demais: gradient brand
  - `<dl class="sr-only">` como alternativa textual completa
- [x] **Item 7 — Banners contextuais**:
  - `src/components/ui/banner.tsx` base reutilizável (3 variantes,
    `aria-live="polite"`, dismissible opcional)
  - `PastDueBanner` — não descartável, refetch 60s, link
    `/admin/billing`
  - `OfflineBanner` — listener `online`/`offline` do window,
    SSR-safe, ícone de Wi-Fi cortado, auto-recupera
  - `MaintenanceBanner` — controlado por
    `NEXT_PUBLIC_MAINTENANCE_MESSAGE` (env), descartável via
    sessionStorage com chave incluindo a mensagem (mudar reaparece)
  - `ContextBanners` agregador inserido no `AppShell` abaixo do
    `Topbar`, ordem manutenção > past due > offline
- [x] **Item 4 — PageHeader + polish 8 rotas modelo**:
  - `src/components/layout/PageHeader.tsx` (title + description + meta
    + primaryAction + secondaryAction; layout flex responsivo)
  - Aplicado em: `/companies` (com Table do design system + EmptyState
    + Badge), `/search`, `/approvals`, `/contracts`, `/admin/users`
    (PageHeader + Button), `/admin/products`, `/admin/privacy`,
    `/dashboard` (já feita no Sprint 14)
  - 13 rotas restantes pendentes (mecânico ~3h em sessão dedicada)
- [x] **Item 8 — Lighthouse audit script + workflow**:
  - `scripts/lighthouse-audit.mjs` percorre 4 rotas-chave em
    headless Chromium, aplica thresholds (a11y 90 / perf 85 /
    best-practices 90 / SEO 80) e falha o processo se algum cair
  - `.github/workflows/lighthouse.yml` em `pull_request` com
    `vars.STAGING_URL`, comenta resultados no PR via
    `github.rest.issues.createComment`
  - Standby até staging existir
- [x] **Item 9 — Visual baseline pendente operacional**:
  - `tests/visual/README.md` documentando procedimento (setup env +
    seed + execução + commit + diff em PR)
  - Script `scripts/visual-baseline.ts` do Sprint 14 já existe
  - Captura depende de app local rodando com seed E2E
- [x] Testes: 262/262 unit (+27 do Sprint 14.5: format +13,
      funnel-math +5, banners +9). Type-check zero. Lint zero

### Sprint 14 — Venzo Design System (concluído)
- [x] **P0 — Visual baseline script**: `scripts/visual-baseline.ts`
      (Playwright) percorre 25 rotas × 3 viewports (375/768/1280)
      salvando em `tests/visual/{baseline|current}/`. Execução
      requer app rodando com seed E2E (postergada para CI/staging)
- [x] **P3 — Tokens HSL com canais separados**: cada cor exposta como
      `--brand-primary-h/-s/-l` em `globals.css` permitindo Tailwind
      alpha modifiers (`bg-brand-primary/50`). `hexToHsl()` em
      `src/lib/theme/color.ts` converte HEX → canais para tenant
      theming. `tailwind.config.ts` usa
      `hsl(var(--name-h) var(--name-s) var(--name-l) / <alpha-value>)`
- [x] **P2 — next-themes**: `ThemeProvider` com
      `attribute="data-theme"` + `defaultTheme="dark"` +
      `enableSystem` + `disableTransitionOnChange`.
      `suppressHydrationWarning` no `<html>`. `ThemeToggle` no topbar
      com SSR-safe mount. **FOUC eliminado**
- [x] **P5 — 3 zonas de viewport**: `AppShell` detecta variante via
      matchMedia: `< 768` BottomNav, `768–1023` Sidebar overlay com
      hamburger no topbar, `≥ 1024` Sidebar fixa colapsável. Atalho
      `Cmd+B / Ctrl+B`. Estado persistido em localStorage
- [x] **P1 — Intercepting routes DetailSheet**:
      `app/pipeline/layout.tsx` com slot `{modal}`,
      `app/pipeline/@modal/(.)[id]/page.tsx` renderiza sheet 400px
      sobre o kanban mantendo URL `/pipeline/{id}` (Voltar fecha
      sheet, F5 cai em `/pipeline/[id]/page.tsx` full-page).
      Default em `@modal/default.tsx`
- [x] **AppShell completo**:
  - `Topbar` 56/48px com breadcrumb hierárquico calculado de
    `usePathname`, busca global Cmd+K (placeholder), ThemeToggle,
    botão hamburger em tablet/mobile
  - `Sidebar` com 4 seções (Operação / Documentos / Parceiros /
    Admin), 24+ ícones Tabler-style inline (sem deps externas),
    item ativo destacado com `aria-current="page"` + border-left
    violeta, focus-visible em todos os links
  - `BottomNav` 5 tabs (Início/Pipeline/Inbox/Alertas/Mais) com
    `md:hidden`, safe-area-inset-bottom, touch ≥ 48px
- [x] **Componentes base refeitos** (consumindo tokens HSL):
  - `Button` 5 variants (primary/secondary/ghost/danger/link) ×
    3 tamanhos (sm/md/lg) + accent, loading com spinner inline,
    leftIcon/rightIcon, focus-ring 2px offset 2px, mantém compat
    com variants legados (default/destructive/outline)
  - `Input`, `Textarea`, `Select` em `input.tsx` — 6 estados via
    classes (default/hover/focus/filled/error/disabled),
    `aria-invalid` automático em error, dropdown chevron SVG inline
  - `Field` em `field.tsx` — wrapper a11y que injeta `id`,
    `aria-required`, `aria-describedby` no primeiro child;
    helper text + erro com `role="alert"`
  - `Badge` em `badge.tsx` — 7 variants + `dot` opcional
  - `Avatar` + `AvatarGroup` — 5 tamanhos, foto OU iniciais (violet
    15% bg, violet-light text), online dot ring 2px na cor do card
  - `Checkbox`/`Radio`/`Switch` em `controls.tsx` — focus ring 3px
  - `Tooltip` em `tooltip.tsx` — `role="tooltip"` +
    `aria-describedby`, delay 300ms hover, instant em focus
- [x] **Componentes de dados**:
  - `Table` (THead/TH/TBody/TR/TD) com header 11.5px uppercase
    tracking 0.06em, linha 48px hover bg, border-collapse, overflow
    horizontal scrollable
  - `EmptyState` + `ErrorState` + `SkeletonRow` em `empty-state.tsx`
  - `TableEmpty` + `TableSkeleton` em `table.tsx`
  - Shimmer animation 1.6s no skeleton via globals.css
- [x] **Componentes CRM-específicos**:
  - `OpportunityCard` em `crm/OpportunityCard.tsx` — header com
    nome + badge + valor em gold, contato + próxima atividade no
    corpo, footer com avatar do responsável + dias no estágio.
    `border-left 3px` muda para danger (overdue) / warning (≤48h).
    IA badge opcional com score `ti-sparkles`
  - `ContactCard` em `crm/ContactCard.tsx` — avatar + badge tipo,
    e-mail/telefone/LinkedIn clicáveis com aria-label, banner de
    próxima data importante
  - `ActivityTimeline` em `crm/ActivityTimeline.tsx` — linha
    vertical com dots coloridos por tipo (manual/sistema/email/
    meeting/alert/ai_summary), agrupamento por dia com sticky
    header "Hoje · Ontem · [data]", formatação relativa de tempo
- [x] **Feedback**:
  - `ToastProvider` + `useToast` em `toast.tsx` — 4 tipos com
    `aria-live` polite/assertive, máx 3 visíveis, auto-dismiss
    4-6s (error é manual), animação slide-in-right
  - `Modal` + `ModalFooter` em `modal.tsx` — `role="dialog"` +
    `aria-modal`, **focus trap** Tab/Shift+Tab cicla dentro,
    Escape fecha, foco retorna ao trigger, 3 tamanhos
  - `TrialExpiryBanner` (Sprint 12) e `OnboardingChecklist`
    (Sprint 13) refinados para usar tokens novos
- [x] **Dashboard refinado** — header com saudação Venzo
      ("Bom dia, X."), copy contextual com contagem de compromissos,
      Badge no contador de cada seção, skeleton no loading state,
      `EmptyCard` substitui mensagens robóticas, AlertRow usa
      semânticas (success/warning/danger no dot)
- [x] **Voice & tone pass** — 17 ocorrências de "Nenhum encontrado"
      e variantes substituídas por voz Venzo (orientado a ação:
      "Cadastre o primeiro", "Suba seu primeiro CSV", "Sem
      contratos ativos — os assinados aparecem aqui"). As 4
      restantes (regras de aprovação, IA, fonte popular, propostas)
      já tinham copy Venzo direto e foram preservadas
- [x] **A11y**:
  - `:focus-visible` global em `globals.css` com outline 2px violeta
  - `prefers-reduced-motion` aplicado em todos os elements/transitions
  - Skip link `<a class="skip-link" href="#main-content">` como
    primeiro elemento focável no `<body>`
  - `tests/e2e/axe-smoke.spec.ts` com `@axe-core/playwright` em 5
    rotas públicas + 4 rotas autenticadas (gated por fixture)
- [x] **Testes**: 235/235 unit (+18 Sprint 14: color-hsl +6,
      design-tokens +9, voice-tone +3). Type-check zero. Lint zero
- [x] **Refactor mecânico de 65 arquivos** via perl pass: classes
      Tailwind genéricas → tokens Venzo (`bg-white` → `bg-card`,
      `text-neutral-{900..400}` → `text-text-{1,1,2,3}`,
      `border-neutral-*` → `border-border{-strong}`,
      semânticos `text-red/rose/emerald/amber/blue-*` →
      `text-danger/success/warning/info{-text}` e equivalentes em
      bg/border). Único `bg-white` restante é o thumb do Switch
      (intencional). Zero classes Tailwind genéricas em src/app
- [x] **Polish individual das telas públicas**:
  - `/sign-in` + `/sign-up`: layout centrado com logo VENZO + tagline
  - `/privacy` + `/terms`: tipografia editorial (max-width 720px,
    leading 1.6, escala Venzo h1/h2/body-lg, links violet-light)
  - `/privacy-request`: form com Field/Input/Select/Textarea/Button
    do design system, copy Venzo ("Recebemos seu pedido. Conforme
    a LGPD, respondemos em até 15 dias.")
  - `/`: landing nova com display hero "Feche mais. Vença sempre.",
    CTAs Entrar/Criar conta com `bg-brand-primary`, instruções
    dev no card secundário
  - `/onboarding`: layout centralizado com Field/Input/Button,
    saudação Venzo ("Bem-vindo, {nome}.") + redirect pós-criação
    para `/onboarding/setup`
  - `/onboarding/setup`: tipografia Venzo + copy Venzo + link
    underline violet-light pro dashboard
  - `/p/[slug]/contact`: form público polido com cabeçalho "Fale
    com a gente" e confirmação "Recebemos!" em vez de "Obrigado"
- [ ] **Lighthouse audit ≥ 90** em /dashboard, /pipeline, /contacts,
      /admin/billing — pendente de staging operacional
- [ ] **Visual regression baseline capturado** — pendente de app
      rodando

### Sprint 13 — UI Hardening + Onboarding Guiado (concluído)
- [x] Migration `0015_tenant_setup_state` — `Tenant.setupCompletedAt` +
      `Tenant.tourDismissedAt`
- [x] **Hardening segurança**: `users.updateRole` + `users.invite` agora
      têm guard `assertCanAssignSuperAdmin` — apenas SUPER_ADMIN pode
      atribuir/alterar role SUPER_ADMIN. ADMIN tentando promover ou
      rebaixar SUPER_ADMIN recebe FORBIDDEN. UI espelha desabilitando
      a opção no dropdown
- [x] `onboarding-progress.service.ts` — `computeChecklist(tenantId)`
      retorna 9 steps com heurísticas em tempo real (counts de users/
      companies/products/approval_rules/territories/segments + booleans
      de aiApiKey/inboundSlug/themeConfig); `dismissTour` +
      `markSetupCompleteIfDone`
- [x] Router `onboarding` estendido com `progress` (query),
      `dismissTour` (mutation), `markCompleteIfDone` (mutation)
- [x] `Sidebar.tsx` desktop fixa (>= md) — 2 seções (Operação 10 itens /
      Administração 13 itens), colapsável com persistência em
      localStorage, atalho `Cmd+B`/`Ctrl+B`, item ativo destacado com
      `aria-current="page"`, item colapsado vira ícone com tooltip
- [x] `SidebarSpacer` reserva largura para o main content (60 expandido,
      14 colapsado) reagindo a evento de storage
- [x] `AppShell` envolve children + Sidebar + BottomNav
      (BottomNav agora restrito a `md:hidden` pelo seu próprio CSS;
      hidden nas rotas auth/legal)
- [x] `RootLayout` — `BottomNav` standalone substituído por `AppShell`
- [x] WCAG explícito em todos os novos componentes:
      - botão de colapsar tem `aria-expanded` + `aria-label` +
        `focus-visible:ring-2 focus-visible:ring-brand`
      - todos os forms usam pattern `<Field label htmlFor>` com `aria-required`
        inferido automaticamente
      - tabelas com `<caption>` e `scope="col"` em todas as headers
      - progress bar usa `role="progressbar"` com `aria-valuenow/min/max`
      - lista de steps com `role="list"` e ícones com `aria-label`
- [x] `/contacts` standalone — lista com filtros (busca, área, tipo de
      relacionamento), form unificado create/update, soft delete,
      vinculação opcional a empresa
- [x] `/admin/products` CRUD completo — name, type (5 opções),
      sku, minMarginPct (0-100), active flag, soft delete
- [x] `/admin/users` CRUD — tabela com lastLoginAt, dropdown role com
      7 opções (SUPER_ADMIN só visível para SUPER_ADMIN), modal de
      convite com role default ANALISTA, botão desativar com confirm
- [x] `OnboardingChecklist` componente — 2 variantes: `compact`
      (card no /dashboard, dispensável) e `full` (página completa).
      Esconde quando `setupCompletedAt` ou `tourDismissedAt` setados
- [x] `/onboarding/setup` — página dedicada com checklist `full`
      mostrada após `createFirstTenant`; auto-tenta marcar como
      completo ao montar
- [x] `/more` mantém lista funcional para mobile + aviso visual em
      desktop apontando para a sidebar (sem redirect server-side, deep
      links continuam funcionando)
- [x] Testes: 217/217 unit (+10 Sprint 13: onboarding-progress shape +5,
      users-role-guard SUPER_ADMIN +5). Type-check zero. Lint zero

### Sprint 12 — Billing e Self-service (concluído)
- [x] Migration `0014_billing` — Tenant ganha stripeCustomerId/
      stripeSubscriptionId/subscriptionStatus/currentPeriodEnd/
      trialEndsAt + tabela `billing_events` IMUTÁVEL (RLS sem
      UPDATE/DELETE, idempotência via stripe_event_id UNIQUE) +
      tabela `usage_snapshots` com RLS padrão + backfill
      trial_ends_at = created_at + 14d nos tenants TRIAL
- [x] 2 enums: `BillingEventType` (7 tipos), `SubscriptionStatus`
      (TRIALING/ACTIVE/PAST_DUE/CANCELED/INCOMPLETE)
- [x] `stripe-client.ts` — Stripe SDK singleton + `priceIdForPlan` +
      `planFromPriceId` (mapeia STRIPE_PRICE_STARTER/PRO/ENTERPRISE)
- [x] `billing-checkout.service.ts` — `ensureCustomer` (cria/recupera
      Stripe Customer com metadata.tenantId) + `startCheckoutSession`
      (subscription mode + promotion codes + success/cancel URLs) +
      `openCustomerPortal` (URL do Billing Portal)
- [x] `billing-webhook.service.ts` — processa 7 tipos de evento Stripe
      (checkout.session.completed, customer.subscription.*,
      invoice.paid/payment_failed, trial_will_end); idempotente via
      lookup BillingEvent.stripeEventId; `applySubscription`
      atualiza Tenant.plan + status + currentPeriodEnd
- [x] Endpoint `POST /api/stripe/webhook` valida assinatura via
      `Stripe.webhooks.constructEvent` + chama processStripeEvent;
      retorna 503 se Stripe não configurado, 400 sem assinatura,
      500 em erro recuperável (Stripe reenvia)
- [x] `plan-limits.ts` — PLAN_LIMITS por tenant (maxUsers/companies/
      contacts/storageBytes/aiTokensMonth + 6 features booleans);
      Enterprise tem Infinity; hidePoweredBy/overrideWcag só Enterprise
- [x] `usage.service.ts` — `collectCurrentUsage` agrega counts +
      storage (sum sizeBytes de documentVersions) + tokens IA do mês +
      cost convertido para centavos; `takeSnapshot` grava em
      usage_snapshots
- [x] `storage-s3.service.ts` — wrapper @aws-sdk/client-s3 +
      s3-request-presigner; uploadObject + presignDownload (24h);
      retorna null se S3 não configurado (fallback gracioso)
- [x] Privacy workflow agora envia ACCESS/PORTABILITY para S3 com
      key `privacy-exports/<tenantId>/<requestId>.json`; fallback
      inline:base64 mantido. `exportPayload` retorna `{kind:'s3',url}`
      com presigned 24h OU `{kind:'inline',preview}`
- [x] Router tRPC `billing` — status (plano + Stripe status),
      startCheckout (URL de redirect), openPortal, currentUsage
      (com checks vs limites), history (últimos 50 eventos)
- [x] UI `/admin/billing` — card plano atual com status + período +
      trial; 3 cards de planos com features e botão Mudar;
      seção Uso atual com 5 barras (users/companies/contacts/storage/
      tokens) coloridas (verde <80%, âmbar 80–100%, vermelho excedido);
      histórico de eventos
- [x] `TrialExpiryBanner` global no layout — amarelo se trial termina
      em ≤7 dias, vermelho se já expirou ou subscription past_due
- [x] env: `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`,
      `STRIPE_PRICE_ENTERPRISE` (todos optional)
- [x] Testes: 207/207 unit (+11 Sprint 12: plan-limits +7,
      stripe-client +4)

### Sprint 11 — Segurança, LGPD e Conformidade (concluído)
- [x] Migration `0013_lgpd_security` — `data_subject_requests` (SLA 15d
      ANPD via dueAt auto-calculado, status PENDING/IN_PROGRESS/
      COMPLETED/REJECTED, processed_by_id, export_file_key), tabela
      `policy_acceptances` IMUTÁVEL (RLS sem policies UPDATE/DELETE),
      tabela `connection_logs` WORM (Marco Civil Art. 15, INSERT/SELECT
      apenas) + 3 enums + RLS padrão para data_subject_requests
- [x] Middleware Next — aplica `SECURITY_HEADERS` em todas as respostas
      (HSTS prod, CSP com frame-ancestors none + object-src none,
      X-Frame-Options DENY, Permissions-Policy camera/mic/geo desligados,
      X-Content-Type-Options nosniff, Referrer-Policy strict-origin)
- [x] **Fechado débito Sprint 1**: middleware propaga `x-real-ip`
      derivado de `x-forwarded-for` em paralelo ao webhook Clerk
- [x] `rate-limiter.service.ts` — sliding window via Redis INCR+EXPIRE,
      fallback open quando Redis indisponível, helpers LOGIN_LIMIT
      (5/15min), PUBLIC_FORM_LIMIT (10/min), API_LIMIT_PER_TENANT (1000/min)
- [x] `CookieBanner` LGPD granular — 4 categorias com STRICTLY_NECESSARY
      sempre on, persiste em localStorage E grava `ConsentLog` no
      backend via `POST /api/v1/consent` (com IP + tenant_id se autenticado)
- [x] `privacy-workflow.service.ts` — `collectPersonalData` agrega
      users/contacts/activities/audit/consent + nota sobre Marco Civil;
      `anonymizeSubject` substitui PII por anon-{base36} preservando
      FKs, scrubba rawText de activities, marca deleted_at em users
      e contacts; logs de conexão preservados
- [x] Endpoint público `POST /api/v1/privacy-request` (com rate limit
      PUBLIC_FORM_LIMIT) + endpoint público `POST /api/v1/consent`
- [x] Router tRPC `privacy` — submitRequest (public), listPending/listAll
      (admin), process (gera export ou anonimiza), reject, exportPayload,
      acceptPolicy, myAcceptedVersions
- [x] UI `/privacy-request` (público, sem auth) + `/admin/privacy` (fila
      com badges de status, indicador ATRASADO em vermelho se dueAt
      vencido, botões Processar e Rejeitar com justificativa)
- [x] `/privacy` + `/terms` páginas estáticas versionadas via
      `POLICY_VERSIONS` + `PolicyAcceptGate` modal forçando aceite
      quando versão atual não consta em `policy_acceptances`
- [x] `.github/dependabot.yml` — npm semanal (grupos prod/dev), GH
      Actions semanal, Docker mensal
- [x] `.github/workflows/security.yml` — npm audit (rompe build em
      vulnerabilidade ≥ high), Semgrep (p/owasp-top-ten + p/typescript
      + p/nextjs com SARIF upload), ZAP baseline scan semanal contra
      STAGING_URL
- [x] **Fechado débito Sprint 2**: fixture E2E em
      `tests/e2e/fixtures/auth.ts` (loginAsAdmin + resetDatabase) +
      bypass `POST /api/e2e/login` ativo APENAS em NODE_ENV=test;
      pipeline-7-stages.spec.ts não mais `test.skip`, agora skip
      condicional na ausência de env vars E2E_TEST_TENANT_ID
- [x] Testes: 196/196 unit (+11 Sprint 11: security-headers +4,
      rate-limiter +4, anonymizer +3). Lint zero. Type-check zero

### Sprint 0 — Foundation (concluído)
- [x] Next.js 14 + TS strict + Tailwind + shadcn/ui
- [x] Schema Prisma 25+ entidades + pgvector + migrations init/RLS/vector
- [x] Prisma extension de tenant + AsyncLocalStorage
- [x] Middleware Clerk + tRPC base + DataMaskingService + RBAC + AuditLog
- [x] Docker, GitHub Actions CI, seed (3 tenants), .env.example

### Sprint 10.5 — White-Label Theming e Identidade Venzo (concluído)
- [x] Migration `0012_tenant_settings_theming` — tabela `tenant_settings`
      1:1 com tenants (theme_config JSONB, powered_by enum, wcag_overrides
      JSONB, theming_enabled bool, RLS) + backfill com defaults Venzo
      (#7C3AED/#3B1F6A/#C084FC/#F5A623/Plus Jakarta Sans) + powered_by
      por plano
- [x] Enum `PoweredByMode` (VISIBLE/SUBTLE/HIDDEN)
- [x] `src/lib/theme/types.ts` — VENZO_DEFAULTS, themeConfigSchema (Zod),
      mapping TenantPlan→VenzoPlan, helpers de capacidade por plano
      (canHidePoweredBy, canUseFreeformHex, canOverrideWcag etc)
- [x] `src/lib/theme/curated-palettes.ts` — 8 paletas Growth harmônicas
      com Venzo
- [x] `src/lib/theme/curated-fonts.ts` — 6 fontes Google (Plus Jakarta
      Sans, Inter, Manrope, DM Sans, Outfit, Public Sans) + googleFontsUrl()
- [x] `wcag-validator.service.ts` — computeContrast (algoritmo WCAG
      relativo de luminância) + TEXT_CONTEXTS (9 contextos com 3 ou 4.5
      conforme tamanho/peso) + validateThemeCombinations combinatorial
      em 8 pontos de uso real (botões, badges, hover, accent)
- [x] `contrast-suggester.service.ts` — sugestão dupla via HSL iteration
      (passos 5%, max 8 cada direção) retornando { darker, lighter,
      unsupported }
- [x] `theme.service.ts` — getThemeConfig (cache Redis 1h TTL),
      updateThemeConfig (enforce plano, WCAG combinatorial, override
      Enterprise com justification ≥30 + DPO, invalida cache, audit
      log com wcag_level)
- [x] `src/lib/feature-flags.ts` — stub Unleash com flag
      `tenant_theming_enabled` default true; substituível em Sprint 12
- [x] Router tRPC `theme`: get, validate, suggestContrastFix,
      listCuratedPalettes, listCuratedFonts, update,
      publishWithOverride (Enterprise), auditHistory, planInfo
- [x] `src/lib/theme/server.ts` — resolveTenantTheme via headers (lê
      x-tenant-id do middleware) + buildBrandStyle injetando 5 vars
      CSS no `<html style>` do RootLayout
- [x] `globals.css` — utilities `.bg-brand`, `.text-brand`, `.border-brand`,
      `.hover:bg-brand-dark`, `.bg-brand-accent` consumindo as vars
- [x] Refactor: botões CTA `bg-neutral-900` → `bg-brand` em pipeline/*,
      imports, e demais CTAs
- [x] `<PoweredByBadge>` three-state (visible 14px centro / subtle 9px
      canto / hidden null) usando `var(--brand-primary)`
- [x] UI `/admin/branding` — tabs Paleta/Tipografia/Logo/Histórico,
      color pickers (Enterprise) ou dropdown (Growth), painel WCAG
      lateral com semáforo, panel sugestão dupla, banner amarelo se
      overrides ativos, modal override com checkbox DPO + textarea ≥30
- [x] Plan enforcement server-side: Starter 403, Growth 422 fora da
      lista, Enterprise hex livre + override permitido. Powered by
      HIDDEN só Enterprise (validado no backend)
- [x] env: UNLEASH_URL, UNLEASH_API_TOKEN, NEXT_PUBLIC_VAPID_*,
      INBOUND_WEBHOOK_SECRET (todos optional)
- [x] Testes: 185/185 unit (wcag-validator +8, contrast-suggester +5,
      theme-plan-matrix +13). Cobertura: pass/fail por contexto,
      sugestão dupla, plano matrix, curadoria

### Sprint 10 — PWA, Mobile e Performance (concluído)
- [x] Migration `0011_push_subscriptions` — tabela com endpoint UNIQUE,
      p256dh + auth keys, userAgent + lastSeenAt; RLS
- [x] `@serwist/next` + `serwist` configurados em `next.config.mjs` com
      `swSrc=src/app/sw.ts` → `swDest=public/sw.js`
- [x] Service worker (`src/app/sw.ts`) com precaching + defaultCache
      (runtime stale-while-revalidate) + handlers `push` e
      `notificationclick` (foca tab existente ou abre)
- [x] `public/manifest.json` — standalone, theme-color #0a0a0a, ícones
      192/512/SVG, shortcuts Pipeline e Dashboard
- [x] `src/app/icon.tsx` + `apple-icon.tsx` — geração via ImageResponse
      (Next 14 metadata route, gera PNG no edge)
- [x] `layout.tsx` — metadata completo (applicationName, manifest,
      appleWebApp, formatDetection.telephone=false) + viewport
      (themeColor, maximumScale, viewportFit=cover)
- [x] `BottomNav` componente fixed bottom, 5 ítens (Pipeline, Inbox,
      Search, Dashboard, Mais), visível só em < 768px, touch ≥ 48px,
      respeita safe-area-inset, esconde nas rotas /sign-in /onboarding /p/
- [x] Página `/more` com índice de todas as outras rotas (substitui
      menu lateral em mobile)
- [x] `push-sender.service.ts` — wrapper web-push com VAPID, marca
      subscription como deleted em 404/410, helpers `sendPushToUser` e
      `sendPushForAlertRecipient`
- [x] Router `push` (config + subscribe + unsubscribe + mySubscriptions)
- [x] `EnablePushButton` no `/dashboard` — pede permissão, subscribe
      no PushManager, salva no servidor; esconde se não suportado ou
      VAPID não configurado
- [x] Worker `email-send` envia push em paralelo ao e-mail (best-effort,
      não falha o e-mail se push falhar)
- [x] env: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
      `VAPID_SUBJECT` (todos opcionais — sem VAPID, push fica desabilitado)
- [x] Testes: 148/148 unit (manifest +4, push-subscription +5)
- [ ] Lighthouse audit — pendente porque requer app rodando contra
      Postgres/Clerk reais; rodar `npx lighthouse http://localhost:3000`
      depois do setup paralelo concluir

### Sprint 9 — Importação de Dados (concluído)
- [x] Migration `0010_import_jobs` — tabela `import_jobs` (bytea de até
      10MB, mapping/preview/result JSON, status PENDING/PARSING/MAPPED/
      RUNNING/DONE/FAILED, strategy IGNORE/UPDATE/CREATE) + 3 enums + RLS
- [x] `parser.ts` — unifica CSV (papaparse) e XLSX (exceljs), com modo
      previewOnly (10 linhas) ou completo; detecta extensão `.csv/.tsv/.xlsx/.xls`
- [x] `import-engine.service.ts` — engines `importCompanies` e
      `importContacts` com validação por linha (CNPJ/email Zod), dedup
      por CNPJ ou email, política IGNORE/UPDATE/CREATE; estrutura
      preparada pra `OPPORTUNITY` e `USER` (TODO sprint posterior)
- [x] Resolução automática de empresa em contatos via `companyCnpj` ou
      `companyRazaoSocial` (case-insensitive)
- [x] Endpoint `POST /api/v1/imports/upload` (multipart, máx 10MB) gera
      preview inline e persiste bytes
- [x] Router tRPC `imports` (fields/list/byId/confirm/cancel) — `confirm`
      enfileira no worker BullMQ
- [x] Worker `import-run` integrado ao `npm run worker` — re-parseia
      arquivo, executa engine, atualiza `processedRows` a cada 50 linhas,
      grava `resultJson`, envia e-mail de conclusão ao criador
- [x] UI `/imports` — wizard 3 passos (upload → mapping com dropdowns +
      preview 10 linhas → confirmar com estratégia de dedup) + histórico
      com auto-refresh 3s e badges de status
- [x] `IMPORT_FIELDS` mapping para COMPANY (10 campos) e CONTACT (6 campos)
- [x] Testes: 139/139 unit (import-parser +5: CSV/TSV/preview/extensão inválida)

### Sprint 8 — Propostas, Aprovações e Contratos (concluído)
- [x] Migration `0009_contract_handoff_renewal`: `Tenant.handoffEmails`
      String[] + `Tenant.contractRenewalLeadDays` Int[] (default 90/60/30)
- [x] **Débito Sprint 2 fechado**: `PROPOSTA → NEGOCIACAO` exige ≥ 1
      `ProposalVersion`; `NEGOCIACAO → ACEITE` exige zero approvals em
      PENDING/REJECTED/CHANGES_REQUESTED da última versão
- [x] `approval-engine.service.ts` — função pura `selectApplicableRules`
      (UNIVERSAL / MIN_MARGIN_BELOW / TOTAL_VALUE_ABOVE) +
      `createApprovalsForProposalVersion` (idempotente, busca aprovador
      por role) + `getApprovalState`
- [x] Router `proposals` (listByOpportunity, create, addVersion com
      trigger automático do engine, compareVersions com diff metadata
      + IA Haiku, approvalState) + `approvals` (myPending, decide)
- [x] `contract-handoff.service.ts` — ao Contract.status virar ACTIVE,
      envia e-mail a `handoffEmails` + `centralCrmEmail` com CNPJ +
      parcelas + valores; idempotente via Activity SYSTEM_EVENT
- [x] `contract-renewal-alerts.service.ts` — integrado ao worker
      `alerts-scan`; gera AlertLog PIPELINE_DATE para contratos com
      endDate em `tenant.contractRenewalLeadDays`
- [x] `contract-renewal.service.ts` — `renewContract` cria nova
      Opportunity em PROSPECT pré-preenchida + marca contrato como RENEWED
- [x] Router `approvalRules` (CRUD admin) + `contractsConfig`
      (getConfig/updateConfig/renew/dispatchHandoff/activeContracts)
- [x] Handoff disparado automaticamente em `contracts.update` quando
      status muda para ACTIVE
- [x] UI `ProposalsSection` na `/pipeline/[id]` — criar proposta + adicionar
      versão com totalValue/marginPct + badges de status de aprovação
- [x] UI `/approvals` — fila do aprovador logado com botões Aprovar /
      Solicitar mudanças / Reprovar + comentário
- [x] UI `/contracts` — contratos ativos com Renovar + Reenviar handoff
- [x] UI `/admin/approval-rules` — CRUD de regras com critério + threshold
      + checkboxes de aprovadores
- [x] UI `/admin/contracts` — handoffEmails (chips) + renewalLeadDays
- [x] Testes: 134/134 unit (approval-engine +8: universal, margin-below,
      value-above, disabled, múltiplas regras simultâneas)

### Sprint 7 — Parceiros e Documentos (concluído)
- [x] Migration `0008_partners_documents`: `User.partnerCompanyId` (FK SET
      NULL), enum `DocumentCategory`, `Document.category`, tabela
      `document_templates` com RLS
- [x] **Débito Sprint 2 resolvido**: visibilidade real do perfil PARCEIRO
      em `opportunities` e `reports` (PARCEIRO vê apenas oportunidades onde
      `partnerCompanyId = User.partnerCompanyId` E existe `PartnerEngagement`
      com status APPROVED). Context tRPC agora carrega `partnerCompanyId`
- [x] **Débito Sprint 2 resolvido**: validação ACEITE → CONTRATO exige
      Document `category=ACEITE_CLIENTE` vinculado à oportunidade
- [x] Router `partners`: listWithStats (oportunidades + comissão acumulada),
      getTcText, updatePartnerConfig (commission, T&C text/versão),
      linkUserToPartner, registerTcAcceptance, publicTcView/publicTcAccept
      via token de `partner_links` (sem auth)
- [x] Router `documents`: listByOpportunity, create (+v1), addVersion
      (dedup por SHA-256), compare (mock IA)
- [x] Router `templates`: list/create/uploadVersion/setActive por categoria
- [x] `document-compare.service.ts` — Haiku gera JSON estruturado
      (scopeChanges, valueChange, marginChange, items+/-, termChanges) com
      DataMasking + circuit breaker + fallback metadata
- [x] UI `/admin/partners` — lista com stats + form de config inline
      (commission, T&C, ativo) + usuários parceiros vinculados
- [x] UI `/admin/templates` — biblioteca agrupada por categoria + form
      de adicionar
- [x] UI `/p/tc/[token]` — aceite público de T&C com token de partnerLink;
      registra IP+UA em `partner_tc_acceptances`
- [x] UI `DocumentsSection` no `/pipeline/[id]` — upload (URL),
      versionamento visual, link p/ abrir cada versão
- [x] Sprint 7 NÃO implementa upload binário (S3); usa `storageKey` como
      URL externa. Sprint 11 endurece com presigned URLs
- [x] Testes: 126/126 unit (document-compare +3: emptyResult, circuit
      breaker open/close)

### Sprint 6 — Comunicações, Busca e E-mail (concluído)
- [x] Migration `0007_inbound_email_search` — `Tenant.inboundEmailSlug`
      (citext unique), tabela `incoming_emails` (raw payload + status
      PENDING/LINKED/REJECTED + dados de vínculo), índices GIN tsvector
      PT-BR em `activities` e `incoming_emails` para fallback de busca
- [x] `inbound-email.service.ts` — ingestão de payload com normalizadores
      `fromPostmark` e `fromResend`, extração de slug por
      `extractSlugFromAddresses`
- [x] Endpoint `POST /api/v1/inbound/email` aceita Postmark/Resend/
      genérico com proteção via `?secret=` (INBOUND_WEBHOOK_SECRET)
- [x] `email-link.service.ts` — 3 heurísticas em ordem:
      `#<oppId>` no subject (conf 1.0) > match por contato (conf 0.85 se
      unique, senão sugestões) > Claude Haiku rank das top oportunidades
      ativas. Cria Activity tipo EMAIL automática quando conf ≥ 0.8
- [x] `embeddings.service.ts` — opcional via OpenAI text-embedding-3-small;
      grava em `embeddings` (pgvector) com dedup por contentHash SHA-256
- [x] `semantic-search.service.ts` — pipeline candidate retrieval →
      hydrate → rerank Haiku. Cai para tsvector PT-BR sem OPENAI_API_KEY
- [x] Routers tRPC: `inbox` (list/byId/retryAutoLink/linkManually/reject),
      `search` (natural com rerank opcional), `adminEmail` (getSlug/setSlug/
      regenerateSlug)
- [x] UI `/inbox` — lista expansível com sugestões + vincular manual +
      rejeitar + retry IA
- [x] UI `/search` — busca natural com indicador de modo (vector/tsvector)
      e reranqueamento + exemplos
- [x] UI `/admin/email-inbound` — endereço completo + copiar + regenerar
      + instruções de uso (#ID no subject)
- [x] env: `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL`,
      `INBOUND_WEBHOOK_SECRET` (todos optional)
- [x] Testes: 123/123 unit (inbound-email +9: slug parser, #ID parser,
      normalizadores Postmark/Resend)

### Sprint 5 — Relatórios, Analytics e Equipe (concluído)
- [x] Migration `0006_conversion_rates` — `Tenant.conversionRates JSONB`
      com defaults B2B (5/15/30/50/70/85/100)
- [x] `analytics.service.ts` — funções puras: `computeFunnel`,
      `avgDaysPerStage`, `winLossBreakdown`, `performanceByOwner`,
      `projectRevenue` (cenários base/best/worst)
- [x] `conversion-rate-suggestion.service.ts` — sugere taxas via
      histórico próprio (≥30 fechadas) OU IA com contexto de segmento/
      território (Claude Haiku com masking). Retorna source/rationale/rates
- [x] Router tRPC `reports`: funnel, winLoss, timePerStage,
      performanceByOwner (ANALISTA vê apenas própria linha + média
      anônima), revenueProjection, conversionRates (get/update),
      suggestConversionRates. Filtros dinâmicos: from/to/ownerId/stage/
      segmentId/territoryId. Visibilidade por perfil aplicada
- [x] `excel-export.service.ts` + endpoint `GET /api/v1/reports/export`
      gera xlsx com abas Resumo/Funil/Performance/Projeção via exceljs
- [x] UI `/reports` — filtros + funil SVG inline (sem libs) + stats
      (projeção base/best/worst, win rate, valor ganho) + tabela
      performance + motivos de perda + projeção por estágio + botão
      Exportar Excel
- [x] UI `/admin/conversion-rates` — edição inline + botão "Sugerir
      com IA" com modal de preview (atual vs sugerida) + aceitar/descartar
- [x] Testes: 114/114 unit (analytics +9, incluindo funil, win rate,
      projeção com cap 100%, performance, avgDaysPerStage)

### Sprint 4 — Atividades, Tarefas e IA (concluído)
- [x] `DataMaskingService` estendido: PESSOA (nomes PT-BR com conectores),
      EMPRESA (sufixo societário Ltda/S/A/EIRELI/Inc), VALOR (R$ N | N
      milhões de reais), ENDERECO (logradouro + número), além de EMAIL/
      PHONE/CPF/CNPJ. Inclui blacklist de falsos positivos comuns
      (São Paulo, Brasil, CNPJ, etc.) e método `audit()` para métricas
- [x] `CircuitBreaker` reusável em `src/server/services/ai-circuit-breaker.ts`
- [x] `summarizeCommunication`: mascara → Claude Haiku → parse JSON → desmascara
      → loga `ai_usage_log` com tokens + custo. Fallback gracioso se IA falhar
- [x] `ai-usage.service.ts` com `AI_PRICING` table (Anthropic, OpenAI),
      `calculateCost`, `logAiUsage`, `getMonthlyUsage`
- [x] Routers tRPC: `activities` (list, create, summarize, confirmSummary),
      `tasks` (list, myOpen, create, updateStatus), `aiConfig`
      (getConfig, updateConfig com encryption, monthlyUsage, pricingTable)
- [x] Encriptação AES-256-GCM para `tenant.ai_api_key_encrypted` em
      `src/lib/crypto/field-encryption.ts` (encryptField/decryptField/maskApiKey)
- [x] Worker scan diário agora também roda `scanTaskEscalations` — cobrança
      no vencimento (TASK_DUE) + escalonamento após `tenant.taskOverdueDays`
      (TASK_OVERDUE) para GESTOR/DIRETOR_COMERCIAL
- [x] Template de e-mail `renderTaskAlert` com badge [Escalonamento]
- [x] UI `CommunicationIntake` no `/pipeline/[id]`: textarea → resumir →
      preview com 4 blocos editáveis + checkboxes de tarefas sugeridas
- [x] Seções "Tarefas" e "Linha do tempo" no `/pipeline/[id]`
- [x] Tela `/admin/ai` para configurar provider/modelo/API key + medidor
      de consumo mensal com breakdown por modelo
- [x] Testes: 103/103 unit (masking PII +9, summary-parser +4, field-encryption +4)

### Sprint 3 — Sistema de Alertas (concluído)
- [x] `alert-generator.service.ts` — gera alertas devidos para HOJE por
      tenant; suporta datas recorrentes (ano sentinela 0001) e únicas;
      antecedência via `tenant.alertLeadDays`; resolve destinatário
      (owner da última opp da company; fallback ADMIN)
- [x] `email-sender.service.ts` — wrapper Resend com circuit breaker
      (3 falhas em 60s → aberto por 5min); dry-run quando RESEND_API_KEY
      ausente
- [x] Templates de e-mail em `src/lib/email/templates.ts`
      (relationship + pipeline)
- [x] BullMQ: `src/jobs/queues.ts`, workers `alerts-scan` e `email-send`,
      entry point `src/jobs/index.ts` com job recorrente diário 07:00 BRT
- [x] Router tRPC `alerts`: myAlerts (com window de N dias), tenantConfig,
      updateConfig (admin), dismiss
- [x] `/dashboard` com Central de Alertas (Relacionamento + Pipeline) com
      indicador de urgência + ações Abrir/Dispensar
- [x] `/admin/alerts` com edição de `alertLeadDays`, `centralCrmEmail`,
      `taskOverdueDays`
- [x] Worker no docker-compose (serviço `worker`) + script `npm run worker`
      + `npm run worker:scan-now` para disparar scan manual
- [x] Testes: 85/85 unit (alert-generator +10, email-templates +3)

### Sprint 2 — Pipeline Comercial (concluído)
- [x] Migration `0005_opportunity_stage_fields` — campos por estágio
      (meetingScheduledAt/Happened, briefing, proposalPresentedAt,
      decisionExpectedAt, estimatedTeamNotes, acceptedAt,
      acceptanceNotificationSentAt, handoffReportGeneratedAt,
      currentStageEnteredAt)
- [x] Service `opportunity-stage.service.ts` com `STAGE_EXIT_REQUIREMENTS`,
      `validateStageExit`, `isValidTransition` (avança 1 ou retrocede livre),
      `advanceStage` (transação + histórico + audit), `cancelOpportunity`
- [x] Routers tRPC: `opportunities` (com kanban, byId, advance, cancel, team),
      `partnerEngagements` (request → decide aprovar/rejeitar, revoke),
      `contracts` + `contracts.installments`
- [x] Visibilidade por perfil aplicada em queries (ANALISTA só vê próprias +
      onde é team member; DIRETOR/GESTOR vê tudo)
- [x] UI desktop Kanban com @dnd-kit (drag-and-drop entre colunas, validação
      no servidor dispara modal "Não foi possível avançar")
- [x] UI mobile com tabs horizontais por estágio + botão Avançar →
- [x] Cards mostram avatar + nome do responsável (não só iniciais)
- [x] Indicador de urgência baseado em `expectedCloseDate` (verde >7d, amarelo
      2-7d, vermelho <2d) ou em dias no estágio quando não há data prevista
- [x] Página `/pipeline/[id]` com header, ações (avançar/voltar/cancelar),
      formulário inline dos campos do estágio atual, histórico
- [x] Modal de cancelamento com motivo + lossReason (soft delete via status)
- [x] Testes: 72/72 unit (validators 39, rbac 9, masking 5, tenant-context 3,
      company-validator 6, stage-transition 10)
- [x] E2E spec `pipeline-7-stages.spec.ts` (skipped até CI ter banco seeded
      + auth fixture)

### Sprint 1 — Auth + Cadastros (concluído)
- [x] Migration `0004_sprint1_additions` com refinos (WorkArea, DIRETOR_*, CNAE,
      commissionPct, Contact.workArea/relationshipType/function, Product.type novo,
      Opportunity.contactId/source/lossReason, ContractStatus.RENEWED, ApprovalRule,
      ConsentLog)
- [x] Validators Zod compartilhados (`src/lib/validators/`): CNPJ, CPF, email,
      telefone BR, datas PT-BR
- [x] Webhook Clerk com verificação svix (`/api/clerk/webhook`):
      user.created/updated/deleted + session.created → access log
- [x] Onboarding Super Admin (`/onboarding`): cria Tenant + Company OWN + ADMIN
- [x] CRUDs tRPC: territories, segments, companies, contacts (com auto-cadastro
      público em `/p/[tenantSlug]/contact`), products, users (com convite Clerk)
- [x] Páginas mínimas: `/companies`, `/onboarding`, `/p/[slug]/contact`
- [x] Middlewares tRPC `withRoles` + `withCapability` + `adminOnlyProcedure`
- [x] `audit()` chamada nos pontos sensíveis dos CRUDs
- [x] User access log via webhook session.created
- [x] Testes: 62/62 passando (rbac, masking, tenant-context, validators, company);
      integração de isolamento gated por `DATABASE_URL_TEST` (skip local)
- [x] E2E smoke (Playwright): home, health endpoint, /p/.../contact form

---

## Configuração necessária para rodar (pós-Sprint 1)

1. **Clerk** — criar aplicação em https://dashboard.clerk.com com:
   - OAuth providers: Google, Microsoft
   - Email + Magic Link, TOTP 2FA habilitados
   - **JWT Template** com nome `default`, claim:
     ```json
     {
       "public": {
         "tenantId": "{{user.public_metadata.tenantId}}",
         "role": "{{user.public_metadata.role}}"
       }
     }
     ```
   - **Webhook** apontando para `https://seu-dominio/api/clerk/webhook` com
     events: `user.created`, `user.updated`, `user.deleted`, `session.created`.
     Copiar Signing Secret para `CLERK_WEBHOOK_SECRET`.

2. **Postgres** com extensões `vector`, `pgcrypto`, `citext` (já no
   `pgvector/pgvector:pg16` do docker-compose).

3. **Variáveis** preencher em `.env.local` (ver `.env.example`).

---

## Stack (não negociável)

| Camada | Tecnologia |
|--------|-----------|
| Frontend | Next.js 14 App Router + Tailwind CSS + shadcn/ui |
| API interna | tRPC (type-safe, Next.js ↔ frontend) |
| API pública | REST + OpenAPI 3.0 (endpoints `/api/v1/`) |
| Banco | PostgreSQL + Prisma + Row Level Security (Neon serverless em prod) |
| Autenticação | Clerk (Google OAuth, Microsoft OAuth, magic link, TOTP 2FA) |
| Filas/Jobs | BullMQ + Redis |
| Email | Resend |
| Storage | AWS S3 / Cloudflare R2 |
| Billing | Stripe |
| WAF/CDN | Cloudflare |
| Feature flags | Unleash (self-hosted) |
| IA principal | Anthropic SDK (Claude Haiku + Sonnet) |
| IA benchmarks | Perplexity API (fallback: Gemini, OpenAI) |
| Vector search | pgvector (extensão PostgreSQL) |
| Containers | Docker + Docker Compose |
| CI/CD | GitHub Actions |
| Observabilidade | Sentry + Axiom |
| Testes | Vitest (unit) + Supertest (integration) + Playwright (E2E) |

---

## Regras de Arquitetura — OBRIGATÓRIAS

1. **Multi-tenancy**: TODA query de banco inclui `WHERE tenant_id = ?` — sem exceção. A Prisma extension em `src/server/db/client.ts` injeta isso automaticamente desde que o handler esteja envolto em `runWithTenant()`. RLS no PostgreSQL como segunda linha de defesa.

2. **Validação**: TODA entrada de usuário é validada com **Zod no servidor**. Nunca confiar apenas na validação do frontend.

3. **Secrets**: ZERO hardcode de credenciais. Somente variáveis de ambiente, parseadas e validadas em `src/lib/env.ts` (Zod). Usar `.env.local` no dev (nunca commitar).

4. **Soft delete**: Campo `deleted_at` em todas as entidades. Nenhum registro é deletado permanentemente em operações normais. Exceção: rota `/api/v1/gdpr/erase` para anonimização LGPD.

5. **Data Masking para IA**: NUNCA enviar PII (nomes, e-mails, CPF/CNPJ, telefones) diretamente a providers de IA. Passar pelo `DataMaskingService` (`src/lib/ai/masking.ts`) que tokeniza e destokeniza automaticamente.

6. **Mobile-first**: Breakpoint base 375px. Bottom navigation bar em mobile. Tables → cards empilhados em viewport < 768px. Touch targets ≥ 44×44px.

7. **Audit log**: Toda ação sensível registrada em `audit_logs` via `audit()` em `src/server/services/audit.service.ts`.

8. **RBAC**: Todo endpoint tRPC/REST com middleware de auth (Clerk) + tenant + role. Roles: `SUPER_ADMIN | ADMIN | DIRETOR | GESTOR | ANALISTA | PARCEIRO`. Matriz em `src/lib/auth/rbac.ts`.

---

## Estrutura de Pastas

```
/
├── CLAUDE.md                    ← este arquivo
├── docs/
│   └── CRM_Especificacao_e_Implementacao.docx
├── src/
│   ├── app/                     ← Next.js App Router
│   │   ├── api/
│   │   │   ├── trpc/[trpc]/    ← tRPC HTTP adapter
│   │   │   └── v1/             ← REST endpoints públicos
│   │   ├── layout.tsx          ← ClerkProvider + tema shadcn
│   │   └── page.tsx
│   ├── components/
│   │   ├── ui/                 ← shadcn/ui base (button, etc.)
│   │   └── modules/            ← componentes por módulo (pipeline/, contacts/, …)
│   ├── server/
│   │   ├── trpc/
│   │   │   ├── routers/        ← um arquivo por módulo
│   │   │   ├── context.ts      ← extrai tenantId + user dos headers
│   │   │   └── trpc.ts         ← initTRPC + middlewares
│   │   ├── services/           ← lógica de negócio (audit, etc.)
│   │   ├── db/
│   │   │   ├── client.ts       ← Prisma + tenant extension
│   │   │   ├── tenant-context.ts ← AsyncLocalStorage helpers
│   │   │   └── repositories/
│   │   └── api/v1/             ← handlers REST OpenAPI
│   ├── lib/
│   │   ├── validators/         ← schemas Zod compartilhados
│   │   ├── ai/
│   │   │   ├── masking.ts      ← DataMaskingService (tokenização PII)
│   │   │   └── claude.ts       ← wrapper Anthropic SDK
│   │   ├── auth/
│   │   │   └── rbac.ts         ← matriz de permissões
│   │   ├── utils/cn.ts         ← cn() helper shadcn
│   │   └── env.ts              ← variáveis validadas com Zod
│   ├── jobs/                   ← BullMQ workers (sprint 3+)
│   └── middleware.ts           ← Next.js middleware (Clerk + tenant)
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts                 ← 3 tenants com massa em PT-BR
│   └── migrations/
│       ├── 0001_init/
│       ├── 0002_rls/
│       └── 0003_vector_indexes/
├── tests/
│   ├── unit/                   ← Vitest
│   ├── integration/            ← Supertest
│   ├── e2e/                    ← Playwright
│   └── setup.ts
├── docker-compose.yml
├── Dockerfile
└── .github/workflows/ci.yml
```

---

## Multi-tenancy — fluxo de uma requisição autenticada

```
Request HTTP
   ↓
Clerk middleware (src/middleware.ts)
   ↓  extrai sessionClaims.public.tenantId → header x-tenant-id
   ↓
Route handler (app/api/trpc/[trpc]/route.ts)
   ↓  runWithTenant({tenantId, userId, role}, async () => ...)
   ↓
tRPC procedure
   ↓
Prisma query
   ↓  $extends.query.$allOperations injeta {where: {..., tenantId}} ou
   ↓  {data: {tenantId, ...}} automaticamente
   ↓
PostgreSQL
   ↓  RLS policies (current_tenant_id()) bloqueiam vazamento mesmo se a injeção falhar
```

A camada Prisma + RLS é defesa em profundidade: ambas precisam ser bypassadas para haver vazamento de tenant.

---

## DataMaskingService — uso obrigatório antes de IA

```typescript
import { masking } from '@/lib/ai/masking';
import { getAnthropic, MODELS } from '@/lib/ai/claude';

const { masked, map } = masking.mask(userText);
const completion = await getAnthropic().messages.create({
  model: MODELS.HAIKU,
  max_tokens: 1024,
  messages: [{ role: 'user', content: masked }],
});
const safe = masking.unmask(extractText(completion), map);
```

**Nunca passe `userText` diretamente para um provider de IA.**

---

## Convenções de Código

- TypeScript strict + `noUncheckedIndexedAccess` + `noImplicitOverride`
- Nomenclatura: `camelCase` variáveis, `PascalCase` componentes/types, `snake_case` banco (mapeado via `@@map` / `@map`)
- Imports: absolute paths via `@/` alias
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`)
- Cada novo módulo: router tRPC + service + testes unitários mínimos
- Nada de comentários narrativos; explicar apenas o "porquê" não óbvio

---

## Comandos úteis

```bash
# dev
npm run dev                     # Next.js em http://localhost:3000
docker compose up -d postgres redis

# banco
npx prisma migrate dev          # cria nova migration interativamente
npx prisma migrate deploy       # aplica todas em prod/CI
npm run db:seed                 # popula 3 tenants
npm run db:reset                # reset + migrate + seed
npx prisma studio               # GUI do banco

# qualidade
npm run lint
npm run type-check
npm run test                    # Vitest
npm run test:watch
npm run test:coverage
npm run test:e2e                # Playwright

# build
npm run build
```

---

## Ordem de Implementação

Seguir rigorosamente o Plano de Sprints da **PARTE II, Seção 4** do documento de especificação.

**Nunca pular sprints ou implementar módulos fora de ordem** — cada sprint depende da fundação do anterior.

Sprint atual: **verificar no topo deste arquivo qual sprint está em andamento.**

---

## Checklist antes de cada deploy (PR → staging)

- [ ] `npm run test` passa
- [ ] `npm run type-check` passa
- [ ] `npm run lint` passa
- [ ] Job `multi-tenancy-guard` no CI passa (sem queries Prisma fora dos pontos de controle)
- [ ] Nenhum secret hardcoded (revisar diff)
- [ ] Schema Prisma migrado em staging (`npx prisma migrate deploy`)
- [ ] Seed executado (se for novo tenant)
- [ ] `GET /api/v1/health` retorna `{status: "ok", checks: {db: "ok"}}`
- [ ] Nenhum `console.log` com PII ou tokens
