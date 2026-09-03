-- Registro de chegada física (sem check-in operacional)
-- Executar no MySQL após os scripts de check-in/check-out.
-- Mantém status Confirmada; não altera ReservaSuite.

ALTER TABLE ReservaHospedagem
  ADD COLUMN data_hora_chegada_real DATETIME NULL AFTER id_usuario_checkout,
  ADD COLUMN id_usuario_chegada INT NULL AFTER data_hora_chegada_real;

ALTER TABLE ReservaHospedagem
  ADD CONSTRAINT fk_reserva_hospedagem_usuario_chegada
    FOREIGN KEY (id_usuario_chegada) REFERENCES Usuario (id);
