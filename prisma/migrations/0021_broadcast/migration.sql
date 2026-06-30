-- Sprint 15B — Broadcasts (substitui MaintenanceBanner da Sprint 14.5)

CREATE TYPE "BroadcastVariant" AS ENUM ('INFO','WARNING','DANGER','SUCCESS');
CREATE TYPE "BroadcastTarget"  AS ENUM ('ALL','BY_PLAN','MANUAL_LIST');

CREATE TABLE broadcasts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  message           TEXT NOT NULL,
  variant           "BroadcastVariant" NOT NULL DEFAULT 'INFO',
  target            "BroadcastTarget"  NOT NULL,
  target_plans      TEXT[] NOT NULL DEFAULT '{}',
  target_tenant_ids UUID[] NOT NULL DEFAULT '{}',
  starts_at         TIMESTAMP(3) NOT NULL,
  ends_at           TIMESTAMP(3),
  action_label      TEXT,
  action_url        TEXT,
  dismissible       BOOLEAN NOT NULL DEFAULT true,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMP(3) NOT NULL DEFAULT now(),
  created_by        UUID
);
CREATE INDEX broadcasts_active_window_idx ON broadcasts (active, starts_at, ends_at);

CREATE TABLE broadcast_dismissals (
  broadcast_id UUID NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  dismissed_at TIMESTAMP(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (broadcast_id, user_id)
);
CREATE INDEX broadcast_dismissals_user_idx ON broadcast_dismissals (user_id);

-- broadcasts é global (não scope by tenant — Platform gerencia).
-- broadcast_dismissals: cada user marca os seus; acesso controlado em código.
ALTER TABLE broadcasts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcasts             FORCE ROW LEVEL SECURITY;
ALTER TABLE broadcast_dismissals   ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_dismissals   FORCE ROW LEVEL SECURITY;
-- Política aberta — restrição real fica no app/router (platformProcedure
-- e RLS lógico no service); ainda assim RLS ENABLED + FORCE pra exigir
-- policy explícita se alguém tentar mutar via SQL puro.
CREATE POLICY broadcasts_open ON broadcasts USING (true) WITH CHECK (true);
CREATE POLICY broadcast_dismissals_open ON broadcast_dismissals USING (true) WITH CHECK (true);
