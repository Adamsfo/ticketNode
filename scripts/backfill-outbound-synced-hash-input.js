/**
 * Backfill seguro de synced_hash_input_json (baseline outbound UPDATE).
 *
 * Critérios:
 *   - outbound_status = SYNCED
 *   - hospedin_reservation_id preenchido
 *   - synced_hash_input_json IS NULL
 *
 * Não altera: payload_hash, hospedin_reservation_id, idExterno, desired_action, outbound_status.
 * Sem HTTP Hospedin.
 *
 * Uso:
 *   cd ticket-node
 *   npm run build
 *   node scripts/backfill-outbound-synced-hash-input.js
 *   node scripts/backfill-outbound-synced-hash-input.js --dry-run
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');

function log(tag, data) {
    if (data === undefined) console.log(tag);
    else console.log(tag, JSON.stringify(data, null, 2));
}

async function main() {
    const connection =
        require('../dist/database').default || require('../dist/database');
    await new Promise((r) => setTimeout(r, 4000));

    const {
        buildSnapshotFromReserva,
        snapshotToHashInput,
        serializeHashInput,
        hashOutboundPayload,
    } = require('../dist/integrations/hospedin/outbound/HospedinOutboundSnapshot');
    const { ReservaHospedagem } = require('../dist/models/ReservaHospedagem');
    const { ReservaSuite } = require('../dist/models/ReservaSuite');

    const [rows] = await connection.query(
        `SELECT id, id_reserva_hospedagem, hospedin_reservation_id, payload_hash, pending_payload_hash
         FROM hospedin_outbound_sync_state
         WHERE outbound_status = 'SYNCED'
           AND hospedin_reservation_id IS NOT NULL
           AND TRIM(hospedin_reservation_id) <> ''
           AND (synced_hash_input_json IS NULL OR TRIM(synced_hash_input_json) = '')
         ORDER BY id_reserva_hospedagem ASC`
    );

    log('BACKFILL_ENCONTRADOS', {
        total: rows.length,
        dryRun: DRY_RUN,
        ids: rows.map((r) => r.id_reserva_hospedagem),
    });

    const updated = [];
    const failures = [];

    for (const row of rows) {
        const idReserva = Number(row.id_reserva_hospedagem);
        try {
            const hospedagem = await ReservaHospedagem.findByPk(idReserva, {
                include: [{ model: ReservaSuite, as: 'ReservaSuite' }],
            });
            if (!hospedagem) {
                failures.push({
                    idReservaHospedagem: idReserva,
                    error: 'ReservaHospedagem não encontrada',
                });
                continue;
            }

            const hashInput = snapshotToHashInput(
                buildSnapshotFromReserva(hospedagem)
            );
            const json = serializeHashInput(hashInput);
            const hash = hashOutboundPayload(hashInput);

            if (!DRY_RUN) {
                await connection.query(
                    `UPDATE hospedin_outbound_sync_state
                     SET synced_hash_input_json = ?, updated_at = NOW()
                     WHERE id = ?`,
                    { replacements: [json, row.id] }
                );
            }

            updated.push({
                idReservaHospedagem: idReserva,
                outboundStateId: row.id,
                hospedinReservationId: row.hospedin_reservation_id,
                hash,
                jsonLength: json.length,
            });
        } catch (error) {
            failures.push({
                idReservaHospedagem: idReserva,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    log('BACKFILL_RELATORIO', {
        encontrados: rows.length,
        atualizados: updated.length,
        falhas: failures.length,
        dryRun: DRY_RUN,
        processados: updated,
        failures,
    });

    if (failures.length > 0) {
        process.exitCode = 1;
    }
}

main().catch((e) => {
    console.error('BACKFILL_FATAL', e && e.stack ? e.stack : e);
    process.exit(1);
});
