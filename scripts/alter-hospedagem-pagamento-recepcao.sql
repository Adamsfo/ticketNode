-- Pagamento antecipado / múltiplos pagamentos (recepção)
-- Executar após alter-hospedagem-desconto-recepcao.sql

ALTER TABLE ReservaHospedagem
  ADD COLUMN valorPago DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER valorTotal,
  ADD COLUMN saldoPendente DECIMAL(14,2) NULL AFTER valorPago,
  ADD COLUMN formaPagamentoRecepcao VARCHAR(40) NULL AFTER saldoPendente,
  ADD COLUMN observacaoPagamento TEXT NULL AFTER formaPagamentoRecepcao,
  ADD COLUMN comprovantePagamento VARCHAR(255) NULL AFTER observacaoPagamento;

CREATE TABLE IF NOT EXISTS PagamentoHospedagem (
  id INT NOT NULL AUTO_INCREMENT,
  idReservaHospedagem INT NOT NULL,
  valor DECIMAL(14,2) NOT NULL,
  dataPagamento DATETIME NOT NULL,
  formaPagamento VARCHAR(40) NOT NULL,
  comprovante VARCHAR(255) NULL,
  observacao TEXT NULL,
  idUsuario INT NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pagamento_hospedagem_reserva (idReservaHospedagem),
  CONSTRAINT fk_pagamento_hospedagem_reserva
    FOREIGN KEY (idReservaHospedagem) REFERENCES ReservaHospedagem (id),
  CONSTRAINT fk_pagamento_hospedagem_usuario
    FOREIGN KEY (idUsuario) REFERENCES Usuario (id)
);
