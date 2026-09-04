-- =============================================================================
-- validate-deploy-producao-hospedagem.sql
--
-- Executar somente após deploy-producao-hospedagem.sql na PRODUÇÃO.
--
-- Validação pós-deploy — SOMENTE SELECT (read-only).
-- Conectar no MySQL Workbench à PRODUÇÃO e executar o arquivo inteiro
-- (ou seção a seção). Nenhuma alteração no banco.
--
-- Referência: ticket-node/scripts/deploy-producao-hospedagem.sql
-- =============================================================================

-- =============================================================================
-- 1. TABELAS — existência das 6 tabelas novas
-- =============================================================================
SELECT
  e.TABLE_NAME,
  CASE
    WHEN t.TABLE_NAME IS NOT NULL THEN 'YES'
    ELSE 'NO'
  END AS EXISTS_FLAG
FROM (
  SELECT 'hospedagem_refresh_state' AS TABLE_NAME
  UNION ALL SELECT 'EventoSuiteFoto'
  UNION ALL SELECT 'EventoSuiteLimpeza'
  UNION ALL SELECT 'HospedagemPagamentoOperacao'
  UNION ALL SELECT 'ReservaPeriodoMovimentacao'
  UNION ALL SELECT 'ReservaSuiteMovimentacao'
) AS e
LEFT JOIN information_schema.TABLES AS t
  ON t.TABLE_SCHEMA = DATABASE()
 AND t.TABLE_NAME = e.TABLE_NAME
 AND t.TABLE_TYPE = 'BASE TABLE'
ORDER BY e.TABLE_NAME;


-- =============================================================================
-- 2. COLUNAS — colunas adicionadas pelo deploy
-- =============================================================================
SELECT
  e.TABLE_NAME,
  e.COLUMN_NAME,
  c.COLUMN_TYPE,
  c.IS_NULLABLE,
  c.COLUMN_DEFAULT,
  c.EXTRA,
  CASE
    WHEN c.COLUMN_NAME IS NOT NULL THEN 'YES'
    ELSE 'NO'
  END AS EXISTS_FLAG
FROM (
  SELECT 'ReservaHospedagem' AS TABLE_NAME, 'id_externo' AS COLUMN_NAME
  UNION ALL SELECT 'ReservaHospedagem', 'codigo_externo'
  UNION ALL SELECT 'ReservaHospedagem', 'canal_venda'
  UNION ALL SELECT 'ReservaHospedagem', 'token_pagamento'
  UNION ALL SELECT 'ReservaHospedagem', 'expira_em'
  UNION ALL SELECT 'ReservaHospedagem', 'link_pagamento_enviado_em'
  UNION ALL SELECT 'ReservaHospedagem', 'data_hora_chegada_real'
  UNION ALL SELECT 'ReservaHospedagem', 'id_usuario_chegada'
  UNION ALL SELECT 'ReservaHospedagem', 'id_venda_jango'
  UNION ALL SELECT 'ReservaHospedagem', 'observacao_importada'
  UNION ALL SELECT 'ReservaHospedagem', 'observacao_operador'
  UNION ALL SELECT 'ReservaHospedagem', 'possivel_pagamento_ota'
  UNION ALL SELECT 'ReservaHospedagem', 'possivel_pagamento_ota_trecho'
  UNION ALL SELECT 'ReservaHospede', 'id_usuario'
  UNION ALL SELECT 'Transacao', 'origem_transacao'
) AS e
LEFT JOIN information_schema.COLUMNS AS c
  ON c.TABLE_SCHEMA = DATABASE()
 AND c.TABLE_NAME = e.TABLE_NAME
 AND c.COLUMN_NAME = e.COLUMN_NAME
ORDER BY e.TABLE_NAME, e.COLUMN_NAME;


-- =============================================================================
-- 3. ÍNDICES — 6 índices previstos no pacote de deploy
-- =============================================================================
SELECT
  e.TABLE_NAME,
  e.INDEX_NAME,
  s.NON_UNIQUE,
  GROUP_CONCAT(s.COLUMN_NAME ORDER BY s.SEQ_IN_INDEX SEPARATOR ', ') AS COLUMNS,
  CASE
    WHEN COUNT(s.COLUMN_NAME) > 0 THEN 'YES'
    ELSE 'NO'
  END AS EXISTS_FLAG
FROM (
  SELECT 'ReservaHospedagem' AS TABLE_NAME, 'idx_reserva_hosp_origem_id_externo' AS INDEX_NAME
  UNION ALL SELECT 'ReservaHospedagem', 'idx_reserva_hosp_codigo_externo'
  UNION ALL SELECT 'ReservaHospedagem', 'idx_reserva_hosp_canal_venda'
  UNION ALL SELECT 'ReservaHospedagem', 'uq_reserva_hosp_token_pagamento'
  UNION ALL SELECT 'ReservaHospedagem', 'idx_reserva_hosp_possivel_pagamento_ota'
  UNION ALL SELECT 'ReservaHospede', 'idx_reserva_hospede_id_usuario'
) AS e
LEFT JOIN information_schema.STATISTICS AS s
  ON s.TABLE_SCHEMA = DATABASE()
 AND s.TABLE_NAME = e.TABLE_NAME
 AND s.INDEX_NAME = e.INDEX_NAME
GROUP BY e.TABLE_NAME, e.INDEX_NAME, s.NON_UNIQUE
ORDER BY e.TABLE_NAME, e.INDEX_NAME;


-- =============================================================================
-- 4. FOREIGN KEYS — ReservaHospedagem + 6 tabelas novas
-- =============================================================================
SELECT
  e.CONSTRAINT_NAME,
  e.TABLE_NAME,
  k.COLUMN_NAME,
  k.REFERENCED_TABLE_NAME,
  k.REFERENCED_COLUMN_NAME,
  rc.DELETE_RULE,
  rc.UPDATE_RULE,
  CASE
    WHEN k.CONSTRAINT_NAME IS NOT NULL THEN 'YES'
    ELSE 'NO'
  END AS EXISTS_FLAG
FROM (
  SELECT 'ReservaHospedagem' AS TABLE_NAME, 'fk_reserva_hospedagem_usuario_chegada' AS CONSTRAINT_NAME
  UNION ALL SELECT 'EventoSuiteFoto', 'fk_evento_suite_foto_suite'
  UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_evento_suite'
  UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_reserva_hospedagem'
  UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_reserva_suite'
  UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_usuario_inicio'
  UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_usuario_fim'
  UNION ALL SELECT 'HospedagemPagamentoOperacao', 'fk_hosp_pag_op_reserva'
  UNION ALL SELECT 'HospedagemPagamentoOperacao', 'fk_hosp_pag_op_usuario'
  UNION ALL SELECT 'ReservaPeriodoMovimentacao', 'fk_periodo_mov_reserva'
  UNION ALL SELECT 'ReservaPeriodoMovimentacao', 'fk_periodo_mov_usuario'
  UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_reserva'
  UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_reserva_suite'
  UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_suite_origem'
  UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_suite_destino'
  UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_usuario'
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
-- 5. ESTRUTURA DAS 6 TABELAS NOVAS (information_schema)
-- =============================================================================

-- 5a. Colunas
SELECT
  c.TABLE_NAME,
  c.ORDINAL_POSITION,
  c.COLUMN_NAME,
  c.COLUMN_TYPE,
  c.IS_NULLABLE,
  c.COLUMN_DEFAULT,
  c.EXTRA,
  c.COLUMN_KEY
FROM information_schema.COLUMNS AS c
WHERE c.TABLE_SCHEMA = DATABASE()
  AND c.TABLE_NAME IN (
    'hospedagem_refresh_state',
    'EventoSuiteFoto',
    'EventoSuiteLimpeza',
    'HospedagemPagamentoOperacao',
    'ReservaPeriodoMovimentacao',
    'ReservaSuiteMovimentacao'
  )
ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION;


-- 5b. Índices (inclui PRIMARY e UNIQUE)
SELECT
  s.TABLE_NAME,
  s.INDEX_NAME,
  s.NON_UNIQUE,
  s.SEQ_IN_INDEX,
  s.COLUMN_NAME,
  s.INDEX_TYPE
FROM information_schema.STATISTICS AS s
WHERE s.TABLE_SCHEMA = DATABASE()
  AND s.TABLE_NAME IN (
    'hospedagem_refresh_state',
    'EventoSuiteFoto',
    'EventoSuiteLimpeza',
    'HospedagemPagamentoOperacao',
    'ReservaPeriodoMovimentacao',
    'ReservaSuiteMovimentacao'
  )
ORDER BY s.TABLE_NAME, s.INDEX_NAME, s.SEQ_IN_INDEX;


-- 5c. Foreign keys das 6 tabelas novas
SELECT
  k.TABLE_NAME,
  k.CONSTRAINT_NAME,
  k.COLUMN_NAME,
  k.REFERENCED_TABLE_NAME,
  k.REFERENCED_COLUMN_NAME,
  rc.DELETE_RULE,
  rc.UPDATE_RULE
FROM information_schema.KEY_COLUMN_USAGE AS k
JOIN information_schema.REFERENTIAL_CONSTRAINTS AS rc
  ON rc.CONSTRAINT_SCHEMA = k.TABLE_SCHEMA
 AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME
 AND rc.TABLE_NAME = k.TABLE_NAME
WHERE k.TABLE_SCHEMA = DATABASE()
  AND k.TABLE_NAME IN (
    'hospedagem_refresh_state',
    'EventoSuiteFoto',
    'EventoSuiteLimpeza',
    'HospedagemPagamentoOperacao',
    'ReservaPeriodoMovimentacao',
    'ReservaSuiteMovimentacao'
  )
  AND k.REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION;


-- =============================================================================
-- 6. DADOS — contagens (deploy estrutural não deve ter copiado dados do DEV)
-- =============================================================================

-- 6a. Tabelas novas (esperado: 0 linhas logo após deploy estrutural, antes do uso operacional)
SELECT 'hospedagem_refresh_state' AS TABLE_NAME, COUNT(*) AS ROW_COUNT
FROM hospedagem_refresh_state
UNION ALL
SELECT 'EventoSuiteFoto', COUNT(*) FROM EventoSuiteFoto
UNION ALL
SELECT 'EventoSuiteLimpeza', COUNT(*) FROM EventoSuiteLimpeza
UNION ALL
SELECT 'HospedagemPagamentoOperacao', COUNT(*) FROM HospedagemPagamentoOperacao
UNION ALL
SELECT 'ReservaPeriodoMovimentacao', COUNT(*) FROM ReservaPeriodoMovimentacao
UNION ALL
SELECT 'ReservaSuiteMovimentacao', COUNT(*) FROM ReservaSuiteMovimentacao;


-- 6b. Tabelas operacionais existentes (referência / baseline)
SELECT 'ReservaHospedagem' AS TABLE_NAME, COUNT(*) AS ROW_COUNT
FROM ReservaHospedagem
UNION ALL
SELECT 'ReservaSuite', COUNT(*) FROM ReservaSuite
UNION ALL
SELECT 'EventoSuite', COUNT(*) FROM EventoSuite
UNION ALL
SELECT 'PagamentoHospedagem', COUNT(*) FROM PagamentoHospedagem;


-- =============================================================================
-- 7. TRANSACAO — origem_transacao após ADD COLUMN
-- =============================================================================
SELECT
  origem_transacao,
  COUNT(*) AS cnt
FROM Transacao
GROUP BY origem_transacao
ORDER BY origem_transacao;


SELECT
  COUNT(*) AS null_origem_transacao_count
FROM Transacao
WHERE origem_transacao IS NULL;


-- =============================================================================
-- 8. TOKEN PAGAMENTO — duplicidades que impediriam UNIQUE INDEX
-- =============================================================================
SELECT
  token_pagamento,
  COUNT(*) AS cnt
FROM ReservaHospedagem
WHERE token_pagamento IS NOT NULL
  AND token_pagamento <> ''
GROUP BY token_pagamento
HAVING COUNT(*) > 1;


-- =============================================================================
-- 9. RELATÓRIO FINAL — resumo OK / ERRO
-- =============================================================================
SELECT
  checks.CHECK_GROUP,
  checks.STATUS,
  checks.DETAIL
FROM (
  -- DEPLOY ESTRUTURAL (agregado)
  SELECT
    'DEPLOY ESTRUTURAL' AS CHECK_GROUP,
    CASE
      WHEN (
        SELECT COUNT(*)
        FROM (
          SELECT 'hospedagem_refresh_state' AS t
          UNION ALL SELECT 'EventoSuiteFoto'
          UNION ALL SELECT 'EventoSuiteLimpeza'
          UNION ALL SELECT 'HospedagemPagamentoOperacao'
          UNION ALL SELECT 'ReservaPeriodoMovimentacao'
          UNION ALL SELECT 'ReservaSuiteMovimentacao'
        ) AS exp
        LEFT JOIN information_schema.TABLES AS tt
          ON tt.TABLE_SCHEMA = DATABASE() AND tt.TABLE_NAME = exp.t
        WHERE tt.TABLE_NAME IS NULL
      ) = 0
      AND (
        SELECT COUNT(*)
        FROM (
          SELECT 'ReservaHospedagem' AS tbl, 'id_externo' AS col
          UNION ALL SELECT 'ReservaHospedagem', 'codigo_externo'
          UNION ALL SELECT 'ReservaHospedagem', 'canal_venda'
          UNION ALL SELECT 'ReservaHospedagem', 'token_pagamento'
          UNION ALL SELECT 'ReservaHospedagem', 'expira_em'
          UNION ALL SELECT 'ReservaHospedagem', 'link_pagamento_enviado_em'
          UNION ALL SELECT 'ReservaHospedagem', 'data_hora_chegada_real'
          UNION ALL SELECT 'ReservaHospedagem', 'id_usuario_chegada'
          UNION ALL SELECT 'ReservaHospedagem', 'id_venda_jango'
          UNION ALL SELECT 'ReservaHospedagem', 'observacao_importada'
          UNION ALL SELECT 'ReservaHospedagem', 'observacao_operador'
          UNION ALL SELECT 'ReservaHospedagem', 'possivel_pagamento_ota'
          UNION ALL SELECT 'ReservaHospedagem', 'possivel_pagamento_ota_trecho'
          UNION ALL SELECT 'ReservaHospede', 'id_usuario'
          UNION ALL SELECT 'Transacao', 'origem_transacao'
        ) AS exp
        LEFT JOIN information_schema.COLUMNS AS cc
          ON cc.TABLE_SCHEMA = DATABASE()
         AND cc.TABLE_NAME = exp.tbl
         AND cc.COLUMN_NAME = exp.col
        WHERE cc.COLUMN_NAME IS NULL
      ) = 0
      AND (
        SELECT COUNT(*)
        FROM (
          SELECT 'ReservaHospedagem' AS tbl, 'idx_reserva_hosp_origem_id_externo' AS idx
          UNION ALL SELECT 'ReservaHospedagem', 'idx_reserva_hosp_codigo_externo'
          UNION ALL SELECT 'ReservaHospedagem', 'idx_reserva_hosp_canal_venda'
          UNION ALL SELECT 'ReservaHospedagem', 'uq_reserva_hosp_token_pagamento'
          UNION ALL SELECT 'ReservaHospedagem', 'idx_reserva_hosp_possivel_pagamento_ota'
          UNION ALL SELECT 'ReservaHospede', 'idx_reserva_hospede_id_usuario'
        ) AS exp
        LEFT JOIN information_schema.STATISTICS AS ss
          ON ss.TABLE_SCHEMA = DATABASE()
         AND ss.TABLE_NAME = exp.tbl
         AND ss.INDEX_NAME = exp.idx
        WHERE ss.INDEX_NAME IS NULL
      ) = 0
      AND (
        SELECT COUNT(*)
        FROM (
          SELECT 'ReservaHospedagem' AS tbl, 'fk_reserva_hospedagem_usuario_chegada' AS fk
          UNION ALL SELECT 'EventoSuiteFoto', 'fk_evento_suite_foto_suite'
          UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_evento_suite'
          UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_reserva_hospedagem'
          UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_reserva_suite'
          UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_usuario_inicio'
          UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_usuario_fim'
          UNION ALL SELECT 'HospedagemPagamentoOperacao', 'fk_hosp_pag_op_reserva'
          UNION ALL SELECT 'HospedagemPagamentoOperacao', 'fk_hosp_pag_op_usuario'
          UNION ALL SELECT 'ReservaPeriodoMovimentacao', 'fk_periodo_mov_reserva'
          UNION ALL SELECT 'ReservaPeriodoMovimentacao', 'fk_periodo_mov_usuario'
          UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_reserva'
          UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_reserva_suite'
          UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_suite_origem'
          UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_suite_destino'
          UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_usuario'
        ) AS exp
        LEFT JOIN information_schema.TABLE_CONSTRAINTS AS tc
          ON tc.TABLE_SCHEMA = DATABASE()
         AND tc.TABLE_NAME = exp.tbl
         AND tc.CONSTRAINT_NAME = exp.fk
         AND tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
        WHERE tc.CONSTRAINT_NAME IS NULL
      ) = 0
      THEN 'OK'
      ELSE 'ERRO'
    END AS STATUS,
    'Visão agregada: tabelas, colunas, índices e FKs do pacote deploy-producao-hospedagem.sql' AS DETAIL

  UNION ALL

  -- TABELAS
  SELECT
    'TABELAS' AS CHECK_GROUP,
    CASE
      WHEN missing.cnt = 0 THEN 'OK'
      ELSE 'ERRO'
    END AS STATUS,
    CASE
      WHEN missing.cnt = 0 THEN 'Todas as 6 tabelas existem.'
      ELSE CONCAT('Faltando ', missing.cnt, ' tabela(s): ', missing.list)
    END AS DETAIL
  FROM (
    SELECT
      COUNT(*) AS cnt,
      GROUP_CONCAT(exp.t ORDER BY exp.t SEPARATOR ', ') AS list
    FROM (
      SELECT 'hospedagem_refresh_state' AS t
      UNION ALL SELECT 'EventoSuiteFoto'
      UNION ALL SELECT 'EventoSuiteLimpeza'
      UNION ALL SELECT 'HospedagemPagamentoOperacao'
      UNION ALL SELECT 'ReservaPeriodoMovimentacao'
      UNION ALL SELECT 'ReservaSuiteMovimentacao'
    ) AS exp
    LEFT JOIN information_schema.TABLES AS tt
      ON tt.TABLE_SCHEMA = DATABASE() AND tt.TABLE_NAME = exp.t
    WHERE tt.TABLE_NAME IS NULL
  ) AS missing

  UNION ALL

  -- COLUNAS
  SELECT
    'COLUNAS' AS CHECK_GROUP,
    CASE WHEN missing.cnt = 0 THEN 'OK' ELSE 'ERRO' END,
    CASE
      WHEN missing.cnt = 0 THEN 'Todas as 15 colunas existem.'
      ELSE CONCAT('Faltando ', missing.cnt, ' coluna(s): ', missing.list)
    END
  FROM (
    SELECT
      COUNT(*) AS cnt,
      GROUP_CONCAT(CONCAT(exp.tbl, '.', exp.col) ORDER BY exp.tbl, exp.col SEPARATOR ', ') AS list
    FROM (
      SELECT 'ReservaHospedagem' AS tbl, 'id_externo' AS col
      UNION ALL SELECT 'ReservaHospedagem', 'codigo_externo'
      UNION ALL SELECT 'ReservaHospedagem', 'canal_venda'
      UNION ALL SELECT 'ReservaHospedagem', 'token_pagamento'
      UNION ALL SELECT 'ReservaHospedagem', 'expira_em'
      UNION ALL SELECT 'ReservaHospedagem', 'link_pagamento_enviado_em'
      UNION ALL SELECT 'ReservaHospedagem', 'data_hora_chegada_real'
      UNION ALL SELECT 'ReservaHospedagem', 'id_usuario_chegada'
      UNION ALL SELECT 'ReservaHospedagem', 'id_venda_jango'
      UNION ALL SELECT 'ReservaHospedagem', 'observacao_importada'
      UNION ALL SELECT 'ReservaHospedagem', 'observacao_operador'
      UNION ALL SELECT 'ReservaHospedagem', 'possivel_pagamento_ota'
      UNION ALL SELECT 'ReservaHospedagem', 'possivel_pagamento_ota_trecho'
      UNION ALL SELECT 'ReservaHospede', 'id_usuario'
      UNION ALL SELECT 'Transacao', 'origem_transacao'
    ) AS exp
    LEFT JOIN information_schema.COLUMNS AS cc
      ON cc.TABLE_SCHEMA = DATABASE()
     AND cc.TABLE_NAME = exp.tbl
     AND cc.COLUMN_NAME = exp.col
    WHERE cc.COLUMN_NAME IS NULL
  ) AS missing

  UNION ALL

  -- ÍNDICES
  SELECT
    'INDICES' AS CHECK_GROUP,
    CASE WHEN missing.cnt = 0 THEN 'OK' ELSE 'ERRO' END,
    CASE
      WHEN missing.cnt = 0 THEN 'Todos os 6 índices existem.'
      ELSE CONCAT('Faltando ', missing.cnt, ' índice(s): ', missing.list)
    END
  FROM (
    SELECT
      COUNT(*) AS cnt,
      GROUP_CONCAT(CONCAT(exp.tbl, '.', exp.idx) ORDER BY exp.tbl, exp.idx SEPARATOR ', ') AS list
    FROM (
      SELECT 'ReservaHospedagem' AS tbl, 'idx_reserva_hosp_origem_id_externo' AS idx
      UNION ALL SELECT 'ReservaHospedagem', 'idx_reserva_hosp_codigo_externo'
      UNION ALL SELECT 'ReservaHospedagem', 'idx_reserva_hosp_canal_venda'
      UNION ALL SELECT 'ReservaHospedagem', 'uq_reserva_hosp_token_pagamento'
      UNION ALL SELECT 'ReservaHospedagem', 'idx_reserva_hosp_possivel_pagamento_ota'
      UNION ALL SELECT 'ReservaHospede', 'idx_reserva_hospede_id_usuario'
    ) AS exp
    LEFT JOIN information_schema.STATISTICS AS ss
      ON ss.TABLE_SCHEMA = DATABASE()
     AND ss.TABLE_NAME = exp.tbl
     AND ss.INDEX_NAME = exp.idx
    WHERE ss.INDEX_NAME IS NULL
  ) AS missing

  UNION ALL

  -- FOREIGN KEYS
  SELECT
    'FOREIGN KEYS' AS CHECK_GROUP,
    CASE WHEN missing.cnt = 0 THEN 'OK' ELSE 'ERRO' END,
    CASE
      WHEN missing.cnt = 0 THEN 'Todas as 16 FKs esperadas existem.'
      ELSE CONCAT('Faltando ', missing.cnt, ' FK(s): ', missing.list)
    END
  FROM (
    SELECT
      COUNT(*) AS cnt,
      GROUP_CONCAT(CONCAT(exp.tbl, '.', exp.fk) ORDER BY exp.tbl, exp.fk SEPARATOR ', ') AS list
    FROM (
      SELECT 'ReservaHospedagem' AS tbl, 'fk_reserva_hospedagem_usuario_chegada' AS fk
      UNION ALL SELECT 'EventoSuiteFoto', 'fk_evento_suite_foto_suite'
      UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_evento_suite'
      UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_reserva_hospedagem'
      UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_reserva_suite'
      UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_usuario_inicio'
      UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_usuario_fim'
      UNION ALL SELECT 'HospedagemPagamentoOperacao', 'fk_hosp_pag_op_reserva'
      UNION ALL SELECT 'HospedagemPagamentoOperacao', 'fk_hosp_pag_op_usuario'
      UNION ALL SELECT 'ReservaPeriodoMovimentacao', 'fk_periodo_mov_reserva'
      UNION ALL SELECT 'ReservaPeriodoMovimentacao', 'fk_periodo_mov_usuario'
      UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_reserva'
      UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_reserva_suite'
      UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_suite_origem'
      UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_suite_destino'
      UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_usuario'
    ) AS exp
    LEFT JOIN information_schema.TABLE_CONSTRAINTS AS tc
      ON tc.TABLE_SCHEMA = DATABASE()
     AND tc.TABLE_NAME = exp.tbl
     AND tc.CONSTRAINT_NAME = exp.fk
     AND tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
    WHERE tc.CONSTRAINT_NAME IS NULL
  ) AS missing

  UNION ALL

  -- DADOS (tabelas novas sem carga do DEV — esperado 0 linhas após deploy estrutural)
  SELECT
    'DADOS' AS CHECK_GROUP,
    CASE
      WHEN (
        (SELECT COUNT(*) FROM hospedagem_refresh_state)
        + (SELECT COUNT(*) FROM EventoSuiteFoto)
        + (SELECT COUNT(*) FROM EventoSuiteLimpeza)
        + (SELECT COUNT(*) FROM HospedagemPagamentoOperacao)
        + (SELECT COUNT(*) FROM ReservaPeriodoMovimentacao)
        + (SELECT COUNT(*) FROM ReservaSuiteMovimentacao)
      ) = 0 THEN 'OK'
      ELSE 'ERRO'
    END AS STATUS,
    CONCAT(
      'Soma linhas tabelas novas: ',
      (SELECT COUNT(*) FROM hospedagem_refresh_state)
      + (SELECT COUNT(*) FROM EventoSuiteFoto)
      + (SELECT COUNT(*) FROM EventoSuiteLimpeza)
      + (SELECT COUNT(*) FROM HospedagemPagamentoOperacao)
      + (SELECT COUNT(*) FROM ReservaPeriodoMovimentacao)
      + (SELECT COUNT(*) FROM ReservaSuiteMovimentacao),
      ' — esperado 0 logo após deploy estrutural (sem INSERT do pacote). ',
      'hospedagem_refresh_state pode ter 1 linha após o backend subir (normal).'
    ) AS DETAIL

  UNION ALL

  -- TRANSACAO
  SELECT
    'TRANSACAO' AS CHECK_GROUP,
    CASE
      WHEN (SELECT COUNT(*) FROM Transacao WHERE origem_transacao IS NULL) > 0 THEN 'ERRO'
      WHEN (SELECT COUNT(*) FROM Transacao WHERE origem_transacao NOT IN ('INGRESSOS', 'HOSPEDAGEM')) > 0 THEN 'ERRO'
      WHEN (SELECT COUNT(*) FROM Transacao) > 0
       AND (SELECT COUNT(*) FROM Transacao WHERE origem_transacao = 'INGRESSOS') = 0 THEN 'ERRO'
      ELSE 'OK'
    END AS STATUS,
    CONCAT(
      'NULL=', (SELECT COUNT(*) FROM Transacao WHERE origem_transacao IS NULL),
      '; INGRESSOS=', (SELECT COUNT(*) FROM Transacao WHERE origem_transacao = 'INGRESSOS'),
      '; HOSPEDAGEM=', (SELECT COUNT(*) FROM Transacao WHERE origem_transacao = 'HOSPEDAGEM'),
      '; total=', (SELECT COUNT(*) FROM Transacao)
    ) AS DETAIL

  UNION ALL

  -- TOKEN PAGAMENTO
  SELECT
    'TOKEN PAGAMENTO' AS CHECK_GROUP,
    CASE
      WHEN (
        SELECT COUNT(*)
        FROM (
          SELECT token_pagamento
          FROM ReservaHospedagem
          WHERE token_pagamento IS NOT NULL
            AND token_pagamento <> ''
          GROUP BY token_pagamento
          HAVING COUNT(*) > 1
        ) AS dups
      ) = 0 THEN 'OK'
      ELSE 'ERRO'
    END AS STATUS,
    CONCAT(
      'Duplicatas token_pagamento: ',
      (
        SELECT COUNT(*)
        FROM (
          SELECT token_pagamento
          FROM ReservaHospedagem
          WHERE token_pagamento IS NOT NULL
            AND token_pagamento <> ''
          GROUP BY token_pagamento
          HAVING COUNT(*) > 1
        ) AS dups
      )
    ) AS DETAIL
) AS checks
ORDER BY
  FIELD(
    checks.CHECK_GROUP,
    'DEPLOY ESTRUTURAL',
    'TABELAS',
    'COLUNAS',
    'INDICES',
    'FOREIGN KEYS',
    'DADOS',
    'TRANSACAO',
    'TOKEN PAGAMENTO'
  );


-- =============================================================================
-- 9b. DETALHAMENTO DE ERROS (somente itens faltantes — facilita correção)
-- =============================================================================
SELECT 'TABELA_FALTANDO' AS ISSUE_TYPE, exp.t AS OBJECT_NAME
FROM (
  SELECT 'hospedagem_refresh_state' AS t
  UNION ALL SELECT 'EventoSuiteFoto'
  UNION ALL SELECT 'EventoSuiteLimpeza'
  UNION ALL SELECT 'HospedagemPagamentoOperacao'
  UNION ALL SELECT 'ReservaPeriodoMovimentacao'
  UNION ALL SELECT 'ReservaSuiteMovimentacao'
) AS exp
LEFT JOIN information_schema.TABLES AS tt
  ON tt.TABLE_SCHEMA = DATABASE() AND tt.TABLE_NAME = exp.t
WHERE tt.TABLE_NAME IS NULL

UNION ALL

SELECT 'COLUNA_FALTANDO', CONCAT(exp.tbl, '.', exp.col)
FROM (
  SELECT 'ReservaHospedagem' AS tbl, 'id_externo' AS col
  UNION ALL SELECT 'ReservaHospedagem', 'codigo_externo'
  UNION ALL SELECT 'ReservaHospedagem', 'canal_venda'
  UNION ALL SELECT 'ReservaHospedagem', 'token_pagamento'
  UNION ALL SELECT 'ReservaHospedagem', 'expira_em'
  UNION ALL SELECT 'ReservaHospedagem', 'link_pagamento_enviado_em'
  UNION ALL SELECT 'ReservaHospedagem', 'data_hora_chegada_real'
  UNION ALL SELECT 'ReservaHospedagem', 'id_usuario_chegada'
  UNION ALL SELECT 'ReservaHospedagem', 'id_venda_jango'
  UNION ALL SELECT 'ReservaHospedagem', 'observacao_importada'
  UNION ALL SELECT 'ReservaHospedagem', 'observacao_operador'
  UNION ALL SELECT 'ReservaHospedagem', 'possivel_pagamento_ota'
  UNION ALL SELECT 'ReservaHospedagem', 'possivel_pagamento_ota_trecho'
  UNION ALL SELECT 'ReservaHospede', 'id_usuario'
  UNION ALL SELECT 'Transacao', 'origem_transacao'
) AS exp
LEFT JOIN information_schema.COLUMNS AS cc
  ON cc.TABLE_SCHEMA = DATABASE()
 AND cc.TABLE_NAME = exp.tbl
 AND cc.COLUMN_NAME = exp.col
WHERE cc.COLUMN_NAME IS NULL

UNION ALL

SELECT 'INDICE_FALTANDO', CONCAT(exp.tbl, '.', exp.idx)
FROM (
  SELECT 'ReservaHospedagem' AS tbl, 'idx_reserva_hosp_origem_id_externo' AS idx
  UNION ALL SELECT 'ReservaHospedagem', 'idx_reserva_hosp_codigo_externo'
  UNION ALL SELECT 'ReservaHospedagem', 'idx_reserva_hosp_canal_venda'
  UNION ALL SELECT 'ReservaHospedagem', 'uq_reserva_hosp_token_pagamento'
  UNION ALL SELECT 'ReservaHospedagem', 'idx_reserva_hosp_possivel_pagamento_ota'
  UNION ALL SELECT 'ReservaHospede', 'idx_reserva_hospede_id_usuario'
) AS exp
LEFT JOIN information_schema.STATISTICS AS ss
  ON ss.TABLE_SCHEMA = DATABASE()
 AND ss.TABLE_NAME = exp.tbl
 AND ss.INDEX_NAME = exp.idx
WHERE ss.INDEX_NAME IS NULL

UNION ALL

SELECT 'FK_FALTANDO', CONCAT(exp.tbl, '.', exp.fk)
FROM (
  SELECT 'ReservaHospedagem' AS tbl, 'fk_reserva_hospedagem_usuario_chegada' AS fk
  UNION ALL SELECT 'EventoSuiteFoto', 'fk_evento_suite_foto_suite'
  UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_evento_suite'
  UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_reserva_hospedagem'
  UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_reserva_suite'
  UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_usuario_inicio'
  UNION ALL SELECT 'EventoSuiteLimpeza', 'fk_limpeza_usuario_fim'
  UNION ALL SELECT 'HospedagemPagamentoOperacao', 'fk_hosp_pag_op_reserva'
  UNION ALL SELECT 'HospedagemPagamentoOperacao', 'fk_hosp_pag_op_usuario'
  UNION ALL SELECT 'ReservaPeriodoMovimentacao', 'fk_periodo_mov_reserva'
  UNION ALL SELECT 'ReservaPeriodoMovimentacao', 'fk_periodo_mov_usuario'
  UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_reserva'
  UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_reserva_suite'
  UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_suite_origem'
  UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_suite_destino'
  UNION ALL SELECT 'ReservaSuiteMovimentacao', 'fk_mov_usuario'
) AS exp
LEFT JOIN information_schema.TABLE_CONSTRAINTS AS tc
  ON tc.TABLE_SCHEMA = DATABASE()
 AND tc.TABLE_NAME = exp.tbl
 AND tc.CONSTRAINT_NAME = exp.fk
 AND tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
WHERE tc.CONSTRAINT_NAME IS NULL

UNION ALL

SELECT 'TRANSACAO_NULL', CONCAT('origem_transacao IS NULL em ', COUNT(*), ' linha(s)')
FROM Transacao
WHERE origem_transacao IS NULL
HAVING COUNT(*) > 0

UNION ALL

SELECT 'TRANSACAO_VALOR_INESPERADO', CONCAT('origem_transacao=', origem_transacao, ' cnt=', COUNT(*))
FROM Transacao
WHERE origem_transacao NOT IN ('INGRESSOS', 'HOSPEDAGEM')
GROUP BY origem_transacao

UNION ALL

SELECT 'TOKEN_DUPLICADO', CONCAT('token_pagamento=', token_pagamento, ' cnt=', COUNT(*))
FROM ReservaHospedagem
WHERE token_pagamento IS NOT NULL AND token_pagamento <> ''
GROUP BY token_pagamento
HAVING COUNT(*) > 1

ORDER BY ISSUE_TYPE, OBJECT_NAME;
