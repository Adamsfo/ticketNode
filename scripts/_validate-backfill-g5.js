process.chdir(__dirname + '/..');
require('dotenv').config();

(async () => {
    const db = require('../dist/database').default || require('../dist/database');
    await new Promise((r) => setTimeout(r, 4000));

    const [nullCount] = await db.query(
        `SELECT COUNT(*) AS n FROM hospedin_outbound_sync_state
         WHERE outbound_status = 'SYNCED'
           AND hospedin_reservation_id IS NOT NULL AND TRIM(hospedin_reservation_id) <> ''
           AND (synced_hash_input_json IS NULL OR TRIM(synced_hash_input_json) = '')`
    );

    const [syncedAll] = await db.query(
        `SELECT id_reserva_hospedagem, outbound_status, desired_action, hospedin_reservation_id,
                payload_hash, pending_payload_hash,
                synced_hash_input_json IS NOT NULL AND TRIM(synced_hash_input_json) <> '' AS has_baseline,
                LENGTH(synced_hash_input_json) AS baseline_len
         FROM hospedin_outbound_sync_state
         WHERE outbound_status = 'SYNCED'
         ORDER BY id_reserva_hospedagem`
    );

    for (const id of [124, 126, 127]) {
        const [f] = await db.query(
            `SELECT * FROM hospedin_outbound_sync_state WHERE id_reserva_hospedagem = ${id}`
        );
        const [r] = await db.query(
            `SELECT id, id_externo, codigo_externo, origem_reserva, valor_total, valor_pago,
                    saldo_pendente, status, observacoes
             FROM ReservaHospedagem WHERE id = ${id}`
        );
        console.log(`RESERVA_${id}`, JSON.stringify({ fila: f[0], reserva: r[0] }, null, 2));
    }

    console.log('NULL_BASELINE_SYNCED_ELEGIVEIS', nullCount[0]);
    console.log('TODAS_SYNCED', JSON.stringify(syncedAll, null, 2));
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
