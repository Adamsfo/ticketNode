-- =============================================================================
-- DIFERENÇAS ESTRUTURAIS: DEV -> PRODUÇÃO
-- Gerado em: 2026-09-04T10:42:45.491Z
-- ATENÇÃO: revisar antes de executar em produção.
-- NÃO inclui DROP, MODIFY arriscado, dados ou AUTO_INCREMENT.
--
-- *** LEIA ANTES DE USAR ***
-- Este arquivo foi gerado a partir do SHOW CREATE TABLE do DEV (minúsculas).
-- PRODUÇÃO usa PascalCase (ReservaHospedagem, EventoSuite, etc.).
-- Muitos CREATE TABLE abaixo referenciam tabelas minúsculas e contêm FKs
-- duplicadas do DEV — NÃO executar em bloco.
-- Para deploy, prefira os scripts versionados em ticket-node/scripts/*.sql
-- =============================================================================

-- =====================================================
-- DIFERENÇA: tabela eventosuitefoto existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `eventosuitefoto` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_evento_suite` int NOT NULL,
  `arquivo` varchar(255) NOT NULL,
  `ordem` int NOT NULL DEFAULT '1',
  `principal` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_evento_suite_foto_suite` (`id_evento_suite`),
  KEY `idx_evento_suite_foto_ordem` (`id_evento_suite`,`ordem`),
  CONSTRAINT `eventosuitefoto_ibfk_1` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_10` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_11` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_12` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_13` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_14` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_15` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_16` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_17` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_18` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_19` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_2` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_20` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_21` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_22` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_23` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_24` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_25` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_26` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_27` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_28` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_29` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_3` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_30` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_31` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_4` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_5` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_6` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_7` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_8` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitefoto_ibfk_9` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_evento_suite_foto_suite` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=32 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela eventosuitelimpeza existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `eventosuitelimpeza` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_evento_suite` int NOT NULL,
  `id_reserva_hospedagem` int NOT NULL,
  `id_reserva_suite` int NOT NULL,
  `status` enum('Pendente','EmAndamento','Concluida') NOT NULL DEFAULT 'Pendente',
  `data_hora_inicio` datetime DEFAULT NULL,
  `id_usuario_inicio` int DEFAULT NULL,
  `data_hora_fim` datetime DEFAULT NULL,
  `id_usuario_fim` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_limpeza_reserva_suite` (`id_reserva_hospedagem`,`id_evento_suite`),
  KEY `id_reserva_suite` (`id_reserva_suite`),
  KEY `id_usuario_inicio` (`id_usuario_inicio`),
  KEY `id_usuario_fim` (`id_usuario_fim`),
  KEY `idx_limpeza_suite_status` (`id_evento_suite`,`status`),
  KEY `idx_limpeza_status` (`status`),
  CONSTRAINT `eventosuitelimpeza_ibfk_1` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitelimpeza_ibfk_10` FOREIGN KEY (`id_usuario_fim`) REFERENCES `usuario` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `eventosuitelimpeza_ibfk_11` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitelimpeza_ibfk_12` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitelimpeza_ibfk_13` FOREIGN KEY (`id_reserva_suite`) REFERENCES `reservasuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitelimpeza_ibfk_14` FOREIGN KEY (`id_usuario_inicio`) REFERENCES `usuario` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `eventosuitelimpeza_ibfk_15` FOREIGN KEY (`id_usuario_fim`) REFERENCES `usuario` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `eventosuitelimpeza_ibfk_2` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitelimpeza_ibfk_3` FOREIGN KEY (`id_reserva_suite`) REFERENCES `reservasuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitelimpeza_ibfk_4` FOREIGN KEY (`id_usuario_inicio`) REFERENCES `usuario` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `eventosuitelimpeza_ibfk_5` FOREIGN KEY (`id_usuario_fim`) REFERENCES `usuario` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `eventosuitelimpeza_ibfk_6` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitelimpeza_ibfk_7` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitelimpeza_ibfk_8` FOREIGN KEY (`id_reserva_suite`) REFERENCES `reservasuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `eventosuitelimpeza_ibfk_9` FOREIGN KEY (`id_usuario_inicio`) REFERENCES `usuario` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela hospedagem_refresh_state existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `hospedagem_refresh_state` (
  `id` tinyint NOT NULL,
  `version` bigint unsigned NOT NULL DEFAULT '0',
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela hospedagempagamentooperacao existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `hospedagempagamentooperacao` (
  `id` int NOT NULL AUTO_INCREMENT,
  `uuid` varchar(64) NOT NULL,
  `tipo` varchar(30) NOT NULL DEFAULT 'HOSPEDAGEM',
  `origem` varchar(40) NOT NULL DEFAULT 'RECEBER_SALDO',
  `id_reserva_hospedagem` int NOT NULL,
  `id_usuario` int NOT NULL,
  `valor` decimal(14,2) NOT NULL,
  `forma_pagamento` varchar(40) NOT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'PENDENTE',
  `order_id_super_tef` varchar(64) NOT NULL,
  `id_externo_super_tef` varchar(120) DEFAULT NULL,
  `observacao` text,
  `mensagem_status` varchar(255) DEFAULT NULL,
  `raw_inicio` text,
  `id_pagamento_hospedagem` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uuid` (`uuid`),
  UNIQUE KEY `order_id_super_tef` (`order_id_super_tef`),
  UNIQUE KEY `uuid_2` (`uuid`),
  UNIQUE KEY `order_id_super_tef_2` (`order_id_super_tef`),
  UNIQUE KEY `uuid_3` (`uuid`),
  UNIQUE KEY `order_id_super_tef_3` (`order_id_super_tef`),
  UNIQUE KEY `uuid_4` (`uuid`),
  UNIQUE KEY `order_id_super_tef_4` (`order_id_super_tef`),
  UNIQUE KEY `uuid_5` (`uuid`),
  UNIQUE KEY `order_id_super_tef_5` (`order_id_super_tef`),
  UNIQUE KEY `uuid_6` (`uuid`),
  UNIQUE KEY `order_id_super_tef_6` (`order_id_super_tef`),
  UNIQUE KEY `uuid_7` (`uuid`),
  UNIQUE KEY `order_id_super_tef_7` (`order_id_super_tef`),
  UNIQUE KEY `uuid_8` (`uuid`),
  UNIQUE KEY `order_id_super_tef_8` (`order_id_super_tef`),
  UNIQUE KEY `uuid_9` (`uuid`),
  UNIQUE KEY `order_id_super_tef_9` (`order_id_super_tef`),
  UNIQUE KEY `uuid_10` (`uuid`),
  UNIQUE KEY `order_id_super_tef_10` (`order_id_super_tef`),
  KEY `id_reserva_hospedagem` (`id_reserva_hospedagem`),
  KEY `id_usuario` (`id_usuario`),
  CONSTRAINT `hospedagempagamentooperacao_ibfk_1` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedagempagamentooperacao_ibfk_10` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedagempagamentooperacao_ibfk_11` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedagempagamentooperacao_ibfk_12` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedagempagamentooperacao_ibfk_13` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedagempagamentooperacao_ibfk_14` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedagempagamentooperacao_ibfk_15` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedagempagamentooperacao_ibfk_16` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedagempagamentooperacao_ibfk_17` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedagempagamentooperacao_ibfk_18` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedagempagamentooperacao_ibfk_19` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedagempagamentooperacao_ibfk_2` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedagempagamentooperacao_ibfk_20` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedagempagamentooperacao_ibfk_3` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedagempagamentooperacao_ibfk_4` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedagempagamentooperacao_ibfk_5` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedagempagamentooperacao_ibfk_6` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedagempagamentooperacao_ibfk_7` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedagempagamentooperacao_ibfk_8` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedagempagamentooperacao_ibfk_9` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela hospedin_outbound_sync_state existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `hospedin_outbound_sync_state` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_reserva_hospedagem` int NOT NULL,
  `outbound_status` varchar(32) NOT NULL DEFAULT 'PENDING_CREATE',
  `desired_action` varchar(16) NOT NULL DEFAULT 'CREATE',
  `payload_hash` varchar(64) DEFAULT NULL,
  `pending_payload_hash` varchar(64) DEFAULT NULL,
  `synced_hash_input_json` text,
  `hospedin_reservation_id` varchar(64) DEFAULT NULL,
  `hospedin_guest_id` varchar(64) DEFAULT NULL,
  `retry_count` int NOT NULL DEFAULT '0',
  `next_retry_at` datetime DEFAULT NULL,
  `last_error` text,
  `error_code` varchar(64) DEFAULT NULL,
  `last_sync_at` datetime DEFAULT NULL,
  `last_success_at` datetime DEFAULT NULL,
  `processing_started_at` datetime DEFAULT NULL,
  `processing_correlation_id` varchar(64) DEFAULT NULL,
  `dirty_at` datetime NOT NULL,
  `outbound_version` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id_reserva_hospedagem` (`id_reserva_hospedagem`),
  CONSTRAINT `hospedin_outbound_sync_state_ibfk_1` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedin_outbound_sync_state_ibfk_2` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedin_outbound_sync_state_ibfk_3` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `hospedin_outbound_sync_state_ibfk_4` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela hospedin_place_suite_map existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `hospedin_place_suite_map` (
  `id` int NOT NULL AUTO_INCREMENT,
  `provider` varchar(40) NOT NULL DEFAULT 'HOSPEDIN',
  `place_id` bigint NOT NULL,
  `id_evento_suite` int DEFAULT NULL,
  `id_evento` int DEFAULT NULL,
  `ativo` tinyint(1) NOT NULL DEFAULT '1',
  `mapping_status` varchar(20) NOT NULL DEFAULT 'LINKED',
  `notes` varchar(255) DEFAULT NULL,
  `mapped_at` datetime NOT NULL,
  `mapped_by` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `place_id` (`place_id`),
  UNIQUE KEY `place_id_2` (`place_id`),
  UNIQUE KEY `place_id_3` (`place_id`),
  UNIQUE KEY `place_id_4` (`place_id`),
  UNIQUE KEY `place_id_5` (`place_id`),
  UNIQUE KEY `place_id_6` (`place_id`),
  UNIQUE KEY `place_id_7` (`place_id`),
  UNIQUE KEY `place_id_8` (`place_id`),
  UNIQUE KEY `place_id_9` (`place_id`),
  UNIQUE KEY `place_id_10` (`place_id`),
  UNIQUE KEY `place_id_11` (`place_id`),
  UNIQUE KEY `place_id_12` (`place_id`),
  UNIQUE KEY `place_id_13` (`place_id`),
  UNIQUE KEY `place_id_14` (`place_id`),
  UNIQUE KEY `place_id_15` (`place_id`),
  UNIQUE KEY `place_id_16` (`place_id`),
  UNIQUE KEY `place_id_17` (`place_id`),
  UNIQUE KEY `place_id_18` (`place_id`),
  UNIQUE KEY `place_id_19` (`place_id`),
  UNIQUE KEY `place_id_20` (`place_id`),
  UNIQUE KEY `id_evento_suite` (`id_evento_suite`),
  KEY `idx_hospedin_place_suite_mapping_status` (`mapping_status`,`ativo`),
  CONSTRAINT `fk_hospedin_place_suite_evento_suite` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`),
  CONSTRAINT `hospedin_place_suite_map_ibfk_1` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`),
  CONSTRAINT `hospedin_place_suite_map_ibfk_2` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`),
  CONSTRAINT `hospedin_place_suite_map_ibfk_3` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`),
  CONSTRAINT `hospedin_place_suite_map_ibfk_4` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`),
  CONSTRAINT `hospedin_place_suite_map_ibfk_5` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`),
  CONSTRAINT `hospedin_place_suite_map_ibfk_6` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`),
  CONSTRAINT `hospedin_place_suite_map_ibfk_7` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`),
  CONSTRAINT `hospedin_place_suite_map_ibfk_8` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`),
  CONSTRAINT `hospedin_place_suite_map_ibfk_9` FOREIGN KEY (`id_evento_suite`) REFERENCES `eventosuite` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela hospedin_place_types existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `hospedin_place_types` (
  `id` int NOT NULL AUTO_INCREMENT,
  `place_type_id` bigint NOT NULL,
  `nome` varchar(255) NOT NULL,
  `capacidade` int DEFAULT NULL,
  `payload_json` json DEFAULT NULL,
  `synced_at` datetime NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `place_type_id` (`place_type_id`),
  UNIQUE KEY `place_type_id_2` (`place_type_id`),
  UNIQUE KEY `place_type_id_3` (`place_type_id`),
  UNIQUE KEY `place_type_id_4` (`place_type_id`),
  UNIQUE KEY `place_type_id_5` (`place_type_id`),
  UNIQUE KEY `place_type_id_6` (`place_type_id`),
  UNIQUE KEY `place_type_id_7` (`place_type_id`),
  UNIQUE KEY `place_type_id_8` (`place_type_id`),
  UNIQUE KEY `place_type_id_9` (`place_type_id`),
  UNIQUE KEY `place_type_id_10` (`place_type_id`),
  UNIQUE KEY `place_type_id_11` (`place_type_id`),
  UNIQUE KEY `place_type_id_12` (`place_type_id`),
  UNIQUE KEY `place_type_id_13` (`place_type_id`),
  UNIQUE KEY `place_type_id_14` (`place_type_id`),
  UNIQUE KEY `place_type_id_15` (`place_type_id`),
  UNIQUE KEY `place_type_id_16` (`place_type_id`),
  UNIQUE KEY `place_type_id_17` (`place_type_id`),
  UNIQUE KEY `place_type_id_18` (`place_type_id`),
  UNIQUE KEY `place_type_id_19` (`place_type_id`),
  UNIQUE KEY `place_type_id_20` (`place_type_id`),
  UNIQUE KEY `place_type_id_21` (`place_type_id`),
  UNIQUE KEY `place_type_id_22` (`place_type_id`),
  UNIQUE KEY `place_type_id_23` (`place_type_id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela hospedin_places existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `hospedin_places` (
  `id` int NOT NULL AUTO_INCREMENT,
  `place_id` bigint NOT NULL,
  `place_type_id` bigint DEFAULT NULL,
  `nome` varchar(255) NOT NULL,
  `capacidade` int DEFAULT NULL,
  `ativo` tinyint(1) NOT NULL DEFAULT '1',
  `payload_json` json DEFAULT NULL,
  `synced_at` datetime NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `place_id` (`place_id`),
  UNIQUE KEY `place_id_2` (`place_id`),
  UNIQUE KEY `place_id_3` (`place_id`),
  UNIQUE KEY `place_id_4` (`place_id`),
  UNIQUE KEY `place_id_5` (`place_id`),
  UNIQUE KEY `place_id_6` (`place_id`),
  UNIQUE KEY `place_id_7` (`place_id`),
  UNIQUE KEY `place_id_8` (`place_id`),
  UNIQUE KEY `place_id_9` (`place_id`),
  UNIQUE KEY `place_id_10` (`place_id`),
  UNIQUE KEY `place_id_11` (`place_id`),
  UNIQUE KEY `place_id_12` (`place_id`),
  UNIQUE KEY `place_id_13` (`place_id`),
  UNIQUE KEY `place_id_14` (`place_id`),
  UNIQUE KEY `place_id_15` (`place_id`),
  UNIQUE KEY `place_id_16` (`place_id`),
  UNIQUE KEY `place_id_17` (`place_id`),
  UNIQUE KEY `place_id_18` (`place_id`),
  UNIQUE KEY `place_id_19` (`place_id`),
  UNIQUE KEY `place_id_20` (`place_id`),
  UNIQUE KEY `place_id_21` (`place_id`),
  UNIQUE KEY `place_id_22` (`place_id`),
  UNIQUE KEY `place_id_23` (`place_id`)
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela hospedin_reservations existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `hospedin_reservations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `reservation_id` bigint NOT NULL,
  `status` varchar(64) DEFAULT NULL,
  `checkin` datetime DEFAULT NULL,
  `checkout` datetime DEFAULT NULL,
  `payload_json` json DEFAULT NULL,
  `imported_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `reservation_id` (`reservation_id`),
  UNIQUE KEY `reservation_id_2` (`reservation_id`),
  UNIQUE KEY `reservation_id_3` (`reservation_id`),
  UNIQUE KEY `reservation_id_4` (`reservation_id`),
  UNIQUE KEY `reservation_id_5` (`reservation_id`),
  UNIQUE KEY `reservation_id_6` (`reservation_id`),
  UNIQUE KEY `reservation_id_7` (`reservation_id`),
  UNIQUE KEY `reservation_id_8` (`reservation_id`),
  UNIQUE KEY `reservation_id_9` (`reservation_id`),
  UNIQUE KEY `reservation_id_10` (`reservation_id`),
  UNIQUE KEY `reservation_id_11` (`reservation_id`),
  UNIQUE KEY `reservation_id_12` (`reservation_id`),
  UNIQUE KEY `reservation_id_13` (`reservation_id`),
  UNIQUE KEY `reservation_id_14` (`reservation_id`),
  UNIQUE KEY `reservation_id_15` (`reservation_id`),
  UNIQUE KEY `reservation_id_16` (`reservation_id`),
  UNIQUE KEY `reservation_id_17` (`reservation_id`),
  UNIQUE KEY `reservation_id_18` (`reservation_id`),
  UNIQUE KEY `reservation_id_19` (`reservation_id`),
  UNIQUE KEY `reservation_id_20` (`reservation_id`),
  UNIQUE KEY `reservation_id_21` (`reservation_id`),
  UNIQUE KEY `reservation_id_22` (`reservation_id`),
  UNIQUE KEY `reservation_id_23` (`reservation_id`)
) ENGINE=InnoDB AUTO_INCREMENT=18286 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela hospedin_sync_log existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `hospedin_sync_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `operacao` varchar(80) NOT NULL,
  `endpoint` varchar(512) DEFAULT NULL,
  `metodo` varchar(16) DEFAULT NULL,
  `request_json` json DEFAULT NULL,
  `response_json` json DEFAULT NULL,
  `status` int DEFAULT NULL,
  `duracao_ms` int DEFAULT NULL,
  `data` datetime NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `sucesso` tinyint(1) NOT NULL DEFAULT '0',
  `erro` text,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=103882 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela integration_entity_sync_event existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `integration_entity_sync_event` (
  `id` int NOT NULL AUTO_INCREMENT,
  `provider` varchar(40) NOT NULL,
  `entity_type` varchar(40) NOT NULL,
  `external_id` varchar(128) NOT NULL,
  `internal_entity_id` varchar(64) DEFAULT NULL,
  `operation` varchar(32) NOT NULL,
  `result` varchar(20) NOT NULL,
  `error_code` varchar(64) DEFAULT NULL,
  `error_severityity` varchar(20) DEFAULT NULL,
  `message` text,
  `duration_ms` int DEFAULT NULL,
  `correlation_id` varchar(64) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_entity_sync_ext` (`provider`,`entity_type`,`external_id`,`created_at`),
  KEY `idx_entity_sync_internal` (`internal_entity_id`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=730 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela integration_provider_config existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `integration_provider_config` (
  `id` int NOT NULL AUTO_INCREMENT,
  `provider` varchar(40) NOT NULL,
  `display_name` varchar(80) NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '0',
  `interval_minutes` int NOT NULL DEFAULT '5',
  `mode` varchar(20) NOT NULL DEFAULT 'incremental',
  `sync_limit` int NOT NULL DEFAULT '50',
  `priority` int NOT NULL DEFAULT '100',
  `max_retries` int NOT NULL DEFAULT '2',
  `backoff_base_seconds` int NOT NULL DEFAULT '30',
  `max_run_minutes` int NOT NULL DEFAULT '10',
  `webhook_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_integration_provider_config` (`provider`),
  UNIQUE KEY `provider` (`provider`),
  UNIQUE KEY `provider_2` (`provider`),
  UNIQUE KEY `provider_3` (`provider`),
  UNIQUE KEY `provider_4` (`provider`),
  UNIQUE KEY `provider_5` (`provider`),
  UNIQUE KEY `provider_6` (`provider`),
  UNIQUE KEY `provider_7` (`provider`),
  UNIQUE KEY `provider_8` (`provider`),
  UNIQUE KEY `provider_9` (`provider`),
  UNIQUE KEY `provider_10` (`provider`),
  UNIQUE KEY `provider_11` (`provider`),
  UNIQUE KEY `provider_12` (`provider`),
  UNIQUE KEY `provider_13` (`provider`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela integration_provider_state existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `integration_provider_state` (
  `id` int NOT NULL AUTO_INCREMENT,
  `provider` varchar(40) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'IDLE',
  `last_started_at` datetime DEFAULT NULL,
  `heartbeat_at` datetime DEFAULT NULL,
  `last_finished_at` datetime DEFAULT NULL,
  `last_success_at` datetime DEFAULT NULL,
  `last_error_at` datetime DEFAULT NULL,
  `last_error_message` text,
  `next_run_at` datetime DEFAULT NULL,
  `last_duration_ms` int DEFAULT NULL,
  `consecutive_failures` int NOT NULL DEFAULT '0',
  `last_execution_id` int DEFAULT NULL,
  `has_pending` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_integration_provider_state` (`provider`),
  UNIQUE KEY `provider` (`provider`),
  UNIQUE KEY `provider_2` (`provider`),
  UNIQUE KEY `provider_3` (`provider`),
  UNIQUE KEY `provider_4` (`provider`),
  UNIQUE KEY `provider_5` (`provider`),
  UNIQUE KEY `provider_6` (`provider`),
  UNIQUE KEY `provider_7` (`provider`),
  UNIQUE KEY `provider_8` (`provider`),
  UNIQUE KEY `provider_9` (`provider`),
  UNIQUE KEY `provider_10` (`provider`),
  UNIQUE KEY `provider_11` (`provider`),
  UNIQUE KEY `provider_12` (`provider`),
  UNIQUE KEY `provider_13` (`provider`),
  KEY `idx_provider_state_next_run` (`next_run_at`),
  KEY `idx_provider_state_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela integration_sync_execution existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `integration_sync_execution` (
  `id` int NOT NULL AUTO_INCREMENT,
  `provider` varchar(40) NOT NULL,
  `trigger_source` varchar(20) NOT NULL,
  `mode` varchar(20) DEFAULT NULL,
  `correlation_id` varchar(64) NOT NULL,
  `started_at` datetime NOT NULL,
  `finished_at` datetime DEFAULT NULL,
  `duration_ms` int DEFAULT NULL,
  `status` varchar(20) NOT NULL,
  `imported` int DEFAULT NULL,
  `validated` int DEFAULT NULL,
  `validated_ready` int DEFAULT NULL,
  `validated_ignored` int DEFAULT NULL,
  `created_count` int DEFAULT NULL,
  `updated_count` int DEFAULT NULL,
  `cancelled_count` int DEFAULT NULL,
  `failed_count` int DEFAULT NULL,
  `skipped_count` int DEFAULT NULL,
  `unchanged_count` int DEFAULT NULL,
  `error_message` text,
  `summary_json` json DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sync_exec_provider_started` (`provider`,`started_at`),
  KEY `idx_sync_exec_status` (`status`),
  KEY `idx_sync_exec_correlation` (`correlation_id`)
) ENGINE=InnoDB AUTO_INCREMENT=502 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela integration_sync_state existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `integration_sync_state` (
  `id` int NOT NULL AUTO_INCREMENT,
  `provider` varchar(40) NOT NULL,
  `entity_type` varchar(40) NOT NULL,
  `external_id` varchar(128) NOT NULL,
  `correlation_id` varchar(64) NOT NULL,
  `validation_status` varchar(64) DEFAULT NULL,
  `sync_action` varchar(32) DEFAULT NULL,
  `sync_status` varchar(32) NOT NULL DEFAULT 'NEW',
  `payload_hash` varchar(64) DEFAULT NULL,
  `retry_count` int NOT NULL DEFAULT '0',
  `next_retry_at` datetime DEFAULT NULL,
  `last_validation_at` datetime DEFAULT NULL,
  `last_sync_at` datetime DEFAULT NULL,
  `last_success_at` datetime DEFAULT NULL,
  `last_error` text,
  `error_code` varchar(64) DEFAULT NULL,
  `error_severityity` varchar(20) DEFAULT NULL,
  `resolution_status` varchar(20) NOT NULL DEFAULT 'OPEN',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `internal_entity_id` varchar(64) DEFAULT NULL,
  `sync_version` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_sync_state_status_entity` (`entity_type`,`sync_status`),
  KEY `idx_sync_state_internal` (`internal_entity_id`),
  KEY `idx_sync_state_severityity` (`error_severityity`,`sync_status`),
  KEY `idx_sync_state_next_retry` (`next_retry_at`,`sync_status`),
  KEY `idx_sync_state_resolution` (`resolution_status`,`sync_status`)
) ENGINE=InnoDB AUTO_INCREMENT=220 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela reserva_hospede_documento existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `reserva_hospede_documento` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_reserva_hospede` int NOT NULL,
  `provider` varchar(40) DEFAULT NULL,
  `tipo` varchar(40) NOT NULL,
  `numero` varchar(80) NOT NULL,
  `pais_emissao` varchar(8) DEFAULT NULL,
  `observacao` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `id_reserva_hospede` (`id_reserva_hospede`),
  CONSTRAINT `reserva_hospede_documento_ibfk_1` FOREIGN KEY (`id_reserva_hospede`) REFERENCES `reservahospede` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_hospede_documento_ibfk_10` FOREIGN KEY (`id_reserva_hospede`) REFERENCES `reservahospede` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_hospede_documento_ibfk_2` FOREIGN KEY (`id_reserva_hospede`) REFERENCES `reservahospede` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_hospede_documento_ibfk_3` FOREIGN KEY (`id_reserva_hospede`) REFERENCES `reservahospede` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_hospede_documento_ibfk_4` FOREIGN KEY (`id_reserva_hospede`) REFERENCES `reservahospede` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_hospede_documento_ibfk_5` FOREIGN KEY (`id_reserva_hospede`) REFERENCES `reservahospede` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_hospede_documento_ibfk_6` FOREIGN KEY (`id_reserva_hospede`) REFERENCES `reservahospede` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_hospede_documento_ibfk_7` FOREIGN KEY (`id_reserva_hospede`) REFERENCES `reservahospede` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_hospede_documento_ibfk_8` FOREIGN KEY (`id_reserva_hospede`) REFERENCES `reservahospede` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_hospede_documento_ibfk_9` FOREIGN KEY (`id_reserva_hospede`) REFERENCES `reservahospede` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=228 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela reserva_identificador_externo existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `reserva_identificador_externo` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_reserva_hospedagem` int NOT NULL,
  `provider` varchar(40) NOT NULL,
  `tipo` varchar(40) NOT NULL,
  `valor` varchar(128) NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `id_reserva_hospedagem` (`id_reserva_hospedagem`),
  CONSTRAINT `reserva_identificador_externo_ibfk_1` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_identificador_externo_ibfk_10` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_identificador_externo_ibfk_2` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_identificador_externo_ibfk_3` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_identificador_externo_ibfk_4` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_identificador_externo_ibfk_5` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_identificador_externo_ibfk_6` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_identificador_externo_ibfk_7` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_identificador_externo_ibfk_8` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_identificador_externo_ibfk_9` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=249 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela reserva_origem_financeira existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `reserva_origem_financeira` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_reserva_hospedagem` int NOT NULL,
  `provider` varchar(40) NOT NULL,
  `moeda` char(3) DEFAULT NULL,
  `total_cents` int DEFAULT NULL,
  `received_cents` int DEFAULT NULL,
  `to_receive_cents` int DEFAULT NULL,
  `daily_cents` int DEFAULT NULL,
  `total_daily_cents` int DEFAULT NULL,
  `discount_cents` int DEFAULT NULL,
  `product_cents` int DEFAULT NULL,
  `service_cents` int DEFAULT NULL,
  `items_count` int DEFAULT NULL,
  `payment_from_ota` tinyint(1) DEFAULT NULL,
  `status_pagamento` varchar(64) DEFAULT NULL,
  `forma_pagamento` varchar(64) DEFAULT NULL,
  `origem_pagamento` varchar(40) DEFAULT NULL,
  `responsavel_pagamento` varchar(64) DEFAULT NULL,
  `raw_json` json DEFAULT NULL,
  `payload_hash` varchar(64) DEFAULT NULL,
  `synced_at` datetime NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `id_reserva_hospedagem` (`id_reserva_hospedagem`),
  CONSTRAINT `reserva_origem_financeira_ibfk_1` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_origem_financeira_ibfk_10` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_origem_financeira_ibfk_2` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_origem_financeira_ibfk_3` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_origem_financeira_ibfk_4` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_origem_financeira_ibfk_5` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_origem_financeira_ibfk_6` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_origem_financeira_ibfk_7` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_origem_financeira_ibfk_8` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_origem_financeira_ibfk_9` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=125 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela reserva_origem_payload existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `reserva_origem_payload` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_reserva_hospedagem` int NOT NULL,
  `provider` varchar(40) NOT NULL,
  `kind` varchar(40) NOT NULL,
  `external_id` varchar(64) DEFAULT NULL,
  `payload_json` json NOT NULL,
  `payload_hash` varchar(64) NOT NULL,
  `captured_at` datetime NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `id_reserva_hospedagem` (`id_reserva_hospedagem`),
  CONSTRAINT `reserva_origem_payload_ibfk_1` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_origem_payload_ibfk_10` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_origem_payload_ibfk_2` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_origem_payload_ibfk_3` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_origem_payload_ibfk_4` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_origem_payload_ibfk_5` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_origem_payload_ibfk_6` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_origem_payload_ibfk_7` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_origem_payload_ibfk_8` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reserva_origem_payload_ibfk_9` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=249 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela reservaperiodomovimentacao existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `reservaperiodomovimentacao` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_reserva_hospedagem` int NOT NULL,
  `id_usuario` int NOT NULL,
  `data_hora` datetime NOT NULL,
  `checkin_anterior` datetime NOT NULL,
  `checkout_anterior` datetime NOT NULL,
  `checkin_novo` datetime NOT NULL,
  `checkout_novo` datetime NOT NULL,
  `motivo` varchar(255) DEFAULT NULL,
  `tipo` varchar(40) NOT NULL DEFAULT 'ALTERACAO',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `id_reserva_hospedagem` (`id_reserva_hospedagem`),
  KEY `id_usuario` (`id_usuario`),
  CONSTRAINT `reservaperiodomovimentacao_ibfk_1` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservaperiodomovimentacao_ibfk_10` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservaperiodomovimentacao_ibfk_11` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservaperiodomovimentacao_ibfk_12` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservaperiodomovimentacao_ibfk_13` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservaperiodomovimentacao_ibfk_14` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservaperiodomovimentacao_ibfk_15` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservaperiodomovimentacao_ibfk_16` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservaperiodomovimentacao_ibfk_2` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservaperiodomovimentacao_ibfk_3` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservaperiodomovimentacao_ibfk_4` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservaperiodomovimentacao_ibfk_5` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservaperiodomovimentacao_ibfk_6` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservaperiodomovimentacao_ibfk_7` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservaperiodomovimentacao_ibfk_8` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservaperiodomovimentacao_ibfk_9` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: tabela reservasuitemovimentacao existe no DEV e não na PRODUÇÃO
-- =====================================================
CREATE TABLE `reservasuitemovimentacao` (
  `id` int NOT NULL AUTO_INCREMENT,
  `id_reserva_hospedagem` int NOT NULL,
  `id_reserva_suite` int NOT NULL,
  `id_evento_suite_origem` int NOT NULL,
  `id_evento_suite_destino` int NOT NULL,
  `id_usuario` int NOT NULL,
  `data_hora` datetime NOT NULL,
  `motivo` varchar(255) DEFAULT NULL,
  `tipo` varchar(40) NOT NULL DEFAULT 'TRANSFERENCIA',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `id_reserva_hospedagem` (`id_reserva_hospedagem`),
  KEY `id_reserva_suite` (`id_reserva_suite`),
  KEY `id_evento_suite_origem` (`id_evento_suite_origem`),
  KEY `id_evento_suite_destino` (`id_evento_suite_destino`),
  KEY `id_usuario` (`id_usuario`),
  CONSTRAINT `reservasuitemovimentacao_ibfk_1` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_10` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_11` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_12` FOREIGN KEY (`id_reserva_suite`) REFERENCES `reservasuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_13` FOREIGN KEY (`id_evento_suite_origem`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_14` FOREIGN KEY (`id_evento_suite_destino`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_15` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_16` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_17` FOREIGN KEY (`id_reserva_suite`) REFERENCES `reservasuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_18` FOREIGN KEY (`id_evento_suite_origem`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_19` FOREIGN KEY (`id_evento_suite_destino`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_2` FOREIGN KEY (`id_reserva_suite`) REFERENCES `reservasuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_20` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_21` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_22` FOREIGN KEY (`id_reserva_suite`) REFERENCES `reservasuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_23` FOREIGN KEY (`id_evento_suite_origem`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_24` FOREIGN KEY (`id_evento_suite_destino`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_25` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_26` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_27` FOREIGN KEY (`id_reserva_suite`) REFERENCES `reservasuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_28` FOREIGN KEY (`id_evento_suite_origem`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_29` FOREIGN KEY (`id_evento_suite_destino`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_3` FOREIGN KEY (`id_evento_suite_origem`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_30` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_31` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_32` FOREIGN KEY (`id_reserva_suite`) REFERENCES `reservasuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_33` FOREIGN KEY (`id_evento_suite_origem`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_34` FOREIGN KEY (`id_evento_suite_destino`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_35` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_36` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_37` FOREIGN KEY (`id_reserva_suite`) REFERENCES `reservasuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_38` FOREIGN KEY (`id_evento_suite_origem`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_39` FOREIGN KEY (`id_evento_suite_destino`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_4` FOREIGN KEY (`id_evento_suite_destino`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_40` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_41` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_42` FOREIGN KEY (`id_reserva_suite`) REFERENCES `reservasuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_43` FOREIGN KEY (`id_evento_suite_origem`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_44` FOREIGN KEY (`id_evento_suite_destino`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_45` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_46` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_47` FOREIGN KEY (`id_reserva_suite`) REFERENCES `reservasuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_48` FOREIGN KEY (`id_evento_suite_origem`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_49` FOREIGN KEY (`id_evento_suite_destino`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_5` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_50` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_6` FOREIGN KEY (`id_reserva_hospedagem`) REFERENCES `reservahospedagem` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_7` FOREIGN KEY (`id_reserva_suite`) REFERENCES `reservasuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_8` FOREIGN KEY (`id_evento_suite_origem`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `reservasuitemovimentacao_ibfk_9` FOREIGN KEY (`id_evento_suite_destino`) REFERENCES `eventosuite` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================
-- DIFERENÇA: ReservaHospedagem.id_externo — DEV possui, PROD não [FOCO]
-- (DEV: reservahospedagem.id_externo)
-- =====================================================
ALTER TABLE `ReservaHospedagem`
  ADD COLUMN `id_externo` varchar(64) NULL;

-- =====================================================
-- DIFERENÇA: ReservaHospedagem.codigo_externo — DEV possui, PROD não [FOCO]
-- (DEV: reservahospedagem.codigo_externo)
-- =====================================================
ALTER TABLE `ReservaHospedagem`
  ADD COLUMN `codigo_externo` varchar(64) NULL;

-- =====================================================
-- DIFERENÇA: ReservaHospedagem.canal_venda — DEV possui, PROD não [FOCO]
-- (DEV: reservahospedagem.canal_venda)
-- =====================================================
ALTER TABLE `ReservaHospedagem`
  ADD COLUMN `canal_venda` varchar(40) NULL;

-- =====================================================
-- DIFERENÇA: ReservaHospedagem.token_pagamento — DEV possui, PROD não [FOCO]
-- (DEV: reservahospedagem.token_pagamento)
-- =====================================================
ALTER TABLE `ReservaHospedagem`
  ADD COLUMN `token_pagamento` varchar(64) NULL;

-- =====================================================
-- DIFERENÇA: ReservaHospedagem.expira_em — DEV possui, PROD não [FOCO]
-- (DEV: reservahospedagem.expira_em)
-- =====================================================
ALTER TABLE `ReservaHospedagem`
  ADD COLUMN `expira_em` datetime NULL;

-- =====================================================
-- DIFERENÇA: ReservaHospedagem.link_pagamento_enviado_em — DEV possui, PROD não [FOCO]
-- (DEV: reservahospedagem.link_pagamento_enviado_em)
-- =====================================================
ALTER TABLE `ReservaHospedagem`
  ADD COLUMN `link_pagamento_enviado_em` datetime NULL;

-- =====================================================
-- DIFERENÇA: ReservaHospedagem.data_hora_chegada_real — DEV possui, PROD não [FOCO]
-- (DEV: reservahospedagem.data_hora_chegada_real)
-- =====================================================
ALTER TABLE `ReservaHospedagem`
  ADD COLUMN `data_hora_chegada_real` datetime NULL;

-- =====================================================
-- DIFERENÇA: ReservaHospedagem.id_usuario_chegada — DEV possui, PROD não [FOCO]
-- (DEV: reservahospedagem.id_usuario_chegada)
-- =====================================================
ALTER TABLE `ReservaHospedagem`
  ADD COLUMN `id_usuario_chegada` int NULL;

-- =====================================================
-- DIFERENÇA: ReservaHospedagem.observacao_importada — DEV possui, PROD não [FOCO]
-- (DEV: reservahospedagem.observacao_importada)
-- =====================================================
ALTER TABLE `ReservaHospedagem`
  ADD COLUMN `observacao_importada` text NULL;

-- =====================================================
-- DIFERENÇA: ReservaHospedagem.observacao_operador — DEV possui, PROD não [FOCO]
-- (DEV: reservahospedagem.observacao_operador)
-- =====================================================
ALTER TABLE `ReservaHospedagem`
  ADD COLUMN `observacao_operador` text NULL;

-- =====================================================
-- DIFERENÇA: ReservaHospedagem.possivel_pagamento_ota — DEV possui, PROD não [FOCO]
-- (DEV: reservahospedagem.possivel_pagamento_ota)
-- =====================================================
ALTER TABLE `ReservaHospedagem`
  ADD COLUMN `possivel_pagamento_ota` tinyint(1) NOT NULL DEFAULT '0';

-- =====================================================
-- DIFERENÇA: ReservaHospedagem.possivel_pagamento_ota_trecho — DEV possui, PROD não [FOCO]
-- (DEV: reservahospedagem.possivel_pagamento_ota_trecho)
-- =====================================================
ALTER TABLE `ReservaHospedagem`
  ADD COLUMN `possivel_pagamento_ota_trecho` text NULL;

-- =====================================================
-- DIFERENÇA: ReservaHospedagem.id_venda_jango — DEV possui, PROD não [FOCO]
-- (DEV: reservahospedagem.id_venda_jango)
-- =====================================================
ALTER TABLE `ReservaHospedagem`
  ADD COLUMN `id_venda_jango` int NULL;

-- =====================================================
-- DIFERENÇA: ReservaHospede.id_usuario — DEV possui, PROD não [FOCO]
-- (DEV: reservahospede.id_usuario)
-- =====================================================
ALTER TABLE `ReservaHospede`
  ADD COLUMN `id_usuario` int NULL;

-- =====================================================
-- DIFERENÇA: Transacao.origem_transacao — DEV possui, PROD não
-- (DEV: transacao.origem_transacao)
-- =====================================================
ALTER TABLE `Transacao`
  ADD COLUMN `origem_transacao` enum('INGRESSOS','HOSPEDAGEM') NOT NULL DEFAULT 'INGRESSOS';

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_27
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_27` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_28
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_28` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_29
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_29` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_30
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_30` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_31
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_31` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_32
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_32` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_33
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_33` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_34
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_34` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_35
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_35` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_36
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_36` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_37
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_37` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_38
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_38` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_39
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_39` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_40
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_40` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_41
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_41` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_42
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_42` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_43
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_43` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_44
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_44` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_45
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_45` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_46
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_46` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_47
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_47` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_48
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_48` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_49
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_49` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_50
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_50` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_51
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_51` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_52
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_52` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_53
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_53` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_54
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_54` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_55
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_55` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_56
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_56` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_57
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_57` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: Empresa.cnpj_58
ALTER TABLE `Empresa`
  ADD UNIQUE INDEX `cnpj_58` (`cnpj`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_27
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_27` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_28
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_28` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_29
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_29` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_30
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_30` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_31
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_31` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_32
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_32` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_33
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_33` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_34
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_34` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_35
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_35` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_36
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_36` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_37
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_37` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_38
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_38` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_39
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_39` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_40
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_40` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_41
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_41` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_42
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_42` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_43
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_43` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_44
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_44` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_45
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_45` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: FuncaoUsuario.funcao_usuario_46
ALTER TABLE `FuncaoUsuario`
  ADD UNIQUE INDEX `funcao_usuario_46` (`funcao_usuario`);

-- ÍNDICE presente no DEV e ausente na PROD: ReservaHospedagem.id_usuario_chegada
ALTER TABLE `ReservaHospedagem`
  ADD INDEX `id_usuario_chegada` (`id_usuario_chegada`);

-- ÍNDICE presente no DEV e ausente na PROD: ReservaHospedagem.token_pagamento
ALTER TABLE `ReservaHospedagem`
  ADD UNIQUE INDEX `token_pagamento` (`token_pagamento`);

-- ÍNDICE presente no DEV e ausente na PROD: ReservaHospedagem.token_pagamento_10
ALTER TABLE `ReservaHospedagem`
  ADD UNIQUE INDEX `token_pagamento_10` (`token_pagamento`);

-- ÍNDICE presente no DEV e ausente na PROD: ReservaHospedagem.token_pagamento_2
ALTER TABLE `ReservaHospedagem`
  ADD UNIQUE INDEX `token_pagamento_2` (`token_pagamento`);

-- ÍNDICE presente no DEV e ausente na PROD: ReservaHospedagem.token_pagamento_3
ALTER TABLE `ReservaHospedagem`
  ADD UNIQUE INDEX `token_pagamento_3` (`token_pagamento`);

-- ÍNDICE presente no DEV e ausente na PROD: ReservaHospedagem.token_pagamento_4
ALTER TABLE `ReservaHospedagem`
  ADD UNIQUE INDEX `token_pagamento_4` (`token_pagamento`);

-- ÍNDICE presente no DEV e ausente na PROD: ReservaHospedagem.token_pagamento_5
ALTER TABLE `ReservaHospedagem`
  ADD UNIQUE INDEX `token_pagamento_5` (`token_pagamento`);

-- ÍNDICE presente no DEV e ausente na PROD: ReservaHospedagem.token_pagamento_6
ALTER TABLE `ReservaHospedagem`
  ADD UNIQUE INDEX `token_pagamento_6` (`token_pagamento`);

-- ÍNDICE presente no DEV e ausente na PROD: ReservaHospedagem.token_pagamento_7
ALTER TABLE `ReservaHospedagem`
  ADD UNIQUE INDEX `token_pagamento_7` (`token_pagamento`);

-- ÍNDICE presente no DEV e ausente na PROD: ReservaHospedagem.token_pagamento_8
ALTER TABLE `ReservaHospedagem`
  ADD UNIQUE INDEX `token_pagamento_8` (`token_pagamento`);

-- ÍNDICE presente no DEV e ausente na PROD: ReservaHospedagem.token_pagamento_9
ALTER TABLE `ReservaHospedagem`
  ADD UNIQUE INDEX `token_pagamento_9` (`token_pagamento`);

-- ÍNDICE presente no DEV e ausente na PROD: ReservaHospede.id_usuario
ALTER TABLE `ReservaHospede`
  ADD INDEX `id_usuario` (`id_usuario`);
