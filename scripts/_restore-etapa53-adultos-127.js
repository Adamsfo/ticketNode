/**
 * Restaura adultos/criancas da #127 e realinha fila outbound — ZERO HTTP.
 *
 *   node scripts/_restore-etapa53-adultos-127.js
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const TARGET_RESERVA_ID = 127;
const RESTORE_ADULTOS = 2;
const RESTORE_CRIANCAS = 0;

function log(tag, data) {
  if (data === undefined) console.log(tag);
  else console.log(tag, JSON.stringify(data, null, 2));
}

async function loadReservaFull(sequelize, idReserva) {
  const [rows] = await sequelize.query(
    `SELECT rh.id, rh.id_externo, rh.codigo_externo, rh.origem_reserva,
            rh.valor_pago, rh.saldo_pendente, rh.valor_total, rh.status,
            rh.checkin, rh.checkout, rh.observacoes,
            rs.id AS reserva_suite_id, rs.id_evento_suite, rs.adultos, rs.criancas,
            es.nome AS suite_nome
     FROM ReservaHospedagem rh
     LEFT JOIN ReservaSuite rs ON rs.id_reserva_hospedagem = rh.id
     LEFT JOIN EventoSuite es ON es.id = rs.id_evento_suite
     WHERE rh.id = ?
     LIMIT 1`,
    { replacements: [idReserva] }
  );
  return rows[0] || null;
}

async function loadOutboundRow(sequelize, idReserva) {
  const [rows] = await sequelize.query(
    `SELECT * FROM hospedin_outbound_sync_state WHERE id_reserva_hospedagem = ?`,
    { replacements: [idReserva] }
  );
  return rows[0] || null;
}

async function loadReservaForSnapshot(idReserva) {
  const { ReservaHospedagem } = require('../dist/models/ReservaHospedagem');
  const { ReservaSuite } = require('../dist/models/ReservaSuite');
  const { ReservaHospede } = require('../dist/models/ReservaHospede');
  const { Evento } = require('../dist/models/Evento');
  return ReservaHospedagem.findByPk(idReserva, {
    include: [
      { model: Evento, as: 'Evento', attributes: ['id', 'tipo'], required: false },
      {
        model: ReservaSuite,
        as: 'ReservaSuite',
        required: false,
        include: [{ model: ReservaHospede, as: 'ReservaHospede', required: false }],
      },
    ],
  });
}

async function realignOutboundBaselineLocal(sequelize, idReserva) {
  const {
    buildSnapshotFromReserva,
    hashOutboundPayload,
    snapshotToHashInput,
    serializeHashInput,
  } = require('../dist/integrations/hospedin/outbound/HospedinOutboundSnapshot');
  const hospedagem = await loadReservaForSnapshot(idReserva);
  if (!hospedagem) throw new Error('Reserva nao encontrada.');
  const hashInput = snapshotToHashInput(buildSnapshotFromReserva(hospedagem));
  const hash = hashOutboundPayload(hashInput);
  const syncedJson = serializeHashInput(hashInput);
  await sequelize.query(
    `UPDATE hospedin_outbound_sync_state
     SET outbound_status = 'SYNCED',
         desired_action = 'UPDATE',
         payload_hash = ?,
         pending_payload_hash = ?,
         synced_hash_input_json = ?,
         last_error = NULL,
         error_code = NULL,
         updated_at = UTC_TIMESTAMP()
     WHERE id_reserva_hospedagem = ?`,
    { replacements: [hash, hash, syncedJson, idReserva] }
  );
  return { hash, hashInput, syncedJson };
}

async function main() {
  const connection =
    require('../dist/database').default || require('../dist/database');
  await new Promise((r) => setTimeout(r, 4000));

  const before = {
    reserva: await loadReservaFull(connection, TARGET_RESERVA_ID),
    fila: await loadOutboundRow(connection, TARGET_RESERVA_ID),
    isolate: {},
  };
  for (const id of [124, 126]) {
    before.isolate[id] = await loadOutboundRow(connection, id);
  }

  log('ANTES', before);

  await connection.query(
    `UPDATE ReservaSuite SET adultos = ?, criancas = ?, updated_at = NOW() WHERE id_reserva_hospedagem = ?`,
    { replacements: [RESTORE_ADULTOS, RESTORE_CRIANCAS, TARGET_RESERVA_ID] }
  );

  const realign = await realignOutboundBaselineLocal(connection, TARGET_RESERVA_ID);
  log('REALINHAMENTO', realign);

  const after = {
    reserva: await loadReservaFull(connection, TARGET_RESERVA_ID),
    fila: await loadOutboundRow(connection, TARGET_RESERVA_ID),
    isolate: {},
  };
  for (const id of [124, 126]) {
    after.isolate[id] = await loadOutboundRow(connection, id);
  }

  log('DEPOIS', after);

  const r = after.reserva;
  const f = after.fila;
  const obs = String(r.observacoes || '');
  const checks = [
    Number(r.adultos) === RESTORE_ADULTOS,
    Number(r.criancas) === RESTORE_CRIANCAS,
    Number(r.id_evento_suite) === 3,
    r.suite_nome === 'Tulipa',
    String(r.id_externo) === '30295972',
    String(r.codigo_externo) === 'HO:001321',
    String(r.origem_reserva) === 'ATENDENTE',
    String(r.valor_total) === '1100.00',
    String(r.valor_pago) === '0.00',
    String(r.saldo_pendente) === '1100.00',
    f.outbound_status === 'SYNCED',
    f.payload_hash === f.pending_payload_hash,
    String(f.hospedin_reservation_id) === '30295972',
    !f.last_error && !f.error_code,
    obs.includes('HOMOLOG UPDATE OUTBOUND #127 - OBS ALTERADA'),
    before.isolate[124].outbound_status === after.isolate[124].outbound_status,
    before.isolate[126].outbound_status === after.isolate[126].outbound_status,
    before.isolate[124].hospedin_reservation_id === after.isolate[124].hospedin_reservation_id,
    before.isolate[126].hospedin_reservation_id === after.isolate[126].hospedin_reservation_id,
  ];

  if (!checks.every(Boolean)) {
    throw new Error('Validacao pos-restauracao falhou.');
  }

  console.log('=== RESTAURACAO #127 OK — ZERO HTTP ===');
}

main().catch((e) => {
  console.error('RESTORE_FATAL', e && e.stack ? e.stack : e);
  process.exit(1);
});
