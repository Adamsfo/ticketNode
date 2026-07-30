-- Fase 2: scheduler multi-provider (config, estado persistente, histórico de execuções).
-- ENV é apenas seed inicial; após a primeira carga o banco prevalece.

CREATE TABLE IF NOT EXISTS integration_provider_config (
  id INT NOT NULL AUTO_INCREMENT,
  provider VARCHAR(40) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  interval_minutes INT NOT NULL DEFAULT 5,
  mode VARCHAR(20) NOT NULL DEFAULT 'incremental',
  sync_limit INT NOT NULL DEFAULT 50,
  priority INT NOT NULL DEFAULT 100,
  max_retries INT NOT NULL DEFAULT 2,
  backoff_base_seconds INT NOT NULL DEFAULT 30,
  webhook_enabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_integration_provider_config (provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS integration_provider_state (
  id INT NOT NULL AUTO_INCREMENT,
  provider VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'IDLE',
  last_started_at DATETIME NULL,
  last_finished_at DATETIME NULL,
  last_success_at DATETIME NULL,
  last_error_at DATETIME NULL,
  last_error_message TEXT NULL,
  next_run_at DATETIME NULL,
  last_duration_ms INT NULL,
  consecutive_failures INT NOT NULL DEFAULT 0,
  last_execution_id INT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_integration_provider_state (provider),
  KEY idx_provider_state_next_run (next_run_at),
  KEY idx_provider_state_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS integration_sync_execution (
  id INT NOT NULL AUTO_INCREMENT,
  provider VARCHAR(40) NOT NULL,
  trigger_source VARCHAR(20) NOT NULL,
  mode VARCHAR(20) NULL,
  correlation_id VARCHAR(64) NOT NULL,
  started_at DATETIME NOT NULL,
  finished_at DATETIME NULL,
  duration_ms INT NULL,
  status VARCHAR(20) NOT NULL,
  imported INT NULL,
  validated INT NULL,
  validated_ready INT NULL,
  validated_ignored INT NULL,
  created_count INT NULL,
  updated_count INT NULL,
  cancelled_count INT NULL,
  failed_count INT NULL,
  skipped_count INT NULL,
  unchanged_count INT NULL,
  error_message TEXT NULL,
  summary_json JSON NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_sync_exec_provider_started (provider, started_at),
  KEY idx_sync_exec_status (status),
  KEY idx_sync_exec_correlation (correlation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
