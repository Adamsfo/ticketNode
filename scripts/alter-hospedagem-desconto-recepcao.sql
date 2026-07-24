-- Desconto manual exclusivo da recepção (Nova Reserva)
-- Executar após alter-hospedagem-observacoes.sql

ALTER TABLE ReservaSuite
  ADD COLUMN valorOriginal DECIMAL(14,2) NULL AFTER valorTotal,
  ADD COLUMN descontoTipo ENUM('PERCENTUAL', 'VALOR') NULL AFTER valorOriginal,
  ADD COLUMN descontoValor DECIMAL(14,2) NULL AFTER descontoTipo,
  ADD COLUMN valorFinal DECIMAL(14,2) NULL AFTER descontoValor;
