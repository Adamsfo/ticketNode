-- Vínculo reserva ↔ conta operacional Jango (VENDA.ID_VENDA no Firebird)
-- Executar no MySQL após alter-hospedagem-chegada.sql
-- Sem FK: VENDA reside no PDV Jango, não no MySQL.

ALTER TABLE ReservaHospedagem
  ADD COLUMN id_venda_jango INT NULL AFTER id_usuario_chegada;
