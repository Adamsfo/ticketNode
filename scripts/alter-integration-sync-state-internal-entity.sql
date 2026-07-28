-- Etapa 5 — referência da entidade Jango criada pela sincronização.
-- Executar no MySQL se a tabela integration_sync_state já existir.

ALTER TABLE integration_sync_state
  ADD COLUMN internal_entity_id VARCHAR(64) NULL AFTER external_id;

CREATE INDEX idx_integration_sync_internal_entity
  ON integration_sync_state (internal_entity_id);
