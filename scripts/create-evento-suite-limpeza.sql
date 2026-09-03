-- EventoSuiteLimpeza — histórico de limpeza da suíte física (Etapa 4A).
-- Colunas snake_case, alinhadas ao Sequelize underscored:true.
-- NÃO alterar enums de ReservaHospedagem / ReservaSuite / EventoSuite.
-- NÃO executar contra produção/homologação sem autorização explícita.

CREATE TABLE IF NOT EXISTS EventoSuiteLimpeza (
  id INT NOT NULL AUTO_INCREMENT,
  id_evento_suite INT NOT NULL,
  id_reserva_hospedagem INT NOT NULL,
  id_reserva_suite INT NOT NULL,
  status ENUM('Pendente', 'EmAndamento', 'Concluida') NOT NULL DEFAULT 'Pendente',
  data_hora_inicio DATETIME NULL,
  id_usuario_inicio INT NULL,
  data_hora_fim DATETIME NULL,
  id_usuario_fim INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_limpeza_reserva_suite (id_reserva_hospedagem, id_evento_suite),
  KEY idx_limpeza_suite_status (id_evento_suite, status),
  KEY idx_limpeza_status (status),
  CONSTRAINT fk_limpeza_evento_suite
    FOREIGN KEY (id_evento_suite) REFERENCES EventoSuite (id),
  CONSTRAINT fk_limpeza_reserva_hospedagem
    FOREIGN KEY (id_reserva_hospedagem) REFERENCES ReservaHospedagem (id),
  CONSTRAINT fk_limpeza_reserva_suite
    FOREIGN KEY (id_reserva_suite) REFERENCES ReservaSuite (id),
  CONSTRAINT fk_limpeza_usuario_inicio
    FOREIGN KEY (id_usuario_inicio) REFERENCES Usuario (id),
  CONSTRAINT fk_limpeza_usuario_fim
    FOREIGN KEY (id_usuario_fim) REFERENCES Usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
