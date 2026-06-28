-- Sprint 10: Web Push subscriptions

CREATE TABLE push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL,
  endpoint      TEXT NOT NULL UNIQUE,
  p256dh_key    TEXT NOT NULL,
  auth_key      TEXT NOT NULL,
  user_agent    TEXT,
  last_seen_at  TIMESTAMP(3) NOT NULL DEFAULT now(),
  created_at    TIMESTAMP(3) NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMP(3)
);

CREATE INDEX push_subscriptions_tenant_user_idx
  ON push_subscriptions(tenant_id, user_id);

SELECT enable_tenant_rls('push_subscriptions');
