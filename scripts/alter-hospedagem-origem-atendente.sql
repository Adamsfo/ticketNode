-- Origem SITE/ATENDENTE + idUsuarioCriacao
-- Execute após scripts de pagamento. Ajuste se alguma coluna já existir.

-- Se a coluna origemReserva ainda não existir:
-- ALTER TABLE ReservaHospedagem
--   ADD COLUMN origemReserva ENUM('SITE', 'ATENDENTE') NOT NULL DEFAULT 'SITE'
--   AFTER comprovantePagamento;

-- Se origemReserva já existir como CLIENTE/ATENDENTE:
ALTER TABLE ReservaHospedagem
  MODIFY COLUMN origemReserva VARCHAR(20) NOT NULL DEFAULT 'SITE';

UPDATE ReservaHospedagem
SET origemReserva = 'SITE'
WHERE origemReserva IS NULL
   OR origemReserva = ''
   OR origemReserva = 'CLIENTE';

UPDATE ReservaHospedagem rh
SET rh.origemReserva = 'ATENDENTE'
WHERE rh.formaPagamentoRecepcao IS NOT NULL
   OR rh.comprovantePagamento IS NOT NULL
   OR EXISTS (
     SELECT 1 FROM PagamentoHospedagem p
     WHERE p.idReservaHospedagem = rh.id
   );

ALTER TABLE ReservaHospedagem
  MODIFY COLUMN origemReserva ENUM('SITE', 'ATENDENTE') NOT NULL DEFAULT 'SITE';

ALTER TABLE ReservaHospedagem
  ADD COLUMN idUsuarioCriacao INT NULL AFTER origemReserva;
