-- Observações opcionais em reservas de hospedagem (recepção / operação)
ALTER TABLE ReservaHospedagem
  ADD COLUMN observacoes TEXT NULL AFTER idUsuarioCheckout;
