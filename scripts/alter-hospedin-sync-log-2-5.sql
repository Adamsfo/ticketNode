-- Etapa 2.5 — consolida hospedin_sync_log (sucesso/erro) e reforça uniques.
-- Seguro executar mais de uma vez (IF NOT EXISTS / ignore duplicate column via procedure simples).

-- Colunas de resultado no sync log
SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'hospedin_sync_log' AND COLUMN_NAME = 'sucesso'
    ),
    'SELECT 1',
    'ALTER TABLE hospedin_sync_log ADD COLUMN sucesso TINYINT(1) NOT NULL DEFAULT 0 AFTER duracao_ms'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'hospedin_sync_log' AND COLUMN_NAME = 'erro'
    ),
    'SELECT 1',
    'ALTER TABLE hospedin_sync_log ADD COLUMN erro TEXT NULL AFTER sucesso'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Índice de sucesso
SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'hospedin_sync_log' AND INDEX_NAME = 'idx_hospedin_sync_log_sucesso'
    ),
    'SELECT 1',
    'ALTER TABLE hospedin_sync_log ADD KEY idx_hospedin_sync_log_sucesso (sucesso)'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
