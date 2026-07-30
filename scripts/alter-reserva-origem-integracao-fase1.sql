-- Fase 1: origem multi-provedor (códigos, canal, financeiro espelho, payload, documentos).
-- Colunas físicas em snake_case (Sequelize underscored).
-- Não altera o financeiro oficial do Jango.

-- ── ReservaHospedagem: atalhos operacionais ─────────────────────────
ALTER TABLE ReservaHospedagem
  ADD COLUMN id_externo VARCHAR(64) NULL AFTER origem_reserva,
  ADD COLUMN codigo_externo VARCHAR(64) NULL AFTER id_externo,
  ADD COLUMN canal_venda VARCHAR(40) NULL AFTER codigo_externo;

CREATE INDEX idx_reserva_hosp_origem_id_externo
  ON ReservaHospedagem (origem_reserva, id_externo);
CREATE INDEX idx_reserva_hosp_codigo_externo
  ON ReservaHospedagem (codigo_externo);
CREATE INDEX idx_reserva_hosp_canal_venda
  ON ReservaHospedagem (canal_venda);

-- ── Identificadores externos adicionais ─────────────────────────────
CREATE TABLE IF NOT EXISTS reserva_identificador_externo (
  id INT NOT NULL AUTO_INCREMENT,
  id_reserva_hospedagem INT NOT NULL,
  provider VARCHAR(40) NOT NULL,
  tipo VARCHAR(40) NOT NULL,
  valor VARCHAR(128) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reserva_ident_provider_tipo (id_reserva_hospedagem, provider, tipo),
  UNIQUE KEY uq_provider_tipo_valor (provider, tipo, valor),
  KEY idx_reserva_ident_reserva (id_reserva_hospedagem),
  CONSTRAINT fk_reserva_ident_hosp
    FOREIGN KEY (id_reserva_hospedagem) REFERENCES ReservaHospedagem (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Espelho financeiro da origem (não oficial) ──────────────────────
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
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reserva_origem_fin_provider (id_reserva_hospedagem, provider),
  KEY idx_reserva_origem_fin_provider (provider),
  CONSTRAINT fk_reserva_origem_fin_hosp
    FOREIGN KEY (id_reserva_hospedagem) REFERENCES ReservaHospedagem (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Payload bruto vinculado à reserva Jango ─────────────────────────
CREATE TABLE IF NOT EXISTS reserva_origem_payload (
  id INT NOT NULL AUTO_INCREMENT,
  id_reserva_hospedagem INT NOT NULL,
  provider VARCHAR(40) NOT NULL,
  kind VARCHAR(40) NOT NULL,
  external_id VARCHAR(64) NULL,
  payload_json JSON NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  captured_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reserva_origem_payload (id_reserva_hospedagem, provider, kind),
  KEY idx_reserva_origem_payload_ext (provider, external_id),
  CONSTRAINT fk_reserva_origem_payload_hosp
    FOREIGN KEY (id_reserva_hospedagem) REFERENCES ReservaHospedagem (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Documentos do hóspede da reserva ────────────────────────────────
CREATE TABLE IF NOT EXISTS reserva_hospede_documento (
  id INT NOT NULL AUTO_INCREMENT,
  id_reserva_hospede INT NOT NULL,
  provider VARCHAR(40) NULL,
  tipo VARCHAR(40) NOT NULL,
  numero VARCHAR(80) NOT NULL,
  pais_emissao VARCHAR(8) NULL,
  observacao VARCHAR(255) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reserva_hosp_doc_tipo (id_reserva_hospede, tipo),
  KEY idx_reserva_hosp_doc_hospede (id_reserva_hospede),
  CONSTRAINT fk_reserva_hosp_doc_hospede
    FOREIGN KEY (id_reserva_hospede) REFERENCES ReservaHospede (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
