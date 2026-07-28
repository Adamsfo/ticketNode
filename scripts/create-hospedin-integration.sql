-- Integração Hospedin (Etapa 2) — staging only.
-- Não altera tabelas de ReservaHospedagem / EventoSuite.
-- Executar no MySQL antes de usar os endpoints de importação.

CREATE TABLE IF NOT EXISTS hospedin_place_types (
  id INT NOT NULL AUTO_INCREMENT,
  place_type_id BIGINT NOT NULL,
  nome VARCHAR(255) NOT NULL,
  capacidade INT NULL,
  payload_json JSON NULL,
  synced_at DATETIME NOT NULL,
  createdAt DATETIME NULL,
  updatedAt DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hospedin_place_type_id (place_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hospedin_places (
  id INT NOT NULL AUTO_INCREMENT,
  place_id BIGINT NOT NULL,
  place_type_id BIGINT NULL,
  nome VARCHAR(255) NOT NULL,
  capacidade INT NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  payload_json JSON NULL,
  synced_at DATETIME NOT NULL,
  createdAt DATETIME NULL,
  updatedAt DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hospedin_place_id (place_id),
  KEY idx_hospedin_places_place_type (place_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hospedin_reservations (
  id INT NOT NULL AUTO_INCREMENT,
  reservation_id BIGINT NOT NULL,
  status VARCHAR(64) NULL,
  checkin DATETIME NULL,
  checkout DATETIME NULL,
  payload_json JSON NULL,
  imported_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hospedin_reservation_id (reservation_id),
  KEY idx_hospedin_reservations_status (status),
  KEY idx_hospedin_reservations_checkin (checkin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
  createdAt DATETIME NULL,
  updatedAt DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_hospedin_sync_log_operacao (operacao),
  KEY idx_hospedin_sync_log_data (data),
  KEY idx_hospedin_sync_log_sucesso (sucesso)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
