-- Check-out operacional: status CheckOutRealizado + auditoria
-- Executar no MySQL após o script de check-in.

ALTER TABLE ReservaHospedagem
  MODIFY COLUMN status ENUM(
    'AguardandoPagamento',
    'Confirmada',
    'Hospedada',
    'CheckOutRealizado',
    'Cancelada',
    'Expirada'
  ) NOT NULL DEFAULT 'AguardandoPagamento';

ALTER TABLE ReservaHospedagem
  ADD COLUMN dataHoraCheckoutRealizado DATETIME NULL AFTER idUsuarioCheckin,
  ADD COLUMN idUsuarioCheckout INT NULL AFTER dataHoraCheckoutRealizado;

ALTER TABLE ReservaSuite
  MODIFY COLUMN status ENUM(
    'AguardandoPagamento',
    'Confirmada',
    'Hospedada',
    'CheckOutRealizado',
    'Cancelada',
    'Expirada'
  ) NOT NULL DEFAULT 'AguardandoPagamento';
