-- Origem da reserva (cliente online vs atendente/recepção)
-- Executar após alter-hospedagem-pagamento-recepcao.sql

ALTER TABLE ReservaHospedagem
  ADD COLUMN origemReserva ENUM('CLIENTE', 'ATENDENTE') NOT NULL DEFAULT 'CLIENTE'
  AFTER comprovantePagamento;

-- Marca como ATENDENTE reservas que já têm pagamento de recepção
UPDATE ReservaHospedagem rh
SET rh.origemReserva = 'ATENDENTE'
WHERE rh.formaPagamentoRecepcao IS NOT NULL
   OR rh.comprovantePagamento IS NOT NULL
   OR EXISTS (
     SELECT 1 FROM PagamentoHospedagem p
     WHERE p.idReservaHospedagem = rh.id
   );
