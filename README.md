# CRM B2B Multi-tenant

CRM comercial multi-tenant para gestão de pipeline B2B (Prospect → Lead → Oportunidade → Proposta → Negociação → Aceite → Contrato), com IA integrada para resumos de comunicação e suporte a parceiros, fornecedores e clientes.

**Status:** Sprint 0 — Foundation concluído.
Próximo: Sprint 1 — Autenticação e Cadastros Base.

Veja [CLAUDE.md](./CLAUDE.md) para a visão técnica completa.

## Quick start

```bash
# 1. Variáveis de ambiente
cp .env.example .env.local
# (edite .env.local com suas chaves Clerk, Anthropic, etc.)

# 2. Subir infra local (Postgres com pgvector + Redis)
docker compose up -d postgres redis

# 3. Aplicar migrações
npx prisma migrate deploy

# 4. Popular com 3 tenants de teste
npm run db:seed

# 5. Dev server
npm run dev
# → http://localhost:3000
```

## Comandos principais

| Comando | O que faz |
|---|---|
| `npm run dev` | Next.js em http://localhost:3000 |
| `npm run build` | Build de produção |
| `npm run type-check` | TypeScript sem erros |
| `npm run lint` | ESLint |
| `npm run test` | Vitest (unit + integration) |
| `npm run test:e2e` | Playwright |
| `npm run db:seed` | Popula 3 tenants de teste |
| `npm run db:reset` | Reset + migrate + seed (DEV apenas) |
| `npx prisma studio` | GUI do banco |

## Arquitetura

- **Next.js 14** App Router + **TypeScript strict** + **Tailwind** + **shadcn/ui**
- **tRPC** (interno) + REST OpenAPI (externo)
- **PostgreSQL** + Prisma + **Row Level Security** + **pgvector**
- **Clerk** (Google/Microsoft OAuth, magic link, TOTP 2FA)
- **BullMQ** + Redis (cron de alertas, e-mails)
- **Anthropic SDK** (Claude Haiku/Sonnet) + DataMaskingService para PII

Detalhes: [CLAUDE.md](./CLAUDE.md).

## Licença

Privado.
