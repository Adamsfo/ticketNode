-- Etapa 3.3 — estado persistente de sincronização (desacoplado do Jango).
-- Executar no MySQL antes de usar sync-state / validação com estado.
-- Se a tabela já existir sem internal_entity_id, rode:
--   alter-integration-sync-state-internal-entity.sql

CREATE TABLE IF NOT EXISTS integration_sync_state (
  id INT NOT NULL AUTO_INCREMENT,
  provider VARCHAR(40) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  external_id VARCHAR(128) NOT NULL,
  internal_entity_id VARCHAR(64) NULL,
  correlation_id VARCHAR(64) NOT NULL,
  validation_status VARCHAR(64) NULL,
  sync_action VARCHAR(32) NULL,
  sync_status VARCHAR(32) NOT NULL DEFAULT 'NEW',
  payload_hash VARCHAR(64) NULL,
  retry_count INT NOT NULL DEFAULT 0,
  sync_version INT NOT NULL DEFAULT 0,
  last_validation_at DATETIME NULL,
  last_sync_at DATETIME NULL,
  last_error TEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_integration_sync_identity (provider, entity_type, external_id),
  KEY idx_integration_sync_status (sync_status),
  KEY idx_integration_sync_provider_entity (provider, entity_type),
  KEY idx_integration_sync_correlation (correlation_id),
  KEY idx_integration_sync_internal_entity (internal_entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
