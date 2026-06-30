-- Sprint 15A débito — UNIQUE(clerk_id) global bloqueava dual identity.
-- A mesma pessoa real (mesmo Clerk ID) pode precisar existir como:
--   • Admin de tenant X  (tenant_id setado, platform_role NULL)
--   • Platform Owner     (tenant_id NULL,    platform_role = 'PLATFORM_OWNER')
-- O CHECK XOR introduzido na 0016 separa corretamente os papéis dentro de
-- uma row, mas o UNIQUE global em clerk_id impedia as DUAS rows pra
-- mesma pessoa.
--
-- Solução: UNIQUE composto (clerk_id, tenant_id) — PARTIAL onde
-- clerk_id IS NOT NULL. Garante:
--   • 1 row por (clerk_id, tenant_id) quando há clerk_id real
--   • exatamente 1 row de Platform Owner (clerk_id, NULL) por pessoa
--   • users de seed/fixture com clerk_id NULL podem ter N por tenant
--     sem violar (são massa de teste, não fazem login real)
--
-- Histórico: a versão NULLS NOT DISTINCT (Postgres 15+) parecia mais
-- elegante mas tratava cada NULL como duplicata, bloqueando o deploy
-- contra bancos com seed (30 rows clerk_id NULL × 3 tenants).

DROP INDEX IF EXISTS users_clerk_id_key;

CREATE UNIQUE INDEX users_clerk_id_tenant_id_key
  ON users (clerk_id, tenant_id)
  WHERE clerk_id IS NOT NULL;

COMMENT ON INDEX users_clerk_id_tenant_id_key IS
  'Permite mesma pessoa (clerk_id) ter identidades distintas por tenant OU como Platform Owner (tenant_id NULL). Partial WHERE clerk_id IS NOT NULL — users de seed/teste sem clerkId podem existir em N rows sem violar.';
