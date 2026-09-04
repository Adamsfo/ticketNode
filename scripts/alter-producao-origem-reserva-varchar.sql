-- =============================================================================
-- alter-producao-origem-reserva-varchar.sql
--
-- PRODUÇÃO — alteração pontual de ReservaHospedagem.origem_reserva
--
-- Executar manualmente no MySQL Workbench, conectado à PRODUÇÃO.
-- NÃO executar automaticamente. Revisar as seções PRE e POST antes/depois.
--
-- =============================================================================
-- CONTEXTO
-- =============================================================================
--
-- Estrutura ATUAL confirmada na PRODUÇÃO:
--   ReservaHospedagem.origem_reserva
--   ENUM('SITE','ATENDENTE') NOT NULL DEFAULT 'SITE'
--
-- Estrutura DESEJADA:
--   ReservaHospedagem.origem_reserva
--   VARCHAR(30) NOT NULL DEFAULT 'SITE'
--
-- Motivo:
--   O backend atual aceita origens além de SITE e ATENDENTE (ex.: CLIENTE,
--   HOSPEDIN, LINK_CLIENTE, BOOKING, etc.). O ENUM da produção rejeita esses
--   valores em INSERT/UPDATE. Converter para VARCHAR(30) alinha o schema ao
--   model Sequelize sem restringir origens futuras.
--
-- Dados:
--   ReservaHospedagem está com 0 registros na produção (confirmado em auditoria).
--   Não há migração de valores nem UPDATE necessário.
--
-- Escopo deste script:
--   SOMENTE MODIFY de origem_reserva.
--   Sem DROP, sem recriar tabela, sem INSERT/UPDATE/DELETE, sem AUTO_INCREMENT.
--
-- =============================================================================
-- PRE — validação somente leitura (executar ANTES do ALTER)
-- =============================================================================

SELECT
  c.COLUMN_NAME,
  c.COLUMN_TYPE,
  c.IS_NULLABLE,
  c.COLUMN_DEFAULT,
  c.EXTRA
FROM information_schema.COLUMNS AS c
WHERE c.TABLE_SCHEMA = DATABASE()
  AND c.TABLE_NAME = 'ReservaHospedagem'
  AND c.COLUMN_NAME = 'origem_reserva';

SELECT COUNT(*) AS reserva_hospedagem_row_count
FROM ReservaHospedagem;

-- Esperado antes do ALTER:
--   COLUMN_TYPE = enum('SITE','ATENDENTE')
--   IS_NULLABLE = NO
--   COLUMN_DEFAULT = SITE
--   reserva_hospedagem_row_count = 0

-- =============================================================================
-- ALTER — executar somente se a validação PRE estiver conforme esperado
-- =============================================================================

ALTER TABLE `ReservaHospedagem`
  MODIFY COLUMN `origem_reserva` VARCHAR(30) NOT NULL DEFAULT 'SITE';

-- =============================================================================
-- POST — validação somente leitura (executar DEPOIS do ALTER)
-- =============================================================================

SELECT
  c.COLUMN_NAME,
  c.COLUMN_TYPE,
  c.IS_NULLABLE,
  c.COLUMN_DEFAULT,
  c.EXTRA
FROM information_schema.COLUMNS AS c
WHERE c.TABLE_SCHEMA = DATABASE()
  AND c.TABLE_NAME = 'ReservaHospedagem'
  AND c.COLUMN_NAME = 'origem_reserva';

-- Esperado após o ALTER:
--   COLUMN_TYPE = varchar(30)
--   IS_NULLABLE = NO
--   COLUMN_DEFAULT = SITE

-- =============================================================================
-- FIM
-- =============================================================================
