-- Taxas adicionais manuais ao nível da reserva (recepção).
-- AUXILIAR / MANUAL — a forma oficial de criar o schema é a migration Sequelize:
--   src/database/migrations/20260911120000-create-reserva-hospedagem-taxa-adicional.js
--   npm run db:migrate
-- Use este script apenas para referência, bootstrap manual ou ambientes sem CLI.
-- NÃO executar em produção sem autorização explícita.

CREATE TABLE IF NOT EXISTS ReservaHospedagemTaxaAdicional (
  id INT NOT NULL AUTO_INCREMENT,
  id_reserva_hospedagem INT NOT NULL,
  id_reserva_suite INT NULL,
  descricao VARCHAR(500) NOT NULL,
  valor DECIMAL(14, 2) NOT NULL,
  ordem INT NOT NULL DEFAULT 1,
  id_usuario_criacao INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_reserva_hospedagem_taxa_reserva (id_reserva_hospedagem),
  KEY idx_reserva_hospedagem_taxa_suite (id_reserva_suite),
  KEY idx_reserva_hospedagem_taxa_ordem (id_reserva_hospedagem, ordem),
  CONSTRAINT fk_reserva_hospedagem_taxa_reserva
    FOREIGN KEY (id_reserva_hospedagem) REFERENCES ReservaHospedagem (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_reserva_hospedagem_taxa_suite
    FOREIGN KEY (id_reserva_suite) REFERENCES ReservaSuite (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_reserva_hospedagem_taxa_usuario
    FOREIGN KEY (id_usuario_criacao) REFERENCES Usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
