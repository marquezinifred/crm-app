# Visual Regression Baseline — Sprint 14.5

Captura screenshots de 25+ rotas × 3 viewports (375/768/1280) usando
`scripts/visual-baseline.ts`. Serve como referência para detectar
regressões visuais não-intencionais em PRs futuros.

## Quando capturar/atualizar baseline

- **Sprint 14.5 (atual)**: capturar congelando estado pós-polish
- **Sprints futuros**: só atualizar quando mudanças visuais forem
  intencionais e aprovadas

## Procedimento

```bash
# Terminal 1 — postgres + redis
docker compose up -d postgres redis

# Terminal 2 — seed + dev
npm run db:seed
npm run dev

# Terminal 3 — captura
export E2E_TEST_TENANT_ID=<uuid do tenant seed>
export E2E_TEST_USER_CLERK_ID=<clerk id do admin>
export VISUAL_MODE=baseline
npx tsx scripts/visual-baseline.ts
```

PNGs ficam em `tests/visual/baseline/{route}-{viewport}.png`.

## Validar amostra antes de commitar

```bash
open tests/visual/baseline/dashboard-desktop.png
open tests/visual/baseline/pipeline-mobile.png
open tests/visual/baseline/admin-branding-desktop.png
```

Se algum estiver com erro (404, modal de Clerk sobreposto, banner de
erro), corrigir e recapturar antes do commit.

## Commit

```bash
git add tests/visual/baseline/
git commit -m "chore: capture visual baseline after Sprint 14.5"
```

## Diff em PRs (Sprint 15+)

Workflow `.github/workflows/visual-regression.yml` (a ser criado em
Sprint 15) roda `VISUAL_MODE=current node scripts/visual-baseline.ts`
em cada PR, compara com baseline e gera diffs em
`tests/visual/diff/{route}-{viewport}.png`. Aprovação humana em PR
permite atualizar o baseline.

---

**Status:** baseline pendente — depende de seed E2E + Postgres
operacional. Marcar como entregue após captura local e push.
