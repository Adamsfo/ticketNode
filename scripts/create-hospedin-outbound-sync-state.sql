-- Outbound Jango → Hospedin: fila assíncrona por reserva (separada do sync inbound).
-- Não mistura com integration_sync_state.

CREATE TABLE IF NOT EXISTS hospedin_outbound_sync_state (
  id INT NOT NULL AUTO_INCREMENT,
  id_reserva_hospedagem INT NOT NULL,
  outbound_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_CREATE',
  desired_action VARCHAR(16) NOT NULL DEFAULT 'CREATE',
  payload_hash VARCHAR(64) NULL,
  pending_payload_hash VARCHAR(64) NULL,
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
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hospedin_outbound_reserva (id_reserva_hospedagem),
  KEY idx_hospedin_outbound_status_dirty (outbound_status, dirty_at),
  KEY idx_hospedin_outbound_next_retry (next_retry_at),
  CONSTRAINT fk_hospedin_outbound_reserva
    FOREIGN KEY (id_reserva_hospedagem) REFERENCES ReservaHospedagem (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
