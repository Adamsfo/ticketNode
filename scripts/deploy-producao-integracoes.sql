-- =============================================================================
-- deploy-producao-integracoes.sql
--
-- Pacote PRODUÇÃO — estruturas Integração / Hospedin (backend novo)
-- Executar manualmente no MySQL Workbench. NÃO executar automaticamente.
--
-- Pré-requisitos:
--   - deploy-producao-hospedagem.sql já aplicado
--   - alter-producao-origem-reserva-varchar.sql já aplicado (se necessário)
--
-- Escopo:
--   CREATE TABLE + índices + FKs das tabelas de integração ausentes na PROD
--   INSERT idempotente de integration_provider_config + integration_provider_state
--   (providers HOSPEDIN e HOSPEDIN_OUTBOUND, enabled=0 / DISABLED)
--
-- Exclui: DROP, UPDATE, DELETE, TRUNCATE, cópia de dados operacionais do DEV,
--         AUTO_INCREMENT sync, credenciais/API keys (não existem nestas tabelas).
-- =============================================================================

SET NAMES utf8mb4;
SET @db := DATABASE();

-- =============================================================================
-- SEÇÃO 1 — Scheduler multi-provider (integration_*)
-- Origem: create-integration-scheduler-fase2.sql + alter-integration-scheduler-heartbeat.sql
-- =============================================================================

-- [CREATE TABLE] integration_provider_config
-- Motivo: configuração persistida do scheduler (ProviderConfigService).
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
  max_run_minutes INT NOT NULL DEFAULT 10,
  webhook_enabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_integration_provider_config (provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- [CREATE TABLE] integration_provider_state
-- Motivo: estado runtime do scheduler por provider.
CREATE TABLE IF NOT EXISTS integration_provider_state (
  id INT NOT NULL AUTO_INCREMENT,
  provider VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'IDLE',
  last_started_at DATETIME NULL,
  heartbeat_at DATETIME NULL,
  last_finished_at DATETIME NULL,
  last_success_at DATETIME NULL,
  last_error_at DATETIME NULL,
  last_error_message TEXT NULL,
  next_run_at DATETIME NULL,
  last_duration_ms INT NULL,
  consecutive_failures INT NOT NULL DEFAULT 0,
  last_execution_id INT NULL,
  has_pending TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_integration_provider_state (provider),
  KEY idx_provider_state_next_run (next_run_at),
  KEY idx_provider_state_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- [CREATE TABLE] integration_sync_execution
-- Motivo: histórico de execuções do scheduler (estrutura vazia na PROD).
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
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sync_exec_provider_started (provider, started_at),
  KEY idx_sync_exec_status (status),
  KEY idx_sync_exec_correlation (correlation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- [CREATE TABLE] integration_sync_state
-- Motivo: estado persistente de sincronização (fonte oficial do pipeline).
-- Origem: create-integration-sync-state.sql + alter-integration-sync-state-internal-entity.sql
--         + alter-integration-sync-state-sync-version.sql + alter-integration-sync-monitor.sql
--         + alter-integration-resolution-status.sql (somente coluna/índice; sem UPDATEs)
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
  next_retry_at DATETIME NULL,
  last_validation_at DATETIME NULL,
  last_sync_at DATETIME NULL,
  last_success_at DATETIME NULL,
  last_error TEXT NULL,
  error_code VARCHAR(64) NULL,
  error_severityity VARCHAR(20) NULL,
  resolution_status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_integration_sync_identity (provider, entity_type, external_id),
  KEY idx_integration_sync_status (sync_status),
  KEY idx_integration_sync_provider_entity (provider, entity_type),
  KEY idx_integration_sync_correlation (correlation_id),
  KEY idx_sync_state_status_entity (entity_type, sync_status),
  KEY idx_sync_state_internal (internal_entity_id),
  KEY idx_sync_state_severityity (error_severityity, sync_status),
  KEY idx_sync_state_next_retry (next_retry_at, sync_status),
  KEY idx_sync_state_resolution (resolution_status, sync_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- [CREATE TABLE] integration_entity_sync_event
-- Motivo: histórico por entidade (monitoramento visual).
-- Origem: alter-integration-sync-monitor.sql
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
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_entity_sync_ext (provider, entity_type, external_id, created_at),
  KEY idx_entity_sync_internal (internal_entity_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================================================
-- SEÇÃO 2 — Staging Hospedin (import)
-- Origem: create-hospedin-integration.sql + alter-hospedagem-sync-log (colunas sucesso/erro)
-- Colunas created_at/updated_at: padrão underscored do Sequelize em DEV/PROD
-- =============================================================================

-- [CREATE TABLE] hospedin_place_types
CREATE TABLE IF NOT EXISTS hospedin_place_types (
  id INT NOT NULL AUTO_INCREMENT,
  place_type_id BIGINT NOT NULL,
  nome VARCHAR(255) NOT NULL,
  capacidade INT NULL,
  payload_json JSON NULL,
  synced_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hospedin_place_type_id (place_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- [CREATE TABLE] hospedin_places
CREATE TABLE IF NOT EXISTS hospedin_places (
  id INT NOT NULL AUTO_INCREMENT,
  place_id BIGINT NOT NULL,
  place_type_id BIGINT NULL,
  nome VARCHAR(255) NOT NULL,
  capacidade INT NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  payload_json JSON NULL,
  synced_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hospedin_place_id (place_id),
  KEY idx_hospedin_places_place_type (place_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- [CREATE TABLE] hospedin_reservations
CREATE TABLE IF NOT EXISTS hospedin_reservations (
  id INT NOT NULL AUTO_INCREMENT,
  reservation_id BIGINT NOT NULL,
  status VARCHAR(64) NULL,
  checkin DATETIME NULL,
  checkout DATETIME NULL,
  payload_json JSON NULL,
  imported_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hospedin_reservation_id (reservation_id),
  KEY idx_hospedin_reservations_status (status),
  KEY idx_hospedin_reservations_checkin (checkin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- [CREATE TABLE] hospedin_sync_log
CREATE TABLE IF NOT EXISTS hospedin_sync_log (
  id INT NOT NULL AUTO_INCREMENT,
  operacao VARCHAR(80) NOT NULL,
  endpoint VARCHAR(512) NULL,
  metodo VARCHAR(16) NULL,
  request_json JSON NULL,
  response_json JSON NULL,
  status INT NULL,
  duracao_ms INT NULL,
  sucesso TINYINT(1) NOT NULL DEFAULT 0,
  erro TEXT NULL,
  data DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_hospedin_sync_log_operacao (operacao),
  KEY idx_hospedin_sync_log_data (data),
  KEY idx_hospedin_sync_log_sucesso (sucesso)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================================================
-- SEÇÃO 3 — Mapeamento e outbound Hospedin
-- Origem: create-hospedin-place-suite-map.sql + alter-hospedin-place-suite-map-ignored.sql
--         create-hospedin-outbound-sync-state.sql + alter-hospedin-outbound-synced-hash-input.sql
-- =============================================================================

-- [CREATE TABLE] hospedin_place_suite_map
CREATE TABLE IF NOT EXISTS hospedin_place_suite_map (
  id INT NOT NULL AUTO_INCREMENT,
  provider VARCHAR(40) NOT NULL DEFAULT 'HOSPEDIN',
  place_id BIGINT NOT NULL,
  id_evento_suite INT NULL,
  id_evento INT NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  mapping_status VARCHAR(20) NOT NULL DEFAULT 'LINKED',
  notes VARCHAR(255) NULL,
  mapped_at DATETIME NOT NULL,
  mapped_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hospedin_place_suite_place (place_id),
  UNIQUE KEY uq_hospedin_place_suite_evento_suite (id_evento_suite),
  KEY idx_hospedin_place_suite_ativo (ativo),
  KEY idx_hospedin_place_suite_mapping_status (mapping_status, ativo),
  KEY idx_hospedin_place_suite_evento (id_evento),
  KEY idx_hospedin_place_suite_provider (provider),
  CONSTRAINT fk_hospedin_place_suite_evento_suite
    FOREIGN KEY (id_evento_suite) REFERENCES EventoSuite (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- [CREATE TABLE] hospedin_outbound_sync_state
CREATE TABLE IF NOT EXISTS hospedin_outbound_sync_state (
  id INT NOT NULL AUTO_INCREMENT,
  id_reserva_hospedagem INT NOT NULL,
  outbound_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_CREATE',
  desired_action VARCHAR(16) NOT NULL DEFAULT 'CREATE',
  payload_hash VARCHAR(64) NULL,
  pending_payload_hash VARCHAR(64) NULL,
  synced_hash_input_json TEXT NULL,
  hospedin_reservation_id VARCHAR(64) NULL,
  hospedin_guest_id VARCHAR(64) NULL,
  retry_count INT NOT NULL DEFAULT 0,
  next_retry_at DATETIME NULL,
  last_error TEXT NULL,
  error_code VARCHAR(64) NULL,
  last_sync_at DATETIME NULL,
  last_success_at DATETIME NULL,
  processing_started_at DATETIME NULL,
  processing_correlation_id VARCHAR(64) NULL,
  dirty_at DATETIME NOT NULL,
  outbound_version INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hospedin_outbound_reserva (id_reserva_hospedagem),
  KEY idx_hospedin_outbound_status_dirty (outbound_status, dirty_at),
  KEY idx_hospedin_outbound_next_retry (next_retry_at),
  CONSTRAINT fk_hospedin_outbound_reserva
    FOREIGN KEY (id_reserva_hospedagem) REFERENCES ReservaHospedagem (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================================================
-- SEÇÃO 4 — Espelhos de origem multi-provedor (fase 1)
-- Origem: alter-reserva-origem-integracao-fase1.sql (somente tabelas)
-- Nota: colunas em ReservaHospedagem já devem existir via pacote hospedagem.
-- =============================================================================

-- [CREATE TABLE] reserva_identificador_externo
CREATE TABLE IF NOT EXISTS reserva_identificador_externo (
  id INT NOT NULL AUTO_INCREMENT,
  id_reserva_hospedagem INT NOT NULL,
  provider VARCHAR(40) NOT NULL,
  tipo VARCHAR(40) NOT NULL,
  valor VARCHAR(128) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reserva_ident_provider_tipo (id_reserva_hospedagem, provider, tipo),
  UNIQUE KEY uq_provider_tipo_valor (provider, tipo, valor),
  KEY idx_reserva_ident_reserva (id_reserva_hospedagem),
  CONSTRAINT fk_reserva_ident_hosp
    FOREIGN KEY (id_reserva_hospedagem) REFERENCES ReservaHospedagem (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- [CREATE TABLE] reserva_origem_financeira
CREATE TABLE IF NOT EXISTS reserva_origem_financeira (
  id INT NOT NULL AUTO_INCREMENT,
  id_reserva_hospedagem INT NOT NULL,
  provider VARCHAR(40) NOT NULL,
  moeda CHAR(3) NULL,
  total_cents INT NULL,
  received_cents INT NULL,
  to_receive_cents INT NULL,
  daily_cents INT NULL,
  total_daily_cents INT NULL,
  discount_cents INT NULL,
  product_cents INT NULL,
  service_cents INT NULL,
  items_count INT NULL,
  payment_from_ota TINYINT(1) NULL,
  status_pagamento VARCHAR(64) NULL,
  forma_pagamento VARCHAR(64) NULL,
  origem_pagamento VARCHAR(40) NULL,
  responsavel_pagamento VARCHAR(64) NULL,
  raw_json JSON NULL,
  payload_hash VARCHAR(64) NULL,
  synced_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reserva_origem_fin_provider (id_reserva_hospedagem, provider),
  KEY idx_reserva_origem_fin_provider (provider),
  CONSTRAINT fk_reserva_origem_fin_hosp
    FOREIGN KEY (id_reserva_hospedagem) REFERENCES ReservaHospedagem (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- [CREATE TABLE] reserva_origem_payload
CREATE TABLE IF NOT EXISTS reserva_origem_payload (
  id INT NOT NULL AUTO_INCREMENT,
  id_reserva_hospedagem INT NOT NULL,
  provider VARCHAR(40) NOT NULL,
  kind VARCHAR(40) NOT NULL,
  external_id VARCHAR(64) NULL,
  payload_json JSON NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  captured_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reserva_origem_payload (id_reserva_hospedagem, provider, kind),
  KEY idx_reserva_origem_payload_ext (provider, external_id),
  CONSTRAINT fk_reserva_origem_payload_hosp
    FOREIGN KEY (id_reserva_hospedagem) REFERENCES ReservaHospedagem (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- [CREATE TABLE] reserva_hospede_documento
CREATE TABLE IF NOT EXISTS reserva_hospede_documento (
  id INT NOT NULL AUTO_INCREMENT,
  id_reserva_hospede INT NOT NULL,
  provider VARCHAR(40) NULL,
  tipo VARCHAR(40) NOT NULL,
  numero VARCHAR(80) NOT NULL,
  pais_emissao VARCHAR(8) NULL,
  observacao VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reserva_hosp_doc_tipo (id_reserva_hospede, tipo),
  KEY idx_reserva_hosp_doc_hospede (id_reserva_hospede),
  CONSTRAINT fk_reserva_hosp_doc_hospede
    FOREIGN KEY (id_reserva_hospede) REFERENCES ReservaHospede (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================================================
-- SEÇÃO 5 — Configuração do scheduler (DESABILITADA — sem sincronização)
--
-- DEV (compare): integration_provider_config com AUTO_INCREMENT=3 → 2 providers.
-- Registro equivalente ao DEV desabilitado, alinhado a HospedinSyncProvider /
-- HospedinOutboundSyncProvider (ProviderConfigService.ensureProviderConfigsFromRegistry).
--
-- Campos sensíveis: NENHUM nesta tabela (credenciais Hospedin ficam em variáveis
-- de ambiente: HOSPEDIN_API_*, não são copiadas neste script).
--
-- IDs: não copiados — AUTO_INCREMENT na PROD.
-- =============================================================================

-- [INSERT] integration_provider_config — HOSPEDIN (enabled=0)
INSERT INTO integration_provider_config (
  provider,
  display_name,
  enabled,
  interval_minutes,
  mode,
  sync_limit,
  priority,
  max_retries,
  backoff_base_seconds,
  max_run_minutes,
  webhook_enabled,
  created_at,
  updated_at
)
SELECT
  'HOSPEDIN',
  'Hospedin',
  0,
  5,
  'incremental',
  50,
  100,
  2,
  30,
  10,
  0,
  NOW(),
  NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM integration_provider_config WHERE provider = 'HOSPEDIN'
);

-- [INSERT] integration_provider_config — HOSPEDIN_OUTBOUND (enabled=0)
INSERT INTO integration_provider_config (
  provider,
  display_name,
  enabled,
  interval_minutes,
  mode,
  sync_limit,
  priority,
  max_retries,
  backoff_base_seconds,
  max_run_minutes,
  webhook_enabled,
  created_at,
  updated_at
)
SELECT
  'HOSPEDIN_OUTBOUND',
  'Hospedin Outbound',
  0,
  15,
  'incremental',
  30,
  110,
  5,
  30,
  10,
  0,
  NOW(),
  NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM integration_provider_config WHERE provider = 'HOSPEDIN_OUTBOUND'
);

-- [INSERT] integration_provider_state — HOSPEDIN (DISABLED, sem agendamento)
INSERT INTO integration_provider_state (
  provider,
  status,
  next_run_at,
  consecutive_failures,
  has_pending,
  created_at,
  updated_at
)
SELECT
  'HOSPEDIN',
  'DISABLED',
  NULL,
  0,
  0,
  NOW(),
  NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM integration_provider_state WHERE provider = 'HOSPEDIN'
);

-- [INSERT] integration_provider_state — HOSPEDIN_OUTBOUND (DISABLED)
INSERT INTO integration_provider_state (
  provider,
  status,
  next_run_at,
  consecutive_failures,
  has_pending,
  created_at,
  updated_at
)
SELECT
  'HOSPEDIN_OUTBOUND',
  'DISABLED',
  NULL,
  0,
  0,
  NOW(),
  NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM integration_provider_state WHERE provider = 'HOSPEDIN_OUTBOUND'
);

-- =============================================================================
-- FIM deploy-producao-integracoes.sql
-- =============================================================================
