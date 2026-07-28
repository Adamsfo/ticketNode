-- Etapa 4 — mapeamento permanente Hospedin place ↔ EventoSuite.
-- Não altera ReservaHospedagem / ReservaSuite / pagamentos / tickets.
-- Soft deactivate via coluna `ativo` (sem exclusão física).

CREATE TABLE IF NOT EXISTS hospedin_place_suite_map (
  id INT NOT NULL AUTO_INCREMENT,
  provider VARCHAR(40) NOT NULL DEFAULT 'HOSPEDIN',
  place_id BIGINT NOT NULL,
  id_evento_suite INT NOT NULL,
  id_evento INT NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  notes VARCHAR(255) NULL,
  mapped_at DATETIME NOT NULL,
  mapped_by INT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hospedin_place_suite_place (place_id),
  UNIQUE KEY uq_hospedin_place_suite_evento_suite (id_evento_suite),
  KEY idx_hospedin_place_suite_ativo (ativo),
  KEY idx_hospedin_place_suite_evento (id_evento),
  KEY idx_hospedin_place_suite_provider (provider),
  CONSTRAINT fk_hospedin_place_suite_evento_suite
    FOREIGN KEY (id_evento_suite) REFERENCES EventoSuite (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
