-- Operações SuperTEF exclusivas da Hospedagem (Receber Saldo).
-- Independente de Transacao / PagamentoPDV / payment_uniqueid de ingressos.

CREATE TABLE IF NOT EXISTS HospedagemPagamentoOperacao (
  id INT NOT NULL AUTO_INCREMENT,
  uuid VARCHAR(64) NOT NULL,
  tipo VARCHAR(30) NOT NULL DEFAULT 'HOSPEDAGEM',
  origem VARCHAR(40) NOT NULL DEFAULT 'RECEBER_SALDO',
  idReservaHospedagem INT NOT NULL,
  idUsuario INT NOT NULL,
  valor DECIMAL(14,2) NOT NULL,
  formaPagamento VARCHAR(40) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDENTE',
  orderIdSuperTef VARCHAR(64) NOT NULL,
  idExternoSuperTef VARCHAR(120) NULL,
  observacao TEXT NULL,
  mensagemStatus VARCHAR(255) NULL,
  rawInicio TEXT NULL,
  idPagamentoHospedagem INT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hospedagem_pagamento_operacao_uuid (uuid),
  UNIQUE KEY uq_hospedagem_pagamento_operacao_order (orderIdSuperTef),
  KEY idx_hosp_pag_op_reserva (idReservaHospedagem),
  KEY idx_hosp_pag_op_externo (idExternoSuperTef),
  CONSTRAINT fk_hosp_pag_op_reserva
    FOREIGN KEY (idReservaHospedagem) REFERENCES ReservaHospedagem (id),
  CONSTRAINT fk_hosp_pag_op_usuario
    FOREIGN KEY (idUsuario) REFERENCES Usuario (id)
);
