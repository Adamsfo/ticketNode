-- =============================================================================
-- validate-deploy-producao-integracoes.sql
--
-- Executar somente após deploy-producao-integracoes.sql na PRODUÇÃO.
-- SOMENTE SELECT (read-only). Nenhuma alteração no banco.
-- =============================================================================

-- =============================================================================
-- 1. TABELAS — 15 tabelas do pacote de integração
-- =============================================================================
SELECT
  e.TABLE_NAME,
  CASE WHEN t.TABLE_NAME IS NOT NULL THEN 'YES' ELSE 'NO' END AS EXISTS_FLAG
FROM (
  SELECT 'integration_provider_config' AS TABLE_NAME
  UNION ALL SELECT 'integration_provider_state'
  UNION ALL SELECT 'integration_sync_execution'
  UNION ALL SELECT 'integration_sync_state'
  UNION ALL SELECT 'integration_entity_sync_event'
  UNION ALL SELECT 'hospedin_place_types'
  UNION ALL SELECT 'hospedin_places'
  UNION ALL SELECT 'hospedin_reservations'
  UNION ALL SELECT 'hospedin_sync_log'
  UNION ALL SELECT 'hospedin_place_suite_map'
  UNION ALL SELECT 'hospedin_outbound_sync_state'
  UNION ALL SELECT 'reserva_identificador_externo'
  UNION ALL SELECT 'reserva_origem_financeira'
  UNION ALL SELECT 'reserva_origem_payload'
  UNION ALL SELECT 'reserva_hospede_documento'
) AS e
LEFT JOIN information_schema.TABLES AS t
  ON t.TABLE_SCHEMA = DATABASE()
 AND t.TABLE_NAME = e.TABLE_NAME
 AND t.TABLE_TYPE = 'BASE TABLE'
ORDER BY e.TABLE_NAME;


-- =============================================================================
-- 2. COLUNAS CRÍTICAS — integration_sync_state e integration_provider_config
-- =============================================================================
SELECT
  c.TABLE_NAME,
  c.COLUMN_NAME,
  c.COLUMN_TYPE,
  c.IS_NULLABLE,
  c.COLUMN_DEFAULT,
  c.EXTRA
FROM information_schema.COLUMNS AS c
WHERE c.TABLE_SCHEMA = DATABASE()
  AND (
    (c.TABLE_NAME = 'integration_sync_state' AND c.COLUMN_NAME IN (
      'provider', 'entity_type', 'external_id', 'internal_entity_id',
      'sync_status', 'sync_version', 'resolution_status', 'error_severityity'
    ))
    OR (c.TABLE_NAME = 'integration_provider_config' AND c.COLUMN_NAME IN (
      'provider', 'display_name', 'enabled', 'max_run_minutes', 'webhook_enabled'
    ))
    OR (c.TABLE_NAME = 'integration_provider_state' AND c.COLUMN_NAME IN (
      'provider', 'status', 'has_pending', 'heartbeat_at'
    ))
    OR (c.TABLE_NAME = 'hospedin_outbound_sync_state' AND c.COLUMN_NAME = 'synced_hash_input_json')
    OR (c.TABLE_NAME = 'hospedin_place_suite_map' AND c.COLUMN_NAME = 'mapping_status')
  )
ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION;


-- =============================================================================
-- 3. PRIMARY KEYS
-- =============================================================================
SELECT
  k.TABLE_NAME,
  k.COLUMN_NAME,
  c.COLUMN_KEY,
  c.EXTRA
FROM information_schema.KEY_COLUMN_USAGE AS k
JOIN information_schema.COLUMNS AS c
  ON c.TABLE_SCHEMA = k.TABLE_SCHEMA
 AND c.TABLE_NAME = k.TABLE_NAME
 AND c.COLUMN_NAME = k.COLUMN_NAME
JOIN information_schema.TABLE_CONSTRAINTS AS tc
  ON tc.TABLE_SCHEMA = k.TABLE_SCHEMA
 AND tc.TABLE_NAME = k.TABLE_NAME
 AND tc.CONSTRAINT_NAME = k.CONSTRAINT_NAME
 AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
WHERE k.TABLE_SCHEMA = DATABASE()
  AND k.TABLE_NAME IN (
    'integration_provider_config', 'integration_provider_state',
    'integration_sync_execution', 'integration_sync_state',
    'integration_entity_sync_event', 'hospedin_place_types', 'hospedin_places',
    'hospedin_reservations', 'hospedin_sync_log', 'hospedin_place_suite_map',
    'hospedin_outbound_sync_state', 'reserva_identificador_externo',
    'reserva_origem_financeira', 'reserva_origem_payload', 'reserva_hospede_documento'
  )
ORDER BY k.TABLE_NAME, k.ORDINAL_POSITION;


-- =============================================================================
-- 4. ÍNDICES UNIQUE esperados
-- =============================================================================
SELECT
  e.TABLE_NAME,
  e.INDEX_NAME,
  s.NON_UNIQUE,
  GROUP_CONCAT(s.COLUMN_NAME ORDER BY s.SEQ_IN_INDEX SEPARATOR ', ') AS COLUMNS,
  CASE WHEN COUNT(s.COLUMN_NAME) > 0 THEN 'YES' ELSE 'NO' END AS EXISTS_FLAG
FROM (
  SELECT 'integration_provider_config' AS TABLE_NAME, 'uq_integration_provider_config' AS INDEX_NAME
  UNION ALL SELECT 'integration_provider_state', 'uq_integration_provider_state'
  UNION ALL SELECT 'integration_sync_state', 'uq_integration_sync_identity'
  UNION ALL SELECT 'hospedin_place_types', 'uq_hospedin_place_type_id'
  UNION ALL SELECT 'hospedin_places', 'uq_hospedin_place_id'
  UNION ALL SELECT 'hospedin_reservations', 'uq_hospedin_reservation_id'
  UNION ALL SELECT 'hospedin_place_suite_map', 'uq_hospedin_place_suite_place'
  UNION ALL SELECT 'hospedin_place_suite_map', 'uq_hospedin_place_suite_evento_suite'
  UNION ALL SELECT 'hospedin_outbound_sync_state', 'uq_hospedin_outbound_reserva'
  UNION ALL SELECT 'reserva_identificador_externo', 'uq_reserva_ident_provider_tipo'
  UNION ALL SELECT 'reserva_identificador_externo', 'uq_provider_tipo_valor'
  UNION ALL SELECT 'reserva_origem_financeira', 'uq_reserva_origem_fin_provider'
  UNION ALL SELECT 'reserva_origem_payload', 'uq_reserva_origem_payload'
  UNION ALL SELECT 'reserva_hospede_documento', 'uq_reserva_hosp_doc_tipo'
) AS e
LEFT JOIN information_schema.STATISTICS AS s
  ON s.TABLE_SCHEMA = DATABASE()
 AND s.TABLE_NAME = e.TABLE_NAME
 AND s.INDEX_NAME = e.INDEX_NAME
GROUP BY e.TABLE_NAME, e.INDEX_NAME, s.NON_UNIQUE
ORDER BY e.TABLE_NAME, e.INDEX_NAME;


-- =============================================================================
-- 5. FOREIGN KEYS esperadas
-- =============================================================================
SELECT
  e.CONSTRAINT_NAME,
  e.TABLE_NAME,
  k.COLUMN_NAME,
  k.REFERENCED_TABLE_NAME,
  k.REFERENCED_COLUMN_NAME,
  rc.DELETE_RULE,
  rc.UPDATE_RULE,
  CASE WHEN k.CONSTRAINT_NAME IS NOT NULL THEN 'YES' ELSE 'NO' END AS EXISTS_FLAG
FROM (
  SELECT 'hospedin_place_suite_map' AS TABLE_NAME, 'fk_hospedin_place_suite_evento_suite' AS CONSTRAINT_NAME
  UNION ALL SELECT 'hospedin_outbound_sync_state', 'fk_hospedin_outbound_reserva'
  UNION ALL SELECT 'reserva_identificador_externo', 'fk_reserva_ident_hosp'
  UNION ALL SELECT 'reserva_origem_financeira', 'fk_reserva_origem_fin_hosp'
  UNION ALL SELECT 'reserva_origem_payload', 'fk_reserva_origem_payload_hosp'
  UNION ALL SELECT 'reserva_hospede_documento', 'fk_reserva_hosp_doc_hospede'
) AS e
LEFT JOIN information_schema.KEY_COLUMN_USAGE AS k
  ON k.TABLE_SCHEMA = DATABASE()
 AND k.TABLE_NAME = e.TABLE_NAME
 AND k.CONSTRAINT_NAME = e.CONSTRAINT_NAME
 AND k.REFERENCED_TABLE_NAME IS NOT NULL
LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS AS rc
  ON rc.CONSTRAINT_SCHEMA = DATABASE()
 AND rc.CONSTRAINT_NAME = e.CONSTRAINT_NAME
 AND rc.TABLE_NAME = e.TABLE_NAME
ORDER BY e.TABLE_NAME, e.CONSTRAINT_NAME;


-- =============================================================================
-- 6. CONFIGURAÇÃO — providers cadastrados e DESABILITADOS
-- =============================================================================
SELECT
  provider,
  display_name,
  enabled,
  interval_minutes,
  mode,
  sync_limit,
  priority,
  max_retries,
  backoff_base_seconds,
  max_run_minutes,
  webhook_enabled
FROM integration_provider_config
WHERE provider IN ('HOSPEDIN', 'HOSPEDIN_OUTBOUND')
ORDER BY provider;

SELECT
  ips.provider,
  ips.status,
  ipc.enabled,
  ips.has_pending,
  ips.next_run_at,
  ips.consecutive_failures
FROM integration_provider_state AS ips
LEFT JOIN integration_provider_config AS ipc
  ON ipc.provider = ips.provider
WHERE ips.provider IN ('HOSPEDIN', 'HOSPEDIN_OUTBOUND')
ORDER BY ips.provider;


-- =============================================================================
-- 7. DADOS — tabelas operacionais devem estar vazias (sem cópia do DEV)
-- =============================================================================
SELECT 'integration_sync_state' AS TABLE_NAME, COUNT(*) AS ROW_COUNT FROM integration_sync_state
UNION ALL SELECT 'integration_entity_sync_event', COUNT(*) FROM integration_entity_sync_event
UNION ALL SELECT 'integration_sync_execution', COUNT(*) FROM integration_sync_execution
UNION ALL SELECT 'hospedin_place_types', COUNT(*) FROM hospedin_place_types
UNION ALL SELECT 'hospedin_places', COUNT(*) FROM hospedin_places
UNION ALL SELECT 'hospedin_reservations', COUNT(*) FROM hospedin_reservations
UNION ALL SELECT 'hospedin_sync_log', COUNT(*) FROM hospedin_sync_log
UNION ALL SELECT 'hospedin_place_suite_map', COUNT(*) FROM hospedin_place_suite_map
UNION ALL SELECT 'hospedin_outbound_sync_state', COUNT(*) FROM hospedin_outbound_sync_state
UNION ALL SELECT 'reserva_identificador_externo', COUNT(*) FROM reserva_identificador_externo
UNION ALL SELECT 'reserva_origem_financeira', COUNT(*) FROM reserva_origem_financeira
UNION ALL SELECT 'reserva_origem_payload', COUNT(*) FROM reserva_origem_payload
UNION ALL SELECT 'reserva_hospede_documento', COUNT(*) FROM reserva_hospede_documento;


-- =============================================================================
-- 8. RELATÓRIO FINAL
-- =============================================================================
SELECT checks.CHECK_GROUP, checks.STATUS, checks.DETAIL
FROM (
  SELECT
    'DEPLOY ESTRUTURAL' AS CHECK_GROUP,
    CASE
      WHEN (
        SELECT COUNT(*) FROM (
          SELECT 'integration_provider_config' AS t
          UNION ALL SELECT 'integration_provider_state'
          UNION ALL SELECT 'integration_sync_execution'
          UNION ALL SELECT 'integration_sync_state'
          UNION ALL SELECT 'integration_entity_sync_event'
          UNION ALL SELECT 'hospedin_place_types'
          UNION ALL SELECT 'hospedin_places'
          UNION ALL SELECT 'hospedin_reservations'
          UNION ALL SELECT 'hospedin_sync_log'
          UNION ALL SELECT 'hospedin_place_suite_map'
          UNION ALL SELECT 'hospedin_outbound_sync_state'
          UNION ALL SELECT 'reserva_identificador_externo'
          UNION ALL SELECT 'reserva_origem_financeira'
          UNION ALL SELECT 'reserva_origem_payload'
          UNION ALL SELECT 'reserva_hospede_documento'
        ) exp
        LEFT JOIN information_schema.TABLES tt
          ON tt.TABLE_SCHEMA = DATABASE() AND tt.TABLE_NAME = exp.t
        WHERE tt.TABLE_NAME IS NULL
      ) = 0
      AND (
        SELECT COUNT(*) FROM integration_provider_config
        WHERE provider IN ('HOSPEDIN', 'HOSPEDIN_OUTBOUND')
      ) = 2
      AND (
        SELECT COUNT(*) FROM integration_provider_state
        WHERE provider IN ('HOSPEDIN', 'HOSPEDIN_OUTBOUND')
      ) = 2
      THEN 'OK' ELSE 'ERRO'
    END AS STATUS,
    '15 tabelas + 2 configs + 2 states' AS DETAIL

  UNION ALL

  SELECT 'TABELAS', CASE WHEN m.cnt = 0 THEN 'OK' ELSE 'ERRO' END,
    CASE WHEN m.cnt = 0 THEN 'Todas as 15 tabelas existem.'
         ELSE CONCAT('Faltando ', m.cnt, ': ', m.list) END
  FROM (
    SELECT COUNT(*) cnt, GROUP_CONCAT(exp.t ORDER BY exp.t SEPARATOR ', ') list
    FROM (
      SELECT 'integration_provider_config' t UNION ALL SELECT 'integration_provider_state'
      UNION ALL SELECT 'integration_sync_execution' UNION ALL SELECT 'integration_sync_state'
      UNION ALL SELECT 'integration_entity_sync_event' UNION ALL SELECT 'hospedin_place_types'
      UNION ALL SELECT 'hospedin_places' UNION ALL SELECT 'hospedin_reservations'
      UNION ALL SELECT 'hospedin_sync_log' UNION ALL SELECT 'hospedin_place_suite_map'
      UNION ALL SELECT 'hospedin_outbound_sync_state' UNION ALL SELECT 'reserva_identificador_externo'
      UNION ALL SELECT 'reserva_origem_financeira' UNION ALL SELECT 'reserva_origem_payload'
      UNION ALL SELECT 'reserva_hospede_documento'
    ) exp
    LEFT JOIN information_schema.TABLES tt ON tt.TABLE_SCHEMA = DATABASE() AND tt.TABLE_NAME = exp.t
    WHERE tt.TABLE_NAME IS NULL
  ) m

  UNION ALL

  SELECT 'CONFIG DESABILITADA',
    CASE
      WHEN (SELECT COUNT(*) FROM integration_provider_config WHERE provider IN ('HOSPEDIN','HOSPEDIN_OUTBOUND') AND enabled = 0) = 2
       AND (SELECT COUNT(*) FROM integration_provider_state WHERE provider IN ('HOSPEDIN','HOSPEDIN_OUTBOUND') AND status = 'DISABLED') = 2
      THEN 'OK' ELSE 'ERRO'
    END,
    CONCAT(
      'enabled=0: ',
      (SELECT COUNT(*) FROM integration_provider_config WHERE provider IN ('HOSPEDIN','HOSPEDIN_OUTBOUND') AND enabled = 0),
      '/2; status=DISABLED: ',
      (SELECT COUNT(*) FROM integration_provider_state WHERE provider IN ('HOSPEDIN','HOSPEDIN_OUTBOUND') AND status = 'DISABLED'),
      '/2'
    )

  UNION ALL

  SELECT 'DADOS OPERACIONAIS',
    CASE WHEN (
      (SELECT COUNT(*) FROM integration_sync_state)
      + (SELECT COUNT(*) FROM integration_entity_sync_event)
      + (SELECT COUNT(*) FROM integration_sync_execution)
      + (SELECT COUNT(*) FROM hospedin_reservations)
      + (SELECT COUNT(*) FROM hospedin_sync_log)
      + (SELECT COUNT(*) FROM hospedin_outbound_sync_state)
    ) = 0 THEN 'OK' ELSE 'ERRO' END,
    'Esperado 0 linhas nas tabelas de sync/staging/log/outbound após deploy estrutural'

  UNION ALL

  SELECT 'INTEGRATION_SYNC_STATE',
    CASE WHEN (
      SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'integration_sync_state'
        AND COLUMN_NAME IN ('sync_version','resolution_status','error_severityity','internal_entity_id')
    ) = 4 THEN 'OK' ELSE 'ERRO' END,
    'Colunas críticas do pipeline RFC002'

  UNION ALL

  SELECT 'FK CRITICAS',
    CASE WHEN (
      SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY'
        AND CONSTRAINT_NAME IN (
          'fk_hospedin_outbound_reserva','fk_hospedin_place_suite_evento_suite',
          'fk_reserva_ident_hosp','fk_reserva_origem_fin_hosp',
          'fk_reserva_origem_payload_hosp','fk_reserva_hosp_doc_hospede'
        )
    ) = 6 THEN 'OK' ELSE 'ERRO' END,
    '6 FKs do pacote'
) checks
ORDER BY FIELD(checks.CHECK_GROUP,
  'DEPLOY ESTRUTURAL','TABELAS','CONFIG DESABILITADA','DADOS OPERACIONAIS',
  'INTEGRATION_SYNC_STATE','FK CRITICAS');


-- =============================================================================
-- 9. DETALHAMENTO DE FALTANTES
-- =============================================================================
SELECT 'TABELA_FALTANDO' AS ISSUE_TYPE, exp.t AS OBJECT_NAME
FROM (
  SELECT 'integration_provider_config' t UNION ALL SELECT 'integration_provider_state'
  UNION ALL SELECT 'integration_sync_execution' UNION ALL SELECT 'integration_sync_state'
  UNION ALL SELECT 'integration_entity_sync_event' UNION ALL SELECT 'hospedin_place_types'
  UNION ALL SELECT 'hospedin_places' UNION ALL SELECT 'hospedin_reservations'
  UNION ALL SELECT 'hospedin_sync_log' UNION ALL SELECT 'hospedin_place_suite_map'
  UNION ALL SELECT 'hospedin_outbound_sync_state' UNION ALL SELECT 'reserva_identificador_externo'
  UNION ALL SELECT 'reserva_origem_financeira' UNION ALL SELECT 'reserva_origem_payload'
  UNION ALL SELECT 'reserva_hospede_documento'
) exp
LEFT JOIN information_schema.TABLES tt ON tt.TABLE_SCHEMA = DATABASE() AND tt.TABLE_NAME = exp.t
WHERE tt.TABLE_NAME IS NULL

UNION ALL

SELECT 'CONFIG_AUSENTE', provider
FROM (
  SELECT 'HOSPEDIN' AS provider UNION ALL SELECT 'HOSPEDIN_OUTBOUND'
) req
WHERE NOT EXISTS (
  SELECT 1 FROM integration_provider_config c WHERE c.provider = req.provider
)

UNION ALL

SELECT 'CONFIG_HABILITADA', provider
FROM integration_provider_config
WHERE provider IN ('HOSPEDIN', 'HOSPEDIN_OUTBOUND') AND enabled <> 0

UNION ALL

SELECT 'STATE_NAO_DISABLED', provider
FROM integration_provider_state
WHERE provider IN ('HOSPEDIN', 'HOSPEDIN_OUTBOUND') AND status <> 'DISABLED'

UNION ALL

SELECT 'DADOS_INDEVIDOS', CONCAT('integration_sync_state rows=', COUNT(*))
FROM integration_sync_state HAVING COUNT(*) > 0

UNION ALL

SELECT 'DADOS_INDEVIDOS', CONCAT('hospedin_reservations rows=', COUNT(*))
FROM hospedin_reservations HAVING COUNT(*) > 0

ORDER BY ISSUE_TYPE, OBJECT_NAME;
