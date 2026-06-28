# Sprint 10.5 — Refinamentos WCAG

Complementa as seções de Sprint 10.5 em
`Arquitetura_e_Plano_Implantacao_CRM.docx` e
`CRM_Especificacao_e_Implementacao.docx`, e a seção 06 de
`venzo_brand_guide.docx`.

**Contexto.** A validação WCAG é peça crítica do Sprint 10.5, não
detalhe técnico. Sem ela, um cliente Enterprise pode publicar um
tema visualmente bonito mas legalmente exposto (Lei Brasileira de
Inclusão — Lei 13.146/2015) e, na prática, ilegível para
~7% dos usuários com baixa visão. As 5 regras abaixo elevam a
validação de "checagem básica" para "primeiro cidadão" do módulo.

---

## 1. Validação combinatorial, não única

**Hoje (spec base):** valida contraste da cor primária contra texto
branco.

**Refinamento:** validar contra **todas as combinações reais de uso**.
A cor primária aparece em:

| Combinação | Onde aparece | Ratio mínimo |
|---|---|---|
| `--brand-primary` × `#FFFFFF` (branco) | Texto em botões primários | 4.5:1 |
| `--brand-primary` × `#111827` (texto principal) | Texto colorido sobre superfície | 4.5:1 |
| `--brand-primary` × `--brand-primary-dark` | Hover states, gradientes | 3:1 |
| `--brand-accent` × `#FFFFFF` | Valores monetários | 4.5:1 |
| `--brand-accent` × `#111827` | Valores em fundo claro | 4.5:1 |

**Implementação:** o validator retorna um objeto com `passed: boolean`
e `failures: Array<{ combination, actualRatio, requiredRatio }>`. A UI
mostra cada falha individualmente, não um erro genérico.

**Critério de aceite:** tema que passa em 4 combinações e falha em 1
é bloqueado e mostra **qual combinação específica** falhou, não
apenas "falhou no contraste".

---

## 2. Sugestão dupla de cor (claro/escuro), não fix automático

**Hoje (spec base):** se cor reprova, sistema escurece 10% e oferece
versão única.

**Refinamento:** oferecer **2 sugestões** lado a lado:

- **Sugestão "escura"** — versão da cor com luminosidade reduzida até
  passar contra texto branco (melhor pra botões com texto claro)
- **Sugestão "clara"** — versão com luminosidade aumentada até passar
  contra texto preto (melhor pra fundos com texto escuro)

Admin escolhe qual encaixa na identidade visual.

**Algoritmo:** converter HEX → HSL → iterar `L` (luminosidade) em
passos de 5% até passar; retornar primeiro valor válido em cada
direção. Limite máximo de 8 iterações — se nenhuma direção passa
em 8 passos (raro, cor muito saturada), retorna `null` e UI mostra
"essa cor é incompatível com WCAG AA, escolha outra".

**Razão:** escurecer cegamente pode quebrar a identidade visual do
cliente. Dar duas opções respeita o brand book dele.

**Critério de aceite:** cliente Enterprise pega `#FFD700` (dourado
saturado), sistema sugere `#806C00` (escuro) e `#FFF8C0` (claro);
cliente escolhe; preview atualiza imediatamente.

---

## 3. Regra diferente para texto grande

**Hoje (spec base):** valida tudo com ratio 4.5:1.

**Refinamento:** validator conhece tipografia:

- Texto normal (`< 18px` regular ou `< 14px` bold) → **4.5:1**
- Texto grande (`≥ 18px` ou `≥ 14px` bold) → **3:1**
- Decoração / ícones funcionais → **3:1** (UI Components — WCAG 1.4.11)
- Ícones puramente decorativos → sem requisito (mas precisam de
  `aria-hidden="true"`)

**Implementação:** mapping declarativo no validator de quais elementos
da UI Venzo usam qual nível de texto. Exemplo:

```ts
const TEXT_CONTEXTS = {
  'page-title':       { minRatio: 3,   reason: 'Heading 1 - 32px bold' },
  'section-heading':  { minRatio: 3,   reason: 'Heading 2 - 24px bold' },
  'body':             { minRatio: 4.5, reason: 'Body text - 14px regular' },
  'button-primary':   { minRatio: 4.5, reason: 'Button text - 14px semi-bold' },
  'badge':            { minRatio: 4.5, reason: 'Badge text - 11px semi-bold' },
  'value-monetary':   { minRatio: 3,   reason: 'Heading 2 - 24px bold' },
}
```

**Razão:** WCAG diferencia conscientemente porque texto grande é mais
legível com contraste menor. Sermos mais rigorosos que o padrão só
restringe paletas válidas sem ganho real de acessibilidade.

**Critério de aceite:** cor que passa para H1 (3:1) mas falha para
body (4.5:1) é aceita para H1 e rejeitada para body — UI mostra
"essa cor é válida apenas em títulos; escolha outra para texto
corrido" e oferece sugestão.

---

## 4. Relatório de acessibilidade pós-publicação

**Hoje (spec base):** bloqueia publicação se falhar; aceita silenciosamente
se passar.

**Refinamento:** ao publicar, gera **relatório de conformidade** anexado
ao audit log:

| Campo | Conteúdo |
|---|---|
| `timestamp` | UTC ISO 8601 |
| `tenant`, `actor` | quem publicou |
| `theme_config_before`, `theme_config_after` | diff completo |
| `validations` | lista de combinações validadas com ratios reais |
| `screenshots` | 4 PNGs gerados via Playwright (dashboard, pipeline, reports, admin) com tema aplicado |
| `corrections_applied` | se admin aceitou sugestão automática, qual sugestão |
| `wcag_level` | "AA" (padrão) ou "AA com override" (se #5 ativo) |

Screenshots ficam no S3/R2 com URL assinada de 90 dias.

**Razão:** cliente Enterprise (governo, RH, banco) precisa de evidência
documental para auditoria interna de conformidade — esse relatório
substitui o trabalho manual de procurement validar acessibilidade
caso a caso.

**Critério de aceite:** publicar tema → relatório aparece em
`/admin/branding/audit-history` com link "Baixar relatório (PDF)" e
"Ver screenshots". Diretor consegue baixar 6 meses depois com URL ainda
válida (URL assinada renovada sob demanda).

---

## 5. Override manual para Enterprise (com aceite formal)

**Hoje (spec base):** bloqueio absoluto se contraste falha.

**Refinamento:** apenas no plano **Enterprise**, oferecer botão
secundário "Publicar mesmo assim (override WCAG)". O fluxo:

1. Sistema mostra modal com:
   - Lista das combinações que falharam e ratios reais
   - Texto de termo de responsabilidade: "Você está publicando um tema
     que não atende WCAG AA em [N] combinações. Sua empresa assume
     a responsabilidade pela conformidade legal e pela
     usabilidade dos usuários com baixa visão."
   - Checkbox obrigatório: "Confirmo que tenho aprovação do DPO/Legal"
   - Campo texto obrigatório: "Justificativa" (mínimo 30 chars)

2. Publicação grava no audit log:
   - `wcag_level: "AA com override"`
   - `override_justification: <texto>`
   - `override_approver_clerk_id: <user que aprovou>`
   - `override_failed_combinations: <lista>`

3. Página `/admin/branding` exibe banner amarelo permanente: "Tema
   ativo possui [N] desvios WCAG aprovados em [data] por [usuário]"

**Plans Starter e Growth:** não têm esse botão. Bloqueio absoluto.

**Razão:** alguns clientes Enterprise têm DPO/Legal que conscientemente
assumem riscos específicos por razões de brand (ex: empresa de luxo
quer cor dourada exata que falha em ratio). Tirar bloqueio sem
registro é irresponsável; oferecer override com aceite formal +
auditoria é equilibrado.

**Critério de aceite:** Starter tenta override → botão não aparece.
Enterprise tenta override sem preencher justificativa → bloqueado.
Enterprise completa fluxo → publicado + banner amarelo aparece na
página de admin para todos os admins do tenant verem.

---

## Impacto no escopo do Sprint 10.5

Refinamentos adicionam ~2 dias de trabalho:

| Refinamento | Esforço | Testes adicionais |
|---|---|---|
| 1. Combinatorial | ~4h | 6 unit (1 por combinação) |
| 2. Sugestão dupla | ~6h | 4 unit + 2 integração |
| 3. Texto grande | ~3h | 3 unit (níveis 3:1 vs 4.5:1) |
| 4. Relatório | ~8h (Playwright screenshots no worker) | 2 e2e |
| 5. Override Enterprise | ~5h | 3 unit + 2 integração |

**Total adicional:** ~26h / ~3 dias. Sprint passa de "Semana 17.5"
para "Semana 17.5 → 18" — empurra Sprint 11 em 3 dias.

**Trade-off:** vale a pena. Sem esses 5 refinamentos, a feature
white-label tem fragilidade legal (Lei 13.146/2015) e perde força
comercial pra Enterprise (governo / RH / banco rejeitam plataforma
sem evidência documental de WCAG AA).
