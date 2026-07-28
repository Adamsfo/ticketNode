-- Vínculo opcional ReservaHospede → Usuario (resolução por CPF).
-- Colunas físicas em snake_case (underscored).

ALTER TABLE ReservaHospede
  ADD COLUMN id_usuario INT NULL AFTER data_nascimento;
