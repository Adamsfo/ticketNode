-- Monitoramento visual de sync por entidade (complemento Fases 1–2).

ALTER TABLE integration_sync_state
  ADD COLUMN error_code VARCHAR(64) NULL AFTER last_error,
  ADD COLUMN error_severityity VARCHAR(20) NULL AFTER error_code,
  ADD COLUMN last_success_at DATETIME NULL AFTER last_sync_at,
  ADD COLUMN next_retry_at DATETIME NULL AFTER retry_count;

CREATE INDEX idx_sync_state_status_entity
  ON integration_sync_state (entity_type, sync_status);
CREATE INDEX idx_sync_state_internal
  ON integration_sync_state (internal_entity_id);
CREATE INDEX idx_sync_state_severityity
  ON integration_sync_state (error_severityity, sync_status);
CREATE INDEX idx_sync_state_next_retry
  ON integration_sync_state (next_retry_at, sync_status);

CREATE TABLE IF NOT EXISTS integration_entity_sync_event (
  id INT NOT NULL AUTO_INCREMENT,
  provider VARCHAR(40) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  external_id VARCHAR(128) NOT NULL,
  internal_entity_id VARCHAR(64) NULL,
  operation VARCHAR(32) NOT NULL,
  result VARCHAR(20) NOT NULL,
  error_code VARCHAR(64) NULL,
  error_severityity VARCHAR(20) NULL,
  message TEXT NULL,
  duration_ms INT NULL,
  correlation_id VARCHAR(64) NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_entity_sync_ext (provider, entity_type, external_id, created_at),
  KEY idx_entity_sync_internal (internal_entity_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
