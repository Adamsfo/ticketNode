-- Adiciona sync_version (contador de sincronizações efetivas aplicadas).
-- Incrementa apenas em CREATE / UPDATE aplicado / CANCEL efetivo.
-- Não incrementa em UNCHANGED, ORIGIN_CONFLICT, FAILED ou UPDATE sem mudanças.

ALTER TABLE integration_sync_state
  ADD COLUMN sync_version INT NOT NULL DEFAULT 0
  AFTER retry_count;
