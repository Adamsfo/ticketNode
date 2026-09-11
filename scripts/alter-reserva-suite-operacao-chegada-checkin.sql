-- Operação individual por ReservaSuite: chegada e check-in por linha.
-- Executar no MySQL após alter-hospedagem-chegada.sql e alter-hospedagem-checkin.sql.
-- Não altera campos existentes em ReservaHospedagem.

ALTER TABLE ReservaSuite
  ADD COLUMN data_hora_chegada_real DATETIME NULL AFTER hospedin_reservation_id,
  ADD COLUMN id_usuario_chegada INT NULL AFTER data_hora_chegada_real,
  ADD COLUMN data_hora_checkin_real DATETIME NULL AFTER id_usuario_chegada,
  ADD COLUMN id_usuario_checkin INT NULL AFTER data_hora_checkin_real;

ALTER TABLE ReservaSuite
  ADD CONSTRAINT fk_reserva_suite_usuario_chegada
    FOREIGN KEY (id_usuario_chegada) REFERENCES Usuario (id);

ALTER TABLE ReservaSuite
  ADD CONSTRAINT fk_reserva_suite_usuario_checkin
    FOREIGN KEY (id_usuario_checkin) REFERENCES Usuario (id);
