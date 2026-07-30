require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST || process.env.DB_HOSTNAME,
    user: process.env.DB_USER || process.env.DB_USERNAME,
    password: process.env.DB_PASS || process.env.DB_PASSWORD,
    database: process.env.DB_NAME || process.env.DB_DATABASE,
    multipleStatements: true,
  });
  const sql = fs.readFileSync(
    path.join(__dirname, 'alter-integration-sync-monitor.sql'),
    'utf8'
  );
  try {
    await c.query(sql);
  } catch (e) {
    // Índices/colunas podem já existir em reexecução parcial
    console.warn(String(e.message || e));
  }
  const [cols] = await c.query(
    "SHOW COLUMNS FROM integration_sync_state WHERE Field IN ('error_code','error_severityity','last_success_at','next_retry_at')"
  );
  const [tables] = await c.query(
    "SHOW TABLES LIKE 'integration_entity_sync_event'"
  );
  console.log(JSON.stringify({ cols, tables }, null, 2));
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
