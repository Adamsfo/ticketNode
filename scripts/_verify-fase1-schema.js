const mysql = require('mysql2/promise');
require('dotenv').config();

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: String(process.env.DB_PASSWORD || '').trim(),
    database: process.env.DB_NAME,
  });

  const [cols] = await c.query(
    "SHOW COLUMNS FROM ReservaHospedagem WHERE Field IN ('id_externo','codigo_externo','canal_venda')"
  );
  const expectedTables = [
    'reserva_identificador_externo',
    'reserva_origem_financeira',
    'reserva_origem_payload',
    'reserva_hospede_documento',
  ];
  const tables = [];
  for (const t of expectedTables) {
    const [rows] = await c.query('SHOW TABLES LIKE ?', [t]);
    tables.push({ table: t, ok: rows.length > 0 });
  }

  const finCols = await c.query(
    "SHOW COLUMNS FROM reserva_origem_financeira WHERE Field IN ('status_pagamento','forma_pagamento','origem_pagamento','responsavel_pagamento','moeda')"
  );

  console.log(
    JSON.stringify(
      {
        reserva_cols: cols.map((r) => r.Field),
        tables,
        financeira_extra: finCols[0].map((r) => r.Field),
      },
      null,
      2
    )
  );
  await c.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
