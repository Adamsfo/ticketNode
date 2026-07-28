-- EventoSuiteFoto (alinhado ao Sequelize underscored:true do projeto)
-- Colunas em snake_case, como EventoSuite (id_evento, created_at, ...)

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
