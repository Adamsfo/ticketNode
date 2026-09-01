-- Contador global de refresh da hospedagem (RefreshManager).
-- Incrementado apenas em mutações operacionais; o GET /hospedagem/refresh-version
-- lê só esta linha (sem MAX em tabelas grandes).

CREATE TABLE IF NOT EXISTS hospedagem_refresh_state (
  id TINYINT NOT NULL PRIMARY KEY,
  version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO hospedagem_refresh_state (id, version)
VALUES (1, 0)
ON DUPLICATE KEY UPDATE id = id;
