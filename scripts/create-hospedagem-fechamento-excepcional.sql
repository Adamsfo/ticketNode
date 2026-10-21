-- Fechamentos excepcionais da pousada (datas ou intervalos em que não há hospedagem).
-- Regra semanal (terça/quarta) permanece no código; esta tabela só cobre exceções.
-- NÃO executar em produção sem backup e autorização explícita.

CREATE TABLE IF NOT EXISTS HospedagemFechamentoExcepcional (
  id INT NOT NULL AUTO_INCREMENT,
  id_evento INT NOT NULL,
  data_inicio DATE NOT NULL,
  data_fim DATE NOT NULL,
  motivo VARCHAR(500) NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  id_usuario_criacao INT NULL,
  id_usuario_atualizacao INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_hfe_evento_ativo_datas (id_evento, ativo, data_inicio, data_fim),
  CONSTRAINT fk_hfe_evento
    FOREIGN KEY (id_evento) REFERENCES Evento (id),
  CONSTRAINT fk_hfe_usuario_criacao
    FOREIGN KEY (id_usuario_criacao) REFERENCES Usuario (id),
  CONSTRAINT fk_hfe_usuario_atualizacao
    FOREIGN KEY (id_usuario_atualizacao) REFERENCES Usuario (id),
  CONSTRAINT chk_hfe_intervalo CHECK (data_fim >= data_inicio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
