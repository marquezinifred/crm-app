# Arquitetura Venzo CRM — visão geral

Desenho visual da arquitetura do sistema em **4 camadas**, cada uma com
visão executiva + apêndice técnico:

1. **Funcional** — funil de 7 estágios (Prospect → Contrato) com os gates de
   negócio, mapa de módulos por domínio e papéis RBAC.
2. **Técnica & Infra** — espinha de uma requisição (Navegador → Clerk →
   middleware → tRPC/RBAC → serviço → Prisma extension → Neon/RLS), lane de
   workers BullMQ, serviços externos e hospedagem (Vercel gru1 / Neon /
   Railway), stack e kill-switches de rollout.
3. **Dados** — `Tenant` na raiz irrigando os clusters (identidade, comercial,
   documentos, estrutura `ltree` & metas, transversais) + invariantes
   (tenant_id + RLS, soft delete, ltree, tabelas WORM).
4. **Segurança** — defesa em profundidade em 6 barreiras
   (Cloudflare → Clerk → middleware → tRPC → Prisma extension → RLS) +
   controles transversais (DataMasking, criptografia de campo, audit, LGPD).

## Arquivos

- [`Arquitetura_Venzo_Visao_Geral.html`](./Arquitetura_Venzo_Visao_Geral.html)
  — página interativa (abas, tema claro/escuro, SVG). Abrir direto no
  navegador; não depende de servidor nem de build.

## Artefato vivo (Claude)

Versão publicada (privada — só o dono e quem ele compartilhar conseguem abrir):
<https://claude.ai/artifact/9DXwcArBAuVv7wjbr1JMWu>

O HTML neste diretório é o snapshot versionado no repositório; o artefato é a
cópia navegável/compartilhável. Ao atualizar um, atualizar o outro.

## Manutenção

Documento vivo. Snapshot reflete o estado em **out/2026** (Sprint 15H — Metas +
Reconcile — em andamento). Revisar ao fechar cada sprint que altere módulos,
fluxo de requisição, modelo de dados ou camadas de segurança.
