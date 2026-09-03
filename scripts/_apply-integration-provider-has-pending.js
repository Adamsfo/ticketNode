/**
 * Aplica coluna has_pending em integration_provider_state (idempotente).
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const sleep = (ms) => new Promise((r) => setTimeout(r, 2000));

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    { replacements: [table, column] }
  );
  return rows.length > 0;
}

async function main() {
  const conn = require('../dist/database').default || require('../dist/database');
  await sleep(2000);

  const exists = await columnExists(conn, 'integration_provider_state', 'has_pending');
  if (exists) {
    console.log('has_pending já existe — nada a fazer.');
    return;
  }

  await conn.query(
    `ALTER TABLE integration_provider_state
     ADD COLUMN has_pending TINYINT(1) NOT NULL DEFAULT 0
     AFTER last_execution_id`
  );
  console.log('has_pending aplicado com sucesso.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
