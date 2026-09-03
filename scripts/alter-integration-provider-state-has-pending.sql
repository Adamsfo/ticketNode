-- Wake-up outbound (fila real permanece em hospedin_outbound_sync_state).
ALTER TABLE integration_provider_state
  ADD COLUMN has_pending TINYINT(1) NOT NULL DEFAULT 0
  AFTER last_execution_id;
