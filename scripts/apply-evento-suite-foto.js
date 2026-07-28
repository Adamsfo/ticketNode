require('dotenv').config();
const { Sequelize } = require('sequelize');

const CREATE_SQL = `
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const s = new Sequelize(
  process.env.DB_NAME || 'ticketJango',
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: process.env.DB_DIALECT || 'mysql',
    logging: false,
  }
);

(async () => {
  await s.authenticate();
  await s.query(CREATE_SQL);
  const [cols] = await s.query('SHOW COLUMNS FROM EventoSuiteFoto');
  console.log('OK_COLS:', cols.map((c) => c.Field).join('|'));
  const [cnt] = await s.query('SELECT COUNT(*) AS c FROM EventoSuiteFoto');
  console.log('ROW_COUNT:', cnt[0].c);
  await s.close();
})().catch(async (e) => {
  console.error('FAIL:', e.message);
  try {
    await s.close();
  } catch (_) {}
  process.exit(1);
});
