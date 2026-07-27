-- Troca de suíte: histórico de movimentações (não substitui suite sem auditoria).
-- Executar no MySQL antes de usar os endpoints de troca.

CREATE TABLE IF NOT EXISTS ReservaSuiteMovimentacao (
  id INT NOT NULL AUTO_INCREMENT,
  idReservaHospedagem INT NOT NULL,
  idReservaSuite INT NOT NULL,
  idEventoSuiteOrigem INT NOT NULL,
  idEventoSuiteDestino INT NOT NULL,
  idUsuario INT NOT NULL,
  dataHora DATETIME NOT NULL,
  motivo VARCHAR(255) NULL,
  tipo VARCHAR(40) NOT NULL DEFAULT 'TRANSFERENCIA',
  createdAt DATETIME NULL,
  updatedAt DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_mov_reserva (idReservaHospedagem),
  KEY idx_mov_suite_linha (idReservaSuite),
  CONSTRAINT fk_mov_reserva
    FOREIGN KEY (idReservaHospedagem) REFERENCES ReservaHospedagem (id),
  CONSTRAINT fk_mov_reserva_suite
    FOREIGN KEY (idReservaSuite) REFERENCES ReservaSuite (id),
  CONSTRAINT fk_mov_suite_origem
    FOREIGN KEY (idEventoSuiteOrigem) REFERENCES EventoSuite (id),
  CONSTRAINT fk_mov_suite_destino
    FOREIGN KEY (idEventoSuiteDestino) REFERENCES EventoSuite (id),
  CONSTRAINT fk_mov_usuario
    FOREIGN KEY (idUsuario) REFERENCES Usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
