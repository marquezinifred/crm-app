# Kickoff — cole isso como primeira mensagem da próxima sessão

Copie e cole o bloco abaixo (entre as linhas `---`) na primeira mensagem da nova sessão Claude Code. Isso injeta o contexto essencial imediatamente:

---

Retomando trabalho no CRM Venzo. Sessão anterior encerrou em 2026-07-04 após ciclo longo (P-32 rotação Neon + P-33/P-34/P-35/P-36 merges + 2 docs consolidadas + QA automation cycle completo).

**Antes de qualquer ação, leia estes 3 arquivos na ordem** (não pule):

1. `docs/HANDOFF_Estado_Atual_2026-07-04.md` — snapshot do estado atual + ações pendentes + regras críticas descobertas
2. `docs/Metodologia_Desenvolvimento_Venzo.md` — fluxo canônico, checklist de fechamento, padrões de spawn de chip
3. `CLAUDE.md` — só as seções §Sprint atual e §Débitos técnicos

**Regras críticas que a sessão anterior consolidou (não esqueça):**

- **QA automation obrigatório default** após todo merge de código de app. Não pergunte se spawna — spawne via `spawn_task` com skill `anthropic-skills:qa-automation`. Template canônico do prompt em Metodologia §9.5. Exceções raras (docs-only, tooling sem runtime, config declarativa) devem ser justificadas por escrito.

- **NUNCA fazer parsing de linhas com secret embutido** (awk, sed, hexdump, xxd, cut). Use só `grep -q` com padrão âncora + echo constante ("ok"/"não"). Referência: memória `feedback_never_parse_secrets.md`.

- **Trabalhe na paterna** (`/Users/fredmarqueziniyahoo.com.br/Claude/crm-app`) para merges e commits em main. Worktrees `.claude/worktrees/*` são só de chips. Sempre verificar `pwd && git rev-parse HEAD && git rev-parse main` antes de mergir (a sessão anterior mergiu em worktree por engano 2 vezes).

- **Todo chip que eu spawnar recebe o checklist de fechamento** (Metodologia §3.1-3.5). Item 4 (atualizar `docs/Roteiro_QA_Homologacao_Staging.md`) é obrigatório para mudanças com impacto UX/funcionalidade.

**Estado atual do main:** HEAD `19729d7` — docs(backlog): P-32 rotação Neon staging — FECHADO.

**Baseline testes:** 715 passing / 0 failing / 168 skipped com env dummy. Type-check zero. Lint zero na paterna.

**Débitos abertos em ordem de valor/esforço:**
- P-41 baseline docs desatualizado (~15min)
- P-40 conflito .eslintrc worktree (~30min)
- P-39 fixture Clerk mock QA/dev local (~1h)
- P-37 cobertura hooks P-35 dispatch+ai-usage (~4h)
- P-38 cobertura worker queues.ts (~2h — depois de P-36 humano)
- P-36 Railway worker deploy (ação humana)
- P-03/P-05/P-25/P-27 pendentes de humano ou de outros marcos

**Ações humanas pendentes que Fred vai fazer no tempo dele:**
- P-36 subir worker Railway usando `docs/DEPLOY_Railway_Worker.md`
- Task #22 valida P-08 a P-12 visualmente
- Task #23 testar IA end-to-end

Depois de ler os 3 docs, me pergunte: quer começar por (A) chip housekeeping P-41+P-40+P-39 (~2h escopo isolado), (B) bloco Sprint 16 P-37+P-38 (~6h cobertura), ou (C) outra coisa?

---
