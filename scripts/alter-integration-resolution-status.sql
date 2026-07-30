-- Separação histórico vs pendência ativa (resolution_status).
-- Histórico (integration_entity_sync_event) permanece intacto.

ALTER TABLE integration_sync_state
  ADD COLUMN resolution_status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
    AFTER error_severityity;

CREATE INDEX idx_sync_state_resolution
  ON integration_sync_state (resolution_status, sync_status);

-- Migração: erros permanentes antigos deixam de ser pendência operacional.
UPDATE integration_sync_state
SET
  resolution_status = 'IGNORED',
  sync_status = CASE
    WHEN sync_status IN ('FAILED', 'WAIT_MAPPING', 'READY', 'NEW', 'VALIDATED')
      THEN 'IGNORED'
    ELSE sync_status
  END,
  updated_at = NOW()
WHERE resolution_status = 'OPEN'
  AND (
    error_code IN (
      'RESERVATION_IN_PAST',
      'INVALID_DATES'
    )
    OR last_error LIKE '%datas passadas%'
    OR last_error LIKE '%Não é permitido criar reservas para datas passadas%'
    OR last_error LIKE '%reservation%past%'
    OR last_error LIKE '%check-in%passad%'
  );

-- Já sincronizadas com sucesso → RESOLVED
UPDATE integration_sync_state
SET
  resolution_status = 'RESOLVED',
  updated_at = NOW()
WHERE sync_status = 'SYNCED'
  AND resolution_status = 'OPEN';

-- Já IGNORED no sync_status → IGNORED na resolução
UPDATE integration_sync_state
SET
  resolution_status = 'IGNORED',
  updated_at = NOW()
WHERE sync_status = 'IGNORED'
  AND resolution_status = 'OPEN';
