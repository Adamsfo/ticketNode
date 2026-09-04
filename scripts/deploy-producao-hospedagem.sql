-- =============================================================================
-- deploy-producao-hospedagem.sql
-- Pacote curado DEV → PRODUÇÃO (somente Hospedagem operacional)
-- Gerado para revisão manual. NÃO executar automaticamente em produção.
--
-- Fonte: scripts versionados em ticket-node/scripts/ + compare read-only DEV/PROD
-- Exclui: INSERT/UPDATE/DELETE/TRUNCATE, DROP, MODIFY automático de origem_reserva,
--         tabelas Hospedin/integration, índices/FKs duplicados do sequelize.sync no DEV.
-- =============================================================================

SET NAMES utf8mb4;
SET @db := DATABASE();

-- -----------------------------------------------------------------------------
-- Helpers idempotentes (reutilizados abaixo)
-- -----------------------------------------------------------------------------

-- ADD COLUMN se ainda não existir
DROP PROCEDURE IF EXISTS sp_deploy_add_column_if_missing;
DELIMITER $$
CREATE PROCEDURE sp_deploy_add_column_if_missing(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column
  ) = 0 THEN
    SET @sql = CONCAT(
      'ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

-- CREATE INDEX se ainda não existir (por nome)
DROP PROCEDURE IF EXISTS sp_deploy_create_index_if_missing;
DELIMITER $$
CREATE PROCEDURE sp_deploy_create_index_if_missing(
  IN p_table VARCHAR(64),
  IN p_index VARCHAR(64),
  IN p_index_ddl TEXT
)
BEGIN
  IF (
    SELECT COUNT(*)
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db
      AND TABLE_NAME = p_table
      AND INDEX_NAME = p_index
  ) = 0 THEN
    SET @sql = p_index_ddl;
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

-- ADD FK se ainda não existir (por nome do constraint)
DROP PROCEDURE IF EXISTS sp_deploy_add_fk_if_missing;
DELIMITER $$
CREATE PROCEDURE sp_deploy_add_fk_if_missing(
  IN p_table VARCHAR(64),
  IN p_constraint VARCHAR(64),
  IN p_fk_ddl TEXT
)
BEGIN
  IF (
    SELECT COUNT(*)
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = @db
      AND TABLE_NAME = p_table
      AND CONSTRAINT_NAME = p_constraint
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ) = 0 THEN
    SET @sql = p_fk_ddl;
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

-- =============================================================================
-- SEÇÃO 1 — CREATE TABLE (ordem: sem dependências entre novas tabelas)
-- =============================================================================

-- [CREATE TABLE] hospedagem_refresh_state
-- Motivo: contador global de refresh (Agenda/Suites/Limpeza) via RefreshManager.
-- Origem: create-hospedagem-refresh-state.sql (sem INSERT — seed criado pelo backend)
CREATE TABLE IF NOT EXISTS hospedagem_refresh_state (
  id TINYINT NOT NULL PRIMARY KEY,
  version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- [CREATE TABLE] EventoSuiteFoto
-- Motivo: cadastro oficial de fotos das suítes.
-- Origem: create-evento-suite-foto.sql
CREATE TABLE IF NOT EXISTS EventoSuiteFoto (
  id INT NOT NULL AUTO_INCREMENT,
  id_evento_suite INT NOT NULL,
  arquivo VARCHAR(255) NOT NULL,
  ordem INT NOT NULL DEFAULT 1,
  principal TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_evento_suite_foto_suite (id_evento_suite),
  KEY idx_evento_suite_foto_ordem (id_evento_suite, ordem),
  CONSTRAINT fk_evento_suite_foto_suite
    FOREIGN KEY (id_evento_suite) REFERENCES EventoSuite (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- [CREATE TABLE] EventoSuiteLimpeza
-- Motivo: histórico e status de limpeza das suítes (grid /limpezaSuites e painel nos cards).
-- Origem: create-evento-suite-limpeza.sql
CREATE TABLE IF NOT EXISTS EventoSuiteLimpeza (
  id INT NOT NULL AUTO_INCREMENT,
  id_evento_suite INT NOT NULL,
  id_reserva_hospedagem INT NOT NULL,
  id_reserva_suite INT NOT NULL,
  status ENUM('Pendente', 'EmAndamento', 'Concluida') NOT NULL DEFAULT 'Pendente',
  data_hora_inicio DATETIME NULL,
  id_usuario_inicio INT NULL,
  data_hora_fim DATETIME NULL,
  id_usuario_fim INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_limpeza_reserva_suite (id_reserva_hospedagem, id_evento_suite),
  KEY idx_limpeza_suite_status (id_evento_suite, status),
  KEY idx_limpeza_status (status),
  CONSTRAINT fk_limpeza_evento_suite
    FOREIGN KEY (id_evento_suite) REFERENCES EventoSuite (id),
  CONSTRAINT fk_limpeza_reserva_hospedagem
    FOREIGN KEY (id_reserva_hospedagem) REFERENCES ReservaHospedagem (id),
  CONSTRAINT fk_limpeza_reserva_suite
    FOREIGN KEY (id_reserva_suite) REFERENCES ReservaSuite (id),
  CONSTRAINT fk_limpeza_usuario_inicio
    FOREIGN KEY (id_usuario_inicio) REFERENCES Usuario (id),
  CONSTRAINT fk_limpeza_usuario_fim
    FOREIGN KEY (id_usuario_fim) REFERENCES Usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- [CREATE TABLE] HospedagemPagamentoOperacao
-- Motivo: operações SuperTEF de receber saldo na hospedagem (independente de ingressos).
-- Origem: alter-hospedagem-pagamento-operacao-tef.sql (colunas adaptadas snake_case / PROD)
CREATE TABLE IF NOT EXISTS HospedagemPagamentoOperacao (
  id INT NOT NULL AUTO_INCREMENT,
  uuid VARCHAR(64) NOT NULL,
  tipo VARCHAR(30) NOT NULL DEFAULT 'HOSPEDAGEM',
  origem VARCHAR(40) NOT NULL DEFAULT 'RECEBER_SALDO',
  id_reserva_hospedagem INT NOT NULL,
  id_usuario INT NOT NULL,
  valor DECIMAL(14,2) NOT NULL,
  forma_pagamento VARCHAR(40) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDENTE',
  order_id_super_tef VARCHAR(64) NOT NULL,
  id_externo_super_tef VARCHAR(120) NULL,
  observacao TEXT NULL,
  mensagem_status VARCHAR(255) NULL,
  raw_inicio TEXT NULL,
  id_pagamento_hospedagem INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hospedagem_pagamento_operacao_uuid (uuid),
  UNIQUE KEY uq_hospedagem_pagamento_operacao_order (order_id_super_tef),
  KEY idx_hosp_pag_op_reserva (id_reserva_hospedagem),
  KEY idx_hosp_pag_op_externo (id_externo_super_tef),
  CONSTRAINT fk_hosp_pag_op_reserva
    FOREIGN KEY (id_reserva_hospedagem) REFERENCES ReservaHospedagem (id),
  CONSTRAINT fk_hosp_pag_op_usuario
    FOREIGN KEY (id_usuario) REFERENCES Usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- [CREATE TABLE] ReservaPeriodoMovimentacao
-- Motivo: auditoria de alteração de período da reserva.
-- Origem: alter-hospedagem-alterar-periodo.sql (colunas adaptadas snake_case / PROD)
CREATE TABLE IF NOT EXISTS ReservaPeriodoMovimentacao (
  id INT NOT NULL AUTO_INCREMENT,
  id_reserva_hospedagem INT NOT NULL,
  id_usuario INT NOT NULL,
  data_hora DATETIME NOT NULL,
  checkin_anterior DATETIME NOT NULL,
  checkout_anterior DATETIME NOT NULL,
  checkin_novo DATETIME NOT NULL,
  checkout_novo DATETIME NOT NULL,
  motivo VARCHAR(255) NULL,
  tipo VARCHAR(40) NOT NULL DEFAULT 'ALTERACAO',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_periodo_mov_reserva (id_reserva_hospedagem),
  CONSTRAINT fk_periodo_mov_reserva
    FOREIGN KEY (id_reserva_hospedagem) REFERENCES ReservaHospedagem (id),
  CONSTRAINT fk_periodo_mov_usuario
    FOREIGN KEY (id_usuario) REFERENCES Usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- [CREATE TABLE] ReservaSuiteMovimentacao
-- Motivo: auditoria de troca de suíte.
-- Origem: alter-hospedagem-troca-suite.sql (colunas adaptadas snake_case / PROD)
CREATE TABLE IF NOT EXISTS ReservaSuiteMovimentacao (
  id INT NOT NULL AUTO_INCREMENT,
  id_reserva_hospedagem INT NOT NULL,
  id_reserva_suite INT NOT NULL,
  id_evento_suite_origem INT NOT NULL,
  id_evento_suite_destino INT NOT NULL,
  id_usuario INT NOT NULL,
  data_hora DATETIME NOT NULL,
  motivo VARCHAR(255) NULL,
  tipo VARCHAR(40) NOT NULL DEFAULT 'TRANSFERENCIA',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mov_reserva (id_reserva_hospedagem),
  KEY idx_mov_suite_linha (id_reserva_suite),
  CONSTRAINT fk_mov_reserva
    FOREIGN KEY (id_reserva_hospedagem) REFERENCES ReservaHospedagem (id),
  CONSTRAINT fk_mov_reserva_suite
    FOREIGN KEY (id_reserva_suite) REFERENCES ReservaSuite (id),
  CONSTRAINT fk_mov_suite_origem
    FOREIGN KEY (id_evento_suite_origem) REFERENCES EventoSuite (id),
  CONSTRAINT fk_mov_suite_destino
    FOREIGN KEY (id_evento_suite_destino) REFERENCES EventoSuite (id),
  CONSTRAINT fk_mov_usuario
    FOREIGN KEY (id_usuario) REFERENCES Usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================================================
-- SEÇÃO 2 — ADD COLUMN (ReservaHospedagem)
-- =============================================================================

-- [ADD COLUMN] ReservaHospedagem.id_externo
-- Motivo: atalho operacional para ID na origem (model Sequelize); nullable.
-- Origem: alter-reserva-origem-integracao-fase1.sql (somente colunas, sem tabelas integration)
CALL sp_deploy_add_column_if_missing(
  'ReservaHospedagem', 'id_externo',
  'VARCHAR(64) NULL'
);

-- [ADD COLUMN] ReservaHospedagem.codigo_externo
-- Motivo: código humano na origem (searchable_code etc.).
-- Origem: alter-reserva-origem-integracao-fase1.sql
CALL sp_deploy_add_column_if_missing(
  'ReservaHospedagem', 'codigo_externo',
  'VARCHAR(64) NULL'
);

-- [ADD COLUMN] ReservaHospedagem.canal_venda
-- Motivo: canal comercial (Booking, Site, recepção…).
-- Origem: alter-reserva-origem-integracao-fase1.sql
CALL sp_deploy_add_column_if_missing(
  'ReservaHospedagem', 'canal_venda',
  'VARCHAR(40) NULL'
);

-- [ADD COLUMN] ReservaHospedagem.token_pagamento
-- Motivo: link público de pagamento na recepção.
-- Origem: alter-hospedagem-link-pagamento.sql (nomes físicos PROD)
CALL sp_deploy_add_column_if_missing(
  'ReservaHospedagem', 'token_pagamento',
  'VARCHAR(64) NULL'
);

-- [ADD COLUMN] ReservaHospedagem.expira_em
-- Motivo: expiração opcional do link de pagamento.
-- Origem: alter-hospedagem-link-pagamento.sql
CALL sp_deploy_add_column_if_missing(
  'ReservaHospedagem', 'expira_em',
  'DATETIME NULL'
);

-- [ADD COLUMN] ReservaHospedagem.link_pagamento_enviado_em
-- Motivo: rastreio de envio do link ao cliente.
-- Origem: alter-hospedagem-link-pagamento.sql
CALL sp_deploy_add_column_if_missing(
  'ReservaHospedagem', 'link_pagamento_enviado_em',
  'DATETIME NULL'
);

-- [ADD COLUMN] ReservaHospedagem.data_hora_chegada_real
-- Motivo: registro de chegada física (Hóspede chegou) sem check-in operacional.
-- Origem: alter-hospedagem-chegada.sql
CALL sp_deploy_add_column_if_missing(
  'ReservaHospedagem', 'data_hora_chegada_real',
  'DATETIME NULL'
);

-- [ADD COLUMN] ReservaHospedagem.id_usuario_chegada
-- Motivo: operador que registrou a chegada.
-- Origem: alter-hospedagem-chegada.sql
CALL sp_deploy_add_column_if_missing(
  'ReservaHospedagem', 'id_usuario_chegada',
  'INT NULL'
);

-- [ADD COLUMN] ReservaHospedagem.id_venda_jango
-- Motivo: vínculo com VENDA no PDV Jango (Firebird) na chegada.
-- Origem: alter-hospedagem-id-venda-jango.sql
CALL sp_deploy_add_column_if_missing(
  'ReservaHospedagem', 'id_venda_jango',
  'INT NULL'
);

-- [ADD COLUMN] ReservaHospedagem.observacao_importada
-- Motivo: separar observação importada da operacional (sem UPDATE de backfill neste pacote).
-- Origem: alter-hospedagem-observacoes-split.sql (apenas ADD COLUMN)
CALL sp_deploy_add_column_if_missing(
  'ReservaHospedagem', 'observacao_importada',
  'TEXT NULL'
);

-- [ADD COLUMN] ReservaHospedagem.observacao_operador
-- Motivo: anotação do operador Jango.
-- Origem: alter-hospedagem-observacoes-split.sql (apenas ADD COLUMN)
CALL sp_deploy_add_column_if_missing(
  'ReservaHospedagem', 'observacao_operador',
  'TEXT NULL'
);

-- [ADD COLUMN] ReservaHospedagem.possivel_pagamento_ota
-- Motivo: alerta operacional de possível pagamento OTA (não quita automaticamente).
-- Origem: alter-reserva-possivel-pagamento-ota.sql
CALL sp_deploy_add_column_if_missing(
  'ReservaHospedagem', 'possivel_pagamento_ota',
  'TINYINT(1) NOT NULL DEFAULT 0'
);

-- [ADD COLUMN] ReservaHospedagem.possivel_pagamento_ota_trecho
-- Motivo: trecho do note que motivou o alerta OTA.
-- Origem: alter-reserva-possivel-pagamento-ota.sql
CALL sp_deploy_add_column_if_missing(
  'ReservaHospedagem', 'possivel_pagamento_ota_trecho',
  'TEXT NULL'
);

-- =============================================================================
-- SEÇÃO 3 — ADD COLUMN (outras tabelas core)
-- =============================================================================

-- [ADD COLUMN] ReservaHospede.id_usuario
-- Motivo: vínculo opcional hóspede → Usuario (resolução por CPF).
-- Origem: alter-reserva-hospede-id-usuario.sql
CALL sp_deploy_add_column_if_missing(
  'ReservaHospede', 'id_usuario',
  'INT NULL'
);

-- [ADD COLUMN] Transacao.origem_transacao
-- Motivo: distinguir transações de ingressos vs hospedagem (default INGRESSOS preserva legado).
-- Origem: alter-transacao-origem-transacao.sql
CALL sp_deploy_add_column_if_missing(
  'Transacao', 'origem_transacao',
  "ENUM('INGRESSOS', 'HOSPEDAGEM') NOT NULL DEFAULT 'INGRESSOS'"
);

-- =============================================================================
-- SEÇÃO 4 — INDEX (somente índices documentados; sem duplicatas do sequelize.sync)
-- =============================================================================

-- [INDEX] ReservaHospedagem — busca por origem + id externo
-- Origem: alter-reserva-origem-integracao-fase1.sql
CALL sp_deploy_create_index_if_missing(
  'ReservaHospedagem',
  'idx_reserva_hosp_origem_id_externo',
  'CREATE INDEX idx_reserva_hosp_origem_id_externo ON ReservaHospedagem (origem_reserva, id_externo)'
);

-- [INDEX] ReservaHospedagem — código externo
-- Origem: alter-reserva-origem-integracao-fase1.sql
CALL sp_deploy_create_index_if_missing(
  'ReservaHospedagem',
  'idx_reserva_hosp_codigo_externo',
  'CREATE INDEX idx_reserva_hosp_codigo_externo ON ReservaHospedagem (codigo_externo)'
);

-- [INDEX] ReservaHospedagem — canal de venda
-- Origem: alter-reserva-origem-integracao-fase1.sql
CALL sp_deploy_create_index_if_missing(
  'ReservaHospedagem',
  'idx_reserva_hosp_canal_venda',
  'CREATE INDEX idx_reserva_hosp_canal_venda ON ReservaHospedagem (canal_venda)'
);

-- [INDEX] ReservaHospedagem — token de pagamento único
-- Origem: alter-hospedagem-link-pagamento.sql (um único índice; não replicar token_pagamento_2…10 do DEV)
CALL sp_deploy_create_index_if_missing(
  'ReservaHospedagem',
  'uq_reserva_hosp_token_pagamento',
  'CREATE UNIQUE INDEX uq_reserva_hosp_token_pagamento ON ReservaHospedagem (token_pagamento)'
);

-- [INDEX] ReservaHospedagem — filtro alerta OTA
-- Origem: alter-reserva-possivel-pagamento-ota.sql
CALL sp_deploy_create_index_if_missing(
  'ReservaHospedagem',
  'idx_reserva_hosp_possivel_pagamento_ota',
  'CREATE INDEX idx_reserva_hosp_possivel_pagamento_ota ON ReservaHospedagem (possivel_pagamento_ota)'
);

-- [INDEX] ReservaHospede — vínculo usuário
-- Origem: compare DEV/PROD (índice operacional; sem FK no script versionado)
CALL sp_deploy_create_index_if_missing(
  'ReservaHospede',
  'idx_reserva_hospede_id_usuario',
  'CREATE INDEX idx_reserva_hospede_id_usuario ON ReservaHospede (id_usuario)'
);

-- =============================================================================
-- SEÇÃO 5 — FOREIGN KEY
-- =============================================================================

-- [FK] ReservaHospedagem.id_usuario_chegada → Usuario.id
-- Origem: alter-hospedagem-chegada.sql
CALL sp_deploy_add_fk_if_missing(
  'ReservaHospedagem',
  'fk_reserva_hospedagem_usuario_chegada',
  'ALTER TABLE ReservaHospedagem ADD CONSTRAINT fk_reserva_hospedagem_usuario_chegada FOREIGN KEY (id_usuario_chegada) REFERENCES Usuario (id)'
);

-- =============================================================================
-- Limpeza dos helpers temporários
-- =============================================================================
DROP PROCEDURE IF EXISTS sp_deploy_add_column_if_missing;
DROP PROCEDURE IF EXISTS sp_deploy_create_index_if_missing;
DROP PROCEDURE IF EXISTS sp_deploy_add_fk_if_missing;

-- =============================================================================
-- REVISÃO MANUAL
-- NÃO EXECUTAR AUTOMATICAMENTE
-- =============================================================================
--
-- ReservaHospedagem.origem_reserva
--   PRODUÇÃO atual: ENUM('SITE','ATENDENTE') DEFAULT 'SITE'
--   DEV / backend atual: VARCHAR(30) DEFAULT 'CLIENTE' (valores: CLIENTE, ATENDENTE, HOSPEDIN, …)
--
-- O compare identificou incompatibilidade de tipo/default. MODIFY exige decisão de negócio
-- sobre valores legados SITE vs CLIENTE e sobre futuras origens (HOSPEDIN, BOOKING, etc.).
--
-- Script de referência (NÃO incluído aqui):
--   ticket-node/scripts/alter-hospedagem-origem-varchar.sql
--
-- Exemplo (revisar nomes físicos e impacto antes de executar):
--
-- ALTER TABLE ReservaHospedagem
--   MODIFY COLUMN origem_reserva VARCHAR(30) NOT NULL DEFAULT 'CLIENTE';
--
-- ATENÇÃO: produção pode ter valores 'SITE' que o backend novo trata como legado.
-- Não converter SITE→CLIENTE automaticamente sem plano de migração de dados.
--
-- -----------------------------------------------------------------------------
-- Backfill observações (opcional, separado deste pacote)
-- -----------------------------------------------------------------------------
-- alter-hospedagem-observacoes-split.sql contém UPDATE para popular
-- observacao_importada / observacao_operador a partir de observacoes.
-- Não incluído (regra: sem UPDATE). Colunas ficam NULL até uso/migração manual.
--
-- -----------------------------------------------------------------------------
-- Seed hospedagem_refresh_state (opcional)
-- -----------------------------------------------------------------------------
-- create-hospedagem-refresh-state.sql inclui INSERT id=1.
-- Não incluído (regra: sem INSERT). O backend cria/atualiza via
-- hospedagemRefreshVersionService (INSERT … ON DUPLICATE KEY UPDATE).
--
-- =============================================================================
-- FIM deploy-producao-hospedagem.sql
-- =============================================================================
