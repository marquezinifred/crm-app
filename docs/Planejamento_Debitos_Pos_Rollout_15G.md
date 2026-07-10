# Planejamento de Débitos Descobertos no Rollout Sprint 15G

**Data:** 2026-07-10
**Origem:** Sessão de teste real em produção após rollout Sprint 15G (Estrutura Comercial e Visibilidade Hierárquica)
**Destinatário:** PO
**Autor:** Sessão Claude (gestão) + Fred Marquezini (validação)

---

## Sumário executivo

Durante a validação em produção do Sprint 15G — com 6 roles reais logando e exercitando o fluxo de oportunidades — foram descobertos **10 débitos** de natureza variada (segurança, UX, arquitetura, setup). A distribuição:

- **3 débitos de severidade ALTA** que impactam usabilidade ou segurança em profundidade e devem entrar em sprint imediato.
- **4 débitos de severidade MÉDIA** de natureza arquitetural/setup — não bloqueiam operação mas geram fragilidade se acumulados.
- **3 débitos de severidade BAIXA** de UX cosmético ou documental — housekeeping.

**Recomendação de sequenciamento:**
1. **Chip cirúrgico imediato (dia 1 do Sprint 15H):** P-88, P-89, P-86 — bugs pontuais com fix ≤ 1h cada.
2. **Feature no Sprint 15H (Bloco C):** P-87 — delegação hierárquica de opportunities, integração natural com estrutura comercial.
3. **Housekeeping paralelo:** P-83, P-84, P-81 — melhorias sem urgência.
4. **Sprint 16 (Hardening):** P-80, P-82, P-85 — decisões arquiteturais que precisam análise dedicada.

**Estimativa total agregada:** ~8-10 dias de trabalho (misto entre chips e features).

---

## Débitos por prioridade

### 🔴 ALTA — Chips imediatos

#### P-88 — Sidebar mostra itens Admin para roles sem permissão

**Descoberto por:** Fred, logado como ANALISTA (`frederico.marquezini@jaupartners.com.br`), acessando o menu lateral em produção.

**Sintoma:** ANALISTA vê no menu lateral (seção ADMIN) os itens **Usuários**, **Produtos** e **Listas** — que ele não tem permissão para acessar. Ao clicar, o backend retorna FORBIDDEN corretamente, mas o menu não deveria oferecer a opção.

**Root cause:** No `src/components/layout/Sidebar.tsx` linhas 69-71, esses 3 itens **não têm** a chave `permission:` configurada. Comparação com itens que **estão** protegidos:
```
{ href: '/admin/commercial-structure', ..., permission: 'sales_structure:read' }  ✅
{ href: '/admin/email-inbound', ..., permission: 'inbound:configure' }             ✅
{ href: '/imports', ..., permission: 'import:run' }                                ✅

{ href: '/admin/users', ..., }         ❌ SEM permission
{ href: '/admin/products', ..., }      ❌ SEM permission
{ href: '/admin/listas', ..., }        ❌ SEM permission
```

Sprint 15E introduziu o padrão `permission:` no Sidebar mas não retroagiu nos itens antigos.

**Impacto:**
- **Segurança:** dados **não vazam** (backend barra). Mas defesa em profundidade fica quebrada — se algum dia o backend tiver bug, o menu já expõe a rota.
- **UX:** usuário confuso vê opções que não pode usar; ao clicar recebe erro 403 sem contexto.
- **Impressão de produto:** parece bug técnico.

**Solução proposta:**
Adicionar `permission:` em cada item:
- `/admin/users` → `permission: 'user:read'`
- `/admin/products` → `permission: 'product:read'`
- `/admin/listas` → `permission: 'catalog:read'` (ou permissão equivalente do catálogo)

**Testes a incluir:**
- Component test do Sidebar renderizando com role ANALISTA → nenhum dos 3 itens aparece.
- Idem GESTOR, PARCEIRO.
- Sanity test com ADMIN → todos os itens aparecem.

**Estimativa:** 30-45min (fix + testes + code review).

**Dependências:** Nenhuma.

**Severidade:** ALTA (defesa em profundidade quebrada, alta visibilidade pro usuário).

---

#### P-89 — `/pipeline/new` permite duplicação de oportunidade

**Descoberto por:** Fred, criando oportunidade em produção. Após primeira criação bem-sucedida, o Sheet lateral abriu mostrando a opp. Ao fechar o Sheet, voltou para a tela do form ainda preenchido. Clicou novamente em Salvar e uma **segunda opp idêntica foi criada**.

**Sintoma:** Fluxo natural do usuário permite duplicação acidental. Basta fechar o Sheet lateral após uma criação e clicar Salvar de novo.

**Root cause hipotético:**
- Após submit bem-sucedido, o form não reseta seu state.
- Fechar o Sheet lateral retorna à rota `/pipeline/new` com o form preenchido.
- Botão Salvar continua habilitado.

**Impacto:**
- **Dados:** oportunidades duplicadas no pipeline geram distorção em relatórios de conversão, previsão de receita e comissões.
- **UX:** usuário nem sabe que criou duplicata (só vê depois no kanban).
- **Operacional:** limpeza manual das duplicatas exige acesso admin ao banco.

**Solução proposta (3 camadas — defesa em profundidade):**

1. **Frontend imediato:** após `create` bem-sucedido, redirecionar para `/pipeline` (kanban) ou `/pipeline/[id]` full page (não Sheet). Form nunca fica pendurado com dados preenchidos.

2. **UX complementar:** botão Salvar fica `disabled` durante mutation (`loading`) e permanece disabled após success. Segundo clique não dispara nada.

3. **Backend defensivo (opcional futuro):** endpoint `opportunities.create` poderia ter idempotency por hash de payload + user_id + janela de 5 segundos. Retorna a opp já criada em vez de duplicar. Mais robusto mas invasivo.

**Testes a incluir:**
- Component test do form: submit dispara → mutation ativa → botão vira disabled + spinner.
- Component test: submit success → dispara redirect (não permanece no form).
- Backend idempotency (se implementar): 2 requests iguais em janela pequena → 1 create + 1 fetch da opp existente.

**Estimativa:** 30min (camadas 1 e 2, sem backend idempotency) OU 3h (com camada 3 completa).

**Dependências:** Nenhuma.

**Severidade:** ALTA (duplicação de dados em fluxo normal).

---

#### P-87 — Delegação hierárquica de oportunidade (feature)

**Descoberto por:** Fred, logado como ANALISTA, criando opp e atribuindo `ownerId` a um DIRETOR_COMERCIAL. Após criar, foi redirecionado para `/pipeline/<uuid>` e recebeu **NOT_FOUND** — porque o Sprint 15G escondeu corretamente da visão do ANALISTA a opp que ele criou mas não é dele.

**Sintoma real vs esperado:**
- **Comportamento atual:** ANALISTA pode escolher qualquer usuário como responsável no form. Se escolher outro, cria a opp mas depois "perde" ela (não vê mais em nenhum lugar).
- **Comportamento esperado:** ANALISTA só deveria poder atribuir opp para si mesmo ou para pares hierárquicos (outro ANALISTA da mesma unidade/nível). Delegar para cima na hierarquia (Gestor, Diretor) não faz sentido.

**Root cause:** Backend `opportunities.create` valida escopo de leitura via Sprint 15G, mas **não valida escopo de escrita** (quem pode ser owner). O form UI oferece dropdown com todos os usuários do tenant.

**Regra de negócio proposta (validada com PO):**

Caller pode definir `ownerId` diferente dele se:
1. Owner é ele mesmo (sempre OK), OU
2. Owner está na **subárvore que caller gerencia** (via ltree, mesmo pattern do `read_team`), OU
3. Owner está no **mesmo nível hierárquico** do caller (par — pode ser gestor↔gestor, analista↔analista).

**Traduzindo em regra concreta:**
```
Se caller.unit.level ≤ selectedOwner.unit.level (level 1 = mais alto) → OK
Senão → FORBIDDEN "Você não pode delegar oportunidade para este usuário"
```

**Exemplos de aplicação:**

| Caller | Owner escolhido | Level caller ≤ Level owner? | Permitido? |
|--------|-----------------|----------------------------|------------|
| Diretor | Qualquer usuário | Sim | ✅ |
| Gestor Sul | Analista da Equipe Sul | Sim (subárvore) | ✅ |
| Gestor Sul | Outro Gestor (Norte) | Sim (mesmo nível — par) | ✅ |
| Gestor Sul | Diretor | Não (Gestor não sobe) | ❌ |
| Analista SP | Outro Analista SP | Sim (mesmo nível) | ✅ |
| Analista SP | Analista RJ (outra unidade) | Sim (mesmo nível) | ✅ |
| Analista SP | Gestor Sul | Não (Analista não delega pra cima) | ❌ |

**Impacto:**
- **Modelo real de trabalho:** hoje representa manualmente. Gestores atribuem tarefas para vendedores da equipe (delegação vertical). Vendedores passam leads entre si (transferência horizontal).
- **Sprint 15G contexto:** essa é a segunda metade da história — Sprint 15G cuidou de **visão** (quem vê o quê); essa feature cuida de **atribuição** (quem pode designar tarefa a quem).

**Solução proposta:**

**Backend:**
1. `salesStructure.myScope` já retorna a subárvore. Extender com `writeScope` que devolve lista de user IDs delegáveis (subtree + pares do mesmo nível).
2. `opportunities.create` valida `ownerId` contra `writeScope`. Se fora, throw FORBIDDEN.
3. `opportunities.update` idem quando altera `ownerId` (transferência).

**Frontend:**
1. `/pipeline/new` filtra o dropdown "Responsável interno" pelos users que cabem na regra (`trpc.salesStructure.writeScope`).
2. Se caller = ANALISTA e não tem pares na unidade → dropdown pré-preenchido com o próprio usuário e disabled.
3. Se caller tem pares/subárvore → dropdown mostra opções permitidas.

**Testes:**
- Backend: 6 casos por role (ADMIN, DIRETOR, GESTOR, ANALISTA, PARCEIRO) × cada cenário da tabela acima.
- Frontend: component test do form com role ANALISTA vs GESTOR — dropdown popula diferente.
- E2E: analista tenta forçar payload com ownerId inválido → FORBIDDEN.

**Estimativa:** 2-3 dias (backend + UI + testes + spec técnica).

**Dependências:** Sprint 15G (base) — atendida. Idealmente encaixa no Sprint 15H como **Bloco C ampliado**.

**Severidade:** ALTA (feature bloqueadora — o modelo de trabalho real depende disso).

---

### 🟡 MÉDIA — Chips oportunistas

#### P-80 — Vercel Production compartilha banco Neon com dev local

**Descoberto durante:** rollout Sprint 15G, ao rodar `vercel env pull` e verificar que o `DATABASE_URL` de produção aponta para o mesmo branch Neon (`ep-dry-pine-ajwvil7q`) usado no `.env.local` do desenvolvedor.

**Sintoma:** Um `db:reset` acidental no desenvolvimento local afeta produção. Um script de recovery ou correção mexe nos dados que usuários finais veem.

**Impacto:**
- **Segurança/estabilidade:** blast radius de erros de desenvolvimento aumenta drasticamente. Uma migração experimental ou script bugado afeta todo mundo.
- **Compliance/LGPD:** ambientes prod e dev não são isolados; qualquer dado real fica exposto em qualquer script rodado localmente.
- **Preços:** não tem impacto direto no Neon Free tier, mas se escalar para pago, o dev roda contra o mesmo compute pago da produção.

**Solução proposta:**
1. Criar branch Neon separado para produção (ex: `production` ou `prod-main`) a partir do estado atual do `staging`.
2. Atualizar env var `DATABASE_URL` no Vercel production para apontar para o novo branch.
3. Documentar em runbook que o desenvolvimento local **nunca** aponta para o branch de produção — apenas para staging/dev.
4. Configurar branch de staging separado se necessário (opcional, já temos o modelo staging).

**Estimativa:** 2-3h (criar branch Neon, testar migration em cima, cutover Vercel env, monitorar 24h).

**Dependências:** Rollout Sprint 15G estabilizado (feito).

**Severidade:** MÉDIA (não bloqueia, mas fragiliza).

---

#### P-82 — Loop 401 quando `clerkId` chega sem row local correspondente

**Descoberto por:** Fred logando com `fredmarquezini@hotmail.com` após restore Neon PITR — a conta Clerk existia mas o row local no banco havia sido apagado. Resultado: dashboard entra em loop de reload infinito.

**Sintoma:** Sessão Clerk válida + `public_metadata.tenantId` populado + user não existe no banco = 401 em qualquer tRPC call → session-guard força reload → mesmo estado → loop infinito.

**Root cause:** O session-guard (`src/lib/trpc/session-guard.ts`) reage a 401 fazendo reload da página assumindo que a sessão expirou. Não distingue "cookie expirado" de "usuário não conhecido pelo backend".

**Impacto:**
- **UX crítica:** usuário fica travado sem entender o que aconteceu. Precisa suporte técnico.
- **Recovery:** só via edição manual de banco/Clerk metadata.
- **Recorrência:** acontece a cada restore, cada db:reset, cada migração destrutiva.

**Solução proposta:**
1. Backend `users.me` deve retornar código de erro diferenciado quando `clerkId` presente mas row local ausente: `USER_NOT_PROVISIONED` (não `UNAUTHORIZED`).
2. Session-guard distingue os códigos e:
   - `UNAUTHORIZED` → reload (comportamento atual).
   - `USER_NOT_PROVISIONED` → redirecionar para tela dedicada `/account-not-found` com contexto: "Sua conta Clerk existe mas não está associada a nenhum tenant. Peça ao admin do seu tenant para te convidar."
3. Botão "Sign out" nessa tela para o usuário poder trocar de conta.

**Estimativa:** 4-6h (backend + tela nova + tests).

**Dependências:** Nenhuma.

**Severidade:** MÉDIA (recuperação de incidente).

---

#### P-85 — Vercel Production aponta para Clerk **Development** instance

**Descoberto por:** Fred, ao ver que o email de verification code enviado pelo Clerk tinha `[Development]` no assunto e vinha de `notifications@accounts.dev`.

**Sintoma:** A instância Clerk que autentica os usuários em produção (`crm-app-pi-eight.vercel.app`) é a de **desenvolvimento** (`guiding-bobcat-23.clerk.accounts.dev`). Emails vêm do domínio `accounts.dev` com marca "Development".

**Impacto:**
- **Imagem de produto:** usuário real vê "[Development]" no email do próprio produto. Impressão de amadorismo.
- **Segurança:** instâncias dev do Clerk têm limites reduzidos (rate limits, session lifetime) e políticas mais permissivas (aceita qualquer email para sign-up sem verificação de domínio).
- **Escala:** instância dev tem quota limitada de usuários (Clerk Free tier — 10k MAU no dev, com features restritas). Chegando ao limite, produção quebra.

**Solução proposta:**
1. Criar Clerk **Production instance** no Dashboard.
2. Configurar domain custom (ex: `accounts.venzo.com.br` ou similar).
3. Migrar usuários existentes da dev para prod (Clerk oferece feature de user migration).
4. Atualizar `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` e `CLERK_SECRET_KEY` no Vercel production.
5. Reconfigurar JWT template no novo instance.
6. Reconfigurar webhook endpoint apontando para nova instance.
7. Documentar procedimento no runbook de rollout.

**Estimativa:** 1-2 dias (config + migration + testes + rollout gradual).

**Dependências:**
- Domínio próprio para Venzo (compra + DNS).
- Comunicação com usuários existentes se sessões forem invalidadas.

**Severidade:** MÉDIA (bloqueador de percepção de produto para venda a cliente).

---

#### P-86 — `/admin/users` — dropdown Papel e botões Permissões/Desativar sem persistência

**Descoberto por:** Fred, testando manutenção de usuários em produção após rollout.

**Sintoma:** Na página `/admin/users`, o dropdown de Papel aparece editável e os botões "Permissões" e "Desativar" aparecem clicáveis. Mas ao interagir, **nada persiste** (ou persiste sem feedback visual).

**Root cause hipotético:** UI foi construída antes do endpoint backend estar finalizado, ou perdeu o binding no meio do caminho.

**Impacto:**
- **UX:** admin tenta trocar papel de user, nada acontece, admin fica sem saber se foi ou não. Refresh da página confirma que não foi.
- **Operacional:** admin tem que ir no `/admin/users/[id]/permissions` (que funciona corretamente) para fazer mudanças.

**Solução proposta:**
- Auditar cada ação da tabela `/admin/users`:
  - Dropdown Papel → conecta a `users.updateRole` (existe? funciona?).
  - Botão Permissões → navega para `/admin/users/[id]/permissions` (isso já deve funcionar).
  - Botão Desativar → conecta a `users.deactivate` com `AlertDialog` de confirmação.
- Adicionar toast de sucesso/erro em cada mutation.
- Testes de integração para cada ação.

**Estimativa:** 3-4h (auditoria + fix + testes).

**Dependências:** Nenhuma.

**Severidade:** MÉDIA (bug de features expostas mas quebradas).

---

### 🟢 BAIXA — Housekeeping

#### P-81 — Runbook de recovery pós-restore Neon PITR

**Descoberto durante:** o próprio processo de recuperação após o `db:reset` acidental. Precisamos recriar manualmente 4 usuários (hotmail, Antonio, yahoo, jaupartners) via SQL direto porque o restore PITR trouxe o estado antigo do banco sem esses usuários criados após a data do snapshot.

**Sintoma:** Não existia procedimento documentado para o cenário "restore Neon apagou N dias de usuários criados". Cada passo foi improvisado.

**Solução proposta:**
Criar `docs/Runbook_Recovery_Pos_Neon_Restore.md` com:
1. **Detecção:** como identificar quais users existem no Clerk mas não no banco (script de diff).
2. **Recuperação seletiva:** template SQL para reinserir user por user preservando role/tenant do Clerk metadata.
3. **Cache RBAC:** re-executar `rbac:backfill-cache` obrigatório pós-recovery.
4. **Verificação:** checklist de teste (cada role recuperada faz sign-in e acessa dashboard sem loop).

**Estimativa:** 2h (documento + template SQL + validação).

**Dependências:** Nenhuma.

**Severidade:** BAIXA (documental).

---

#### P-83 — Constraint UNIQUE `(tenant_id, email)` deveria ser PARTIAL

**Descoberto por:** Fred, ao tentar reenviar convite via `/admin/users` para um email que havia sido soft-deleted anteriormente. O erro "Unique constraint failed" apareceu.

**Sintoma:** Após soft-delete de um user, o email fica bloqueado permanentemente pelo constraint. Impossível reutilizar sem hard delete.

**Root cause:** O índice `UNIQUE(tenant_id, email)` inclui rows soft-deleted (`deleted_at IS NOT NULL`), quando deveria filtrar (`WHERE deleted_at IS NULL`).

**Solução proposta:**
Migration:
```sql
DROP INDEX users_tenant_id_email_key;
CREATE UNIQUE INDEX users_tenant_id_email_active_key
  ON users (tenant_id, email)
  WHERE deleted_at IS NULL;
```

**Impacto:**
- Antes: erro Prisma cru "Unique constraint failed" quando reconvidar email soft-deleted.
- Depois: reconvite funciona sem passo manual.

**Estimativa:** 30min (migration + teste).

**Dependências:** Nenhuma.

**Severidade:** BAIXA (contornável manualmente).

---

#### P-84 — `/admin/users` → Convidar não trata row soft-deleted

**Descoberto:** Junto com P-83. Ao tentar reenviar convite para email soft-deleted, o erro Prisma vaza para a UI como mensagem crua e feia.

**Sintoma:** Usuário vê "Invalid `prisma.user.create()` invocation: Unique constraint failed on the fields: (`tenant_id`, `email`)".

**Solução proposta:**
No procedure `users.invite`, antes de `prisma.user.create`:
```
- findFirst incluindo deleted_at != null
- Se existir row soft-deleted:
    → oferecer reativar (UPDATE deleted_at=null, active=true) OU criar novo (após P-83)
    → mensagem amigável: "Este email já foi convidado antes e foi desativado. Deseja reativar?"
```

**Impacto:**
- UX: mensagem clara em vez de erro técnico.
- Fluxo de reconvite fica natural.

**Estimativa:** 2h (backend + UI feedback + testes).

**Dependências:** P-83 (para poder criar novo email diretamente após soft-delete).

**Severidade:** BAIXA (UX-only).

---

## Recomendação de sequenciamento

### Semana 1 (chips imediatos — 1-2 dias)

- **P-88** (Sidebar RBAC) — 45min
- **P-89** (duplicação em `/pipeline/new`) — 30min
- **P-86** (dropdown Papel + botões admin/users) — 4h

**Total:** ~1 dia de chip + QA Modo B (aprox 6h).

### Sprint 15H (features — 4-6 dias)

- **P-87** (Delegação hierárquica) — 2-3 dias, integrar como **Bloco C ampliado** do Sprint 15H já planejado.
- Blocos A (P-77 reconcile approvals) + B (Metas por unidade) do Sprint 15H permanecem.

### Housekeeping paralelo (opcional — 3-4h)

- **P-83** (Partial UNIQUE) — 30min.
- **P-84** (Convidar reativa soft-deleted) — 2h.
- **P-81** (Runbook recovery) — 2h.

### Sprint 16 — Hardening (2-3 dias)

- **P-80** (Separar Neon prod de dev) — 2-3h + 24h monitoramento.
- **P-82** (Loop 401 → tela dedicada) — 4-6h.
- **P-85** (Clerk Production instance) — 1-2 dias (depende de domínio próprio).

---

## Métricas de sucesso pós-implementação

Depois de encerrar os 3 chips imediatos e P-87:

1. **P-88:** Sidebar de ANALISTA/GESTOR/PARCEIRO não mostra Usuários/Produtos/Listas — verificar em prod com cada role.
2. **P-89:** Criar 10 opps em fluxo natural e nenhuma duplicata aparece no banco. Fluxo redireciona corretamente após sucesso.
3. **P-87:** ANALISTA que tenta criar opp com owner=DIRETOR recebe FORBIDDEN legível. Dropdown mostra apenas pares/subárvore.

Todos os itens registrados no `Roteiro_QA_Homologacao_Staging.md` como cenários V-15G-N a partir de V-15G-7.

---

## Referências

- **Sprint 15G contexto:** [Sprint_15G_estrutura_comercial.md](Sprint_15G_estrutura_comercial.md) + [Sprint_15G_amendments.md](Sprint_15G_amendments.md)
- **Sprint 15H já planejado:** [Sprint_15H_Metas_e_Approvals.md](Sprint_15H_Metas_e_Approvals.md)
- **Rollout Sprint 15G executado:** [ROLLOUT_Sprint_15G_Prod.md](ROLLOUT_Sprint_15G_Prod.md)
- **Handoff noturno anterior:** [HANDOFF_Noturno_2026-07-08.md](HANDOFF_Noturno_2026-07-08.md)
