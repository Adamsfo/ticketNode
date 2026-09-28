/**
 * Leitura: PagamentoHospedagem Antecipado vs id_caixa_item
 * node --require dotenv/config scripts/audit-antecipado-pdv-readonly.js
 */
require('dotenv/config');
const { databaseReady, default: conn } = require('../dist/database');

(async () => {
    await databaseReady;
    const [rows] = await conn.query(`
    SELECT ph.id, ph.id_reserva_hospedagem AS idReserva, ph.valor, ph.data_pagamento AS dataPagamento,
           ph.forma_pagamento AS forma, ph.id_caixa_item AS idCaixaItem, ph.created_at AS createdAt
    FROM PagamentoHospedagem ph
    WHERE ph.forma_pagamento = 'Antecipado'
    ORDER BY ph.id DESC
    LIMIT 25
  `);
    const com = rows.filter((r) => r.idCaixaItem != null && Number(r.idCaixaItem) > 0);
    const sem = rows.filter((r) => !r.idCaixaItem || Number(r.idCaixaItem) <= 0);
    console.log('Ultimos 25 Antecipado — com idCaixaItem:', com.length);
    console.log('Ultimos 25 Antecipado — sem idCaixaItem:', sem.length);
    console.log('--- com PDV ---');
    console.log(JSON.stringify(com.slice(0, 5), null, 2));
    console.log('--- sem PDV (amostra) ---');
    console.log(JSON.stringify(sem.slice(0, 10), null, 2));

    const [desde27] = await conn.query(`
    SELECT id, id_reserva_hospedagem AS idReserva, valor, data_pagamento AS dataPagamento,
           id_caixa_item AS idCaixaItem, created_at AS createdAt
    FROM PagamentoHospedagem
    WHERE forma_pagamento = 'Antecipado' AND data_pagamento >= '2026-09-27'
    ORDER BY id
  `);
    console.log('--- Antecipado desde 2026-09-27 ---');
    console.log('count:', desde27.length);
    console.log(JSON.stringify(desde27, null, 2));
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
