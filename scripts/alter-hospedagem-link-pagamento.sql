-- Link público para o cliente finalizar pagamento da reserva (recepção).
-- Preparado para expiração futura via coluna expiraEm (nullable = sem expiração automática).

ALTER TABLE ReservaHospedagem
  ADD COLUMN tokenPagamento VARCHAR(64) NULL UNIQUE AFTER idTransacao,
  ADD COLUMN expiraEm DATETIME NULL AFTER tokenPagamento,
  ADD COLUMN linkPagamentoEnviadoEm DATETIME NULL AFTER expiraEm;
