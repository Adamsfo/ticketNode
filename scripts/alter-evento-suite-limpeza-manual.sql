-- Limpeza manual de suíte (sem ReservaHospedagem / ReservaSuite).
-- NÃO executar contra produção/homologação sem autorização explícita.
-- Preserva dados existentes: todas as linhas atuais permanecem origem CHECKOUT.

ALTER TABLE EventoSuiteLimpeza
  ADD COLUMN origem ENUM('CHECKOUT', 'MANUAL') NOT NULL DEFAULT 'CHECKOUT'
    AFTER status;

UPDATE EventoSuiteLimpeza
  SET origem = 'CHECKOUT'
  WHERE origem IS NULL OR origem = '';

ALTER TABLE EventoSuiteLimpeza
  MODIFY COLUMN id_reserva_hospedagem INT NULL,
  MODIFY COLUMN id_reserva_suite INT NULL;

-- Mantém uq_limpeza_reserva_suite para idempotência do checkout.
-- Limpezas MANUAL (id_reserva_hospedagem NULL) não usam essa UNIQUE;
-- duplicidade aberta por suíte é garantida no service (transação + lock).
