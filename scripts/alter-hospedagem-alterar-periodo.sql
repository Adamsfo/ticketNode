-- Alteração de período da reserva: histórico (não sobrescreve sem auditoria).
-- Executar no MySQL antes de usar o endpoint de alterar período.

CREATE TABLE IF NOT EXISTS ReservaPeriodoMovimentacao (
  id INT NOT NULL AUTO_INCREMENT,
  idReservaHospedagem INT NOT NULL,
  idUsuario INT NOT NULL,
  dataHora DATETIME NOT NULL,
  checkinAnterior DATETIME NOT NULL,
  checkoutAnterior DATETIME NOT NULL,
  checkinNovo DATETIME NOT NULL,
  checkoutNovo DATETIME NOT NULL,
  motivo VARCHAR(255) NULL,
  tipo VARCHAR(40) NOT NULL DEFAULT 'ALTERACAO',
  createdAt DATETIME NULL,
  updatedAt DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_periodo_mov_reserva (idReservaHospedagem),
  CONSTRAINT fk_periodo_mov_reserva
    FOREIGN KEY (idReservaHospedagem) REFERENCES ReservaHospedagem (id),
  CONSTRAINT fk_periodo_mov_usuario
    FOREIGN KEY (idUsuario) REFERENCES Usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
