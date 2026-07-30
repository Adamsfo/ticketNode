-- Suíte ignorada na integração: mapping_status LINKED | IGNORED.
-- UNMAPPED = ausência de linha ativa (não é valor persistido).
-- Histórico (hospedin_sync_log / entity events) permanece intacto.

ALTER TABLE hospedin_place_suite_map
  ADD COLUMN mapping_status VARCHAR(20) NOT NULL DEFAULT 'LINKED'
    AFTER ativo;

-- Ignoradas não precisam de EventoSuite.
ALTER TABLE hospedin_place_suite_map
  MODIFY COLUMN id_evento_suite INT NULL;

-- FK: remove e recria permitindo NULL (MySQL).
-- Se a FK já tiver outro nome, ajuste manualmente.
ALTER TABLE hospedin_place_suite_map
  DROP FOREIGN KEY fk_hospedin_place_suite_evento_suite;

ALTER TABLE hospedin_place_suite_map
  ADD CONSTRAINT fk_hospedin_place_suite_evento_suite
    FOREIGN KEY (id_evento_suite) REFERENCES EventoSuite (id);

CREATE INDEX idx_hospedin_place_suite_mapping_status
  ON hospedin_place_suite_map (mapping_status, ativo);

-- Backfill: linhas ativas com suíte = LINKED; sem suíte = IGNORED.
UPDATE hospedin_place_suite_map
SET mapping_status = CASE
  WHEN id_evento_suite IS NULL THEN 'IGNORED'
  ELSE 'LINKED'
END
WHERE mapping_status IS NULL OR mapping_status = '' OR mapping_status = 'LINKED';
