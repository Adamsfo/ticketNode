-- Check-in operacional: status Hospedada + auditoria
-- Executar no MySQL antes de usar o endpoint de check-in.

ALTER TABLE ReservaHospedagem
  MODIFY COLUMN status ENUM(
    'AguardandoPagamento',
    'Confirmada',
    'Hospedada',
    'Cancelada',
    'Expirada'
  ) NOT NULL DEFAULT 'AguardandoPagamento';

ALTER TABLE ReservaHospedagem
  ADD COLUMN IF NOT EXISTS dataHoraCheckinReal DATETIME NULL AFTER dataConfirmacao,
  ADD COLUMN IF NOT EXISTS idUsuarioCheckin INT NULL AFTER dataHoraCheckinReal;

-- MySQL < 8.0.12 não tem IF NOT EXISTS em ADD COLUMN — use o bloco abaixo se necessário:
-- ALTER TABLE ReservaHospedagem ADD COLUMN dataHoraCheckinReal DATETIME NULL AFTER dataConfirmacao;
-- ALTER TABLE ReservaHospedagem ADD COLUMN idUsuarioCheckin INT NULL AFTER dataHoraCheckinReal;

ALTER TABLE ReservaSuite
  MODIFY COLUMN status ENUM(
    'AguardandoPagamento',
    'Confirmada',
    'Hospedada',
    'Cancelada',
    'Expirada'
  ) NOT NULL DEFAULT 'AguardandoPagamento';
