/**
 * Aplica colunas heartbeat_at / max_run_minutes se ainda não existirem.
 * node scripts/_apply-scheduler-heartbeat.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function ensureColumn(c, table, column, ddl) {
  const [rows] = await c.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (Number(rows[0].n) > 0) {
    console.log(`ok: ${table}.${column} already exists`);
    return;
  }
  await c.query(ddl);
  console.log(`added: ${table}.${column}`);
}

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: String(process.env.DB_PASSWORD || '').trim(),
    database: process.env.DB_NAME,
  });
  await ensureColumn(
    c,
    'integration_provider_state',
    'heartbeat_at',
    `ALTER TABLE integration_provider_state
       ADD COLUMN heartbeat_at DATETIME NULL AFTER last_started_at`
  );
  await ensureColumn(
    c,
    'integration_provider_config',
    'max_run_minutes',
    `ALTER TABLE integration_provider_config
       ADD COLUMN max_run_minutes INT NOT NULL DEFAULT 10 AFTER backoff_base_seconds`
  );

  // Auto-recover HOSPEDIN stuck RUNNING (boot-equivalent).
  const [upd] = await c.query(`
    UPDATE integration_provider_state
    SET status = 'IDLE',
        last_finished_at = UTC_TIMESTAMP(),
        heartbeat_at = NULL,
        last_error_at = UTC_TIMESTAMP(),
        last_error_message = 'RUNNING órfão recuperado (migração heartbeat).',
        next_run_at = UTC_TIMESTAMP()
    WHERE status = 'RUNNING'
  `);
  console.log('recovered RUNNING rows:', upd.affectedRows);

  // Abort open executions left RUNNING
  const [updExec] = await c.query(`
    UPDATE integration_sync_execution
    SET status = 'ABORTED',
        finished_at = UTC_TIMESTAMP(),
        duration_ms = TIMESTAMPDIFF(SECOND, started_at, UTC_TIMESTAMP()) * 1000,
        error_message = COALESCE(error_message, 'Execução abandonada (migração heartbeat).')
    WHERE status = 'RUNNING' AND finished_at IS NULL
  `);
  console.log('aborted RUNNING executions:', updExec.affectedRows);

  await c.end();
  console.log('DONE');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
