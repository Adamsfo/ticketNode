-- Heartbeat + timeout do Scheduler (resiliência RUNNING órfão).
-- Idempotente.

ALTER TABLE integration_provider_state
  ADD COLUMN IF NOT EXISTS heartbeat_at DATETIME NULL AFTER last_started_at;

ALTER TABLE integration_provider_config
  ADD COLUMN IF NOT EXISTS max_run_minutes INT NOT NULL DEFAULT 10 AFTER backoff_base_seconds;

-- MySQL < 8.0.12 não tem IF NOT EXISTS em ADD COLUMN — fallback via procedure abaixo não;
-- o script Node aplica com checagem de information_schema.
