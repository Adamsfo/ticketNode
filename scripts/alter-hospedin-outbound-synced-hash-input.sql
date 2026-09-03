-- Baseline do último sync outbound (hash input JSON) para diff de UPDATE.
-- Idempotente: ignora se a coluna já existir.

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hospedin_outbound_sync_state'
    AND COLUMN_NAME = 'synced_hash_input_json'
);

SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE hospedin_outbound_sync_state ADD COLUMN synced_hash_input_json TEXT NULL AFTER pending_payload_hash',
  'SELECT ''synced_hash_input_json already exists'' AS info'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
