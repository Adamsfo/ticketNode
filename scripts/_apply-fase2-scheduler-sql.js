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
    path.join(__dirname, 'create-integration-scheduler-fase2.sql'),
    'utf8'
  );
  await c.query(sql);
  const [tables] = await c.query("SHOW TABLES LIKE 'integration_%'");
  console.log(JSON.stringify(tables, null, 2));
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
