-- Serviços adicionais por linha de suíte (recepção/PDV).
-- NÃO executar em produção sem autorização explícita.

CREATE TABLE IF NOT EXISTS ReservaSuiteItemServico (
  id INT NOT NULL AUTO_INCREMENT,
  id_reserva_suite INT NOT NULL,
  descricao VARCHAR(500) NOT NULL,
  valor DECIMAL(14, 2) NOT NULL,
  ordem INT NOT NULL DEFAULT 1,
  id_usuario_criacao INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_reserva_suite_item_servico_suite (id_reserva_suite),
  KEY idx_reserva_suite_item_servico_ordem (id_reserva_suite, ordem),
  CONSTRAINT fk_reserva_suite_item_servico_suite
    FOREIGN KEY (id_reserva_suite) REFERENCES ReservaSuite (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_reserva_suite_item_servico_usuario
    FOREIGN KEY (id_usuario_criacao) REFERENCES Usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
