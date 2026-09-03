/**
 * Homologação ETAPA 5.3 — UPDATE real período + suíte (#127 → Hospedin #30295972).
 *
 *   node scripts/_homolog-etapa5-outbound-update-periodo-suite-real.js --execute
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TARGET_RESERVA_ID = 127;
const EXPECTED_HOSPEDIN_ID = '30295972';
const EXPECTED_HOSPEDIN_CODE = 'HO:001321';
const ORIGINAL_SUITE_ID = 3;
const ORIGINAL_SUITE_NAME = 'Tulipa';
const ORIGINAL_ADULTOS = 2;
const ORIGINAL_CRIANCAS = 0;
const ISOLATE_RESERVA_IDS = [124, 126];

const FORBIDDEN_HTTP_FRAGMENTS = [
  '/reservation_transactions',
  '/sales',
  '/rate_reservations',
];
const FORBIDDEN_PATCH_KEYS = new Set([
  'daily_cents',
  'total_daily_cents',
  'sale_channel_id',
  'guest_id',
  'has_payment_coming_from_ota',
  'status',
]);

const args = new Set(process.argv.slice(2));
if (!args.has('--execute')) {
  console.error('Use --execute para homologacao real.');
  process.exit(1);
}

function log(tag, data) {
  if (data === undefined) console.log(tag);
  else console.log(tag, JSON.stringify(data, null, 2));
}

async function loadOutboundRow(sequelize, idReserva) {
  const [rows] = await sequelize.query(
    `SELECT * FROM hospedin_outbound_sync_state WHERE id_reserva_hospedagem = ?`,
    { replacements: [idReserva] }
  );
  return rows[0] || null;
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

async function restoreOutboundSnapshot(sequelize, idReserva, snap) {
  if (!snap) return;
  const keys = Object.keys(snap).filter((k) => k !== 'id');
  if (!keys.length) return;
  const sets = keys.map((k) => `\`${k}\` = ?`).join(', ');
  const values = keys.map((k) => snap[k]);
  await sequelize.query(
    `UPDATE hospedin_outbound_sync_state SET ${sets} WHERE id_reserva_hospedagem = ?`,
    { replacements: [...values, idReserva] }
  );
}

async function isolateForTest(sequelize, idReserva, snapshot) {
  if (!snapshot) return false;
  const claimable = new Set([
    'PENDING_CREATE',
    'PENDING_UPDATE',
    'WAIT_RETRY',
    'PROCESSING',
  ]);
  if (!claimable.has(String(snapshot.outbound_status || ''))) return false;
  await sequelize.query(
    `UPDATE hospedin_outbound_sync_state SET outbound_status = 'BLOCKED', updated_at = NOW() WHERE id_reserva_hospedagem = ?`,
    { replacements: [idReserva] }
  );
  return true;
}

async function countDueCandidates(sequelize) {
  const [rows] = await sequelize.query(
    `SELECT id_reserva_hospedagem, outbound_status, desired_action
     FROM hospedin_outbound_sync_state
     WHERE outbound_status IN ('PENDING_CREATE','PENDING_UPDATE','WAIT_RETRY')
       AND (next_retry_at IS NULL OR next_retry_at <= UTC_TIMESTAMP())
     ORDER BY dirty_at ASC LIMIT 30`
  );
  return rows;
}

async function resolveAdminForReserva(sequelize, idReserva) {
  const [rows] = await sequelize.query(
    `SELECT u.id FROM ReservaHospedagem rh
     JOIN Evento e ON e.id = rh.id_evento
     JOIN ProdutorAcesso pa ON pa.id_produtor = e.id_produtor AND pa.tipo_acesso = 'Administrador'
     JOIN Usuario u ON u.id = pa.id_usuario
     WHERE rh.id = ? AND u.ativo = 1 ORDER BY u.id ASC LIMIT 1`,
    { replacements: [idReserva] }
  );
  if (rows.length) return Number(rows[0].id);
  const [adm] = await sequelize.query(
    `SELECT id FROM Usuario WHERE adm_geral = 1 AND ativo = 1 ORDER BY id ASC LIMIT 1`
  );
  if (adm.length) return Number(adm[0].id);
  throw new Error('Admin nao encontrado.');
}

async function findAlternateMappedSuite(sequelize, excludeSuiteId, adultos, criancas) {
  const [rows] = await sequelize.query(
    `SELECT m.id_evento_suite, es.nome, es.qtde_minima_pessoas, es.qtde_maxima_pessoas,
            m.place_id, hp.place_type_id
     FROM hospedin_place_suite_map m
     JOIN EventoSuite es ON es.id = m.id_evento_suite
     LEFT JOIN hospedin_places hp ON hp.place_id = m.place_id
     WHERE m.ativo = 1 AND m.mapping_status = 'LINKED'
       AND m.id_evento_suite <> ?
     ORDER BY m.id_evento_suite ASC`,
    { replacements: [excludeSuiteId] }
  );
  const total = Number(adultos || 0) + Number(criancas || 0);
  const alt = rows.find((r) => {
    if (!r.place_id || !r.place_type_id) return false;
    const min = Number(r.qtde_minima_pessoas || 1);
    const max = Number(r.qtde_maxima_pessoas || min);
    return total >= min && total <= max;
  });
  if (!alt) {
    throw new Error(
      `Nenhuma suite alternativa LINKED compativel com ${total} hospede(s).`
    );
  }
  return alt;
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

/** Realinha fila SYNCED ao estado Jango atual sem HTTP (prep/cleanup homolog). */
async function realignOutboundBaselineLocal(sequelize, idReserva) {
  const {
    buildSnapshotFromReserva,
    hashOutboundPayload,
    snapshotToHashInput,
    serializeHashInput,
  } = require('../dist/integrations/hospedin/outbound/HospedinOutboundSnapshot');
  const hospedagem = await loadReservaForSnapshot(idReserva);
  if (!hospedagem) throw new Error('Reserva nao encontrada para realinhamento.');
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

async function ensureAdultosForTulipaPeriodChange(sequelize, idReserva, minPessoas) {
  const [rows] = await sequelize.query(
    `SELECT adultos, criancas FROM ReservaSuite WHERE id_reserva_hospedagem = ? LIMIT 1`,
    { replacements: [idReserva] }
  );
  const row = rows[0];
  if (!row) throw new Error('ReservaSuite ausente.');
  const total = Number(row.adultos || 0) + Number(row.criancas || 0);
  const min = Number(minPessoas || 1);
  if (total >= min) return { changed: false, before: row };
  const neededAdultos = min - Number(row.criancas || 0);
  await sequelize.query(
    `UPDATE ReservaSuite SET adultos = ?, updated_at = NOW() WHERE id_reserva_hospedagem = ?`,
    { replacements: [neededAdultos, idReserva] }
  );
  await realignOutboundBaselineLocal(sequelize, idReserva);
  return {
    changed: true,
    before: row,
    afterAdultos: neededAdultos,
  };
}

async function restoreReservaSuiteAdultos(sequelize, idReserva, adultos, criancas) {
  await sequelize.query(
    `UPDATE ReservaSuite SET adultos = ?, criancas = ?, updated_at = NOW() WHERE id_reserva_hospedagem = ?`,
    { replacements: [adultos, criancas, idReserva] }
  );
  await realignOutboundBaselineLocal(sequelize, idReserva);
}

function installHttpAudit() {
  const { hospedinApiClient } = require('../dist/integrations/hospedin/api/HospedinApiClient');
  const calls = [];
  const orig = {
    post: hospedinApiClient.post.bind(hospedinApiClient),
    get: hospedinApiClient.get.bind(hospedinApiClient),
    patch: hospedinApiClient.patch.bind(hospedinApiClient),
  };

  function guard(path) {
    const p = String(path || '');
    for (const frag of FORBIDDEN_HTTP_FRAGMENTS) {
      if (p.includes(frag)) throw new Error(`HTTP financeiro proibido: ${p}`);
    }
  }

  function wrap(method, fn) {
    return async (path, data, opts) => {
      guard(path);
      const entry = { method, path };
      if (data !== undefined) entry.body = data;
      calls.push(entry);
      return fn(path, data, opts);
    };
  }

  hospedinApiClient.post = wrap('POST', orig.post);
  hospedinApiClient.get = wrap('GET', orig.get);
  hospedinApiClient.patch = wrap('PATCH', orig.patch);

  return {
    calls,
    resetCounts() {
      calls.length = 0;
    },
    restore() {
      hospedinApiClient.post = orig.post;
      hospedinApiClient.get = orig.get;
      hospedinApiClient.patch = orig.patch;
    },
  };
}

function assertPatchSafe(body, allowedKeys) {
  if (!body || typeof body !== 'object') return;
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_PATCH_KEYS.has(key)) {
      throw new Error(`PATCH campo proibido: ${key}`);
    }
    if (allowedKeys && !allowedKeys.has(key)) {
      throw new Error(`PATCH campo inesperado: ${key}`);
    }
  }
}

function addDaysUtc(isoDate, days) {
  const d = new Date(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

async function assertOnly127Due(sequelize) {
  const due = await countDueCandidates(sequelize);
  if (
    due.length !== 1 ||
    Number(due[0].id_reserva_hospedagem) !== TARGET_RESERVA_ID
  ) {
    throw new Error(`Candidatos due invalidos: ${JSON.stringify(due)}`);
  }
  return due;
}

async function runOutboundProvider() {
  const { runProviderCycle } = require('../dist/integrations/core/SyncRunOrchestrator');
  const { IntegrationSyncTrigger } = require('../dist/models/IntegrationSyncExecution');
  return runProviderCycle('HOSPEDIN_OUTBOUND', IntegrationSyncTrigger.MANUAL, {
    force: true,
    syncLimit: 1,
  });
}

async function getHospedinReservation() {
  const { hospedinReservationService } = require('../dist/integrations/hospedin/services/HospedinReservationService');
  return hospedinReservationService.getReservationDto(EXPECTED_HOSPEDIN_ID);
}

async function assertQueueSynced(sequelize) {
  const q = await loadOutboundRow(sequelize, TARGET_RESERVA_ID);
  if (q.outbound_status !== 'SYNCED') {
    throw new Error(`Fila nao SYNCED: ${q.outbound_status}`);
  }
  if (q.payload_hash !== q.pending_payload_hash) {
    throw new Error('payload_hash != pending_payload_hash');
  }
  if (q.last_error || q.error_code) {
    throw new Error(`Erro na fila: ${q.error_code} ${q.last_error}`);
  }
  return q;
}

async function assertFinancialUnchanged(baseline, current) {
  for (const f of ['valor_total', 'valor_pago', 'saldo_pendente']) {
    if (String(baseline[f]) !== String(current[f])) {
      throw new Error(`Financeiro alterado ${f}: ${baseline[f]} -> ${current[f]}`);
    }
  }
}

async function processUpdateCycle(sequelize, httpAudit, label, patchAllowedKeys) {
  await assertOnly127Due(sequelize);
  const callsBefore = httpAudit.calls.length;

  const run = await runOutboundProvider();
  log(`${label}_PROVIDER`, run.summary);

  const newPatches = httpAudit.calls
    .slice(callsBefore)
    .filter((c) => c.method === 'PATCH');
  if (newPatches.length !== 1) {
    throw new Error(`${label}: esperado 1 PATCH, got ${newPatches.length}`);
  }

  const patch = newPatches[0];
  if (!String(patch.path).includes(`/reservations/${EXPECTED_HOSPEDIN_ID}`)) {
    throw new Error(`${label}: destino PATCH invalido ${patch.path}`);
  }
  assertPatchSafe(patch.body, patchAllowedKeys);

  const dto = await getHospedinReservation();
  const q = await assertQueueSynced(sequelize);

  return { patch, dto, queue: q, run };
}

async function main() {
  console.log('=== ETAPA 5.3 — UPDATE PERIODO + SUITE (#127) ===');

  const connection =
    require('../dist/database').default || require('../dist/database');
  await sleep(4000);

  const {
    alterarPeriodoReservaAdmin,
    trocarSuiteReservaAdmin,
  } = require('../dist/services/hospedagemAdminService');
  const { bootstrapIntegrationProviders } = require('../dist/integrations/bootstrap');
  bootstrapIntegrationProviders();

  const httpAudit = installHttpAudit();
  const isolateSnapshots = {};
  const reservaSnapshots = {};
  const report = { patches: [], gets: [], tests: [] };

  let baseline = null;
  let occupancyRestoredInFinally = false;

  try {
    for (const id of ISOLATE_RESERVA_IDS) {
      isolateSnapshots[id] = await loadOutboundRow(connection, id);
      reservaSnapshots[id] = await loadReservaFull(connection, id);
      await isolateForTest(connection, id, isolateSnapshots[id]);
    }

    baseline = {
      reserva: await loadReservaFull(connection, TARGET_RESERVA_ID),
      fila: await loadOutboundRow(connection, TARGET_RESERVA_ID),
    };

    log('BASELINE_127', baseline);

    if (String(baseline.reserva.id_externo) !== EXPECTED_HOSPEDIN_ID) {
      throw new Error('idExterno #127 divergente.');
    }
    if (Number(baseline.reserva.id_evento_suite) !== ORIGINAL_SUITE_ID) {
      throw new Error('Suite original nao e Tulipa/id=3.');
    }

    const idAdmin = await resolveAdminForReserva(connection, TARGET_RESERVA_ID);
    const origCheckin = new Date(baseline.reserva.checkin);
    const origCheckout = new Date(baseline.reserva.checkout);

    const adultosPrep = await ensureAdultosForTulipaPeriodChange(
      connection,
      TARGET_RESERVA_ID,
      3
    );
    log('PREP_adultos_tulipa', adultosPrep);

    const tempCheckin = addDaysUtc(origCheckin, 4);
    const tempCheckout = addDaysUtc(origCheckout, 4);

    // ========== TESTE 1 — PERIODO ==========
    log('TESTE1_alterar_periodo', {
      de: { checkin: origCheckin.toISOString(), checkout: origCheckout.toISOString() },
      para: { checkin: tempCheckin.toISOString(), checkout: tempCheckout.toISOString() },
    });

    await alterarPeriodoReservaAdmin({
      idReservaHospedagem: TARGET_RESERVA_ID,
      idUsuario: idAdmin,
      checkin: tempCheckin,
      checkout: tempCheckout,
      motivo: 'HOMOLOG ETAPA5.3 UPDATE PERIODO',
    });

    const q1dirty = await loadOutboundRow(connection, TARGET_RESERVA_ID);
    if (q1dirty.pending_payload_hash === q1dirty.payload_hash) {
      throw new Error('TESTE1: hash nao divergiu apos alterar periodo.');
    }
    if (String(q1dirty.desired_action).toUpperCase() !== 'UPDATE') {
      throw new Error('TESTE1: desired_action nao e UPDATE.');
    }
    if (q1dirty.outbound_status !== 'PENDING_UPDATE') {
      throw new Error(`TESTE1: outbound_status esperado PENDING_UPDATE, got ${q1dirty.outbound_status}`);
    }

    const t1 = await processUpdateCycle(connection, httpAudit, 'TESTE1', new Set(['check_in', 'check_out']));
    report.patches.push({ teste: 'periodo', ...t1.patch });
    report.gets.push({ teste: 'periodo_pos_patch', placeId: t1.dto.placeId, checkin: t1.dto.checkin, checkout: t1.dto.checkout });

    log('TESTE1_restore_periodo_original');
    await alterarPeriodoReservaAdmin({
      idReservaHospedagem: TARGET_RESERVA_ID,
      idUsuario: idAdmin,
      checkin: origCheckin,
      checkout: origCheckout,
      motivo: 'HOMOLOG ETAPA5.3 RESTORE PERIODO',
    });

    const t1r = await processUpdateCycle(connection, httpAudit, 'TESTE1_RESTORE', new Set(['check_in', 'check_out']));
    report.patches.push({ teste: 'periodo_restore', ...t1r.patch });
    const dto1final = await getHospedinReservation();
    report.gets.push({ teste: 'periodo_restore_final', checkin: dto1final.checkin, checkout: dto1final.checkout });

    // ========== TESTE 2 — SUITE ==========
    const reservaPosPeriodo = await loadReservaFull(connection, TARGET_RESERVA_ID);
    const altSuite = await findAlternateMappedSuite(
      connection,
      ORIGINAL_SUITE_ID,
      reservaPosPeriodo.adultos ?? 2,
      reservaPosPeriodo.criancas ?? 0
    );
    log('TESTE2_suite_alternativa', altSuite);

    const reservaSuiteId = Number(baseline.reserva.reserva_suite_id);
    if (!reservaSuiteId) throw new Error('reserva_suite_id ausente.');

    await trocarSuiteReservaAdmin({
      idReservaHospedagem: TARGET_RESERVA_ID,
      idUsuario: idAdmin,
      idReservaSuite: reservaSuiteId,
      idEventoSuiteDestino: Number(altSuite.id_evento_suite),
      motivo: 'HOMOLOG ETAPA5.3 UPDATE SUITE',
    });

    const q2dirty = await loadOutboundRow(connection, TARGET_RESERVA_ID);
    if (q2dirty.pending_payload_hash === q2dirty.payload_hash) {
      throw new Error('TESTE2: hash nao divergiu apos trocar suite.');
    }
    if (q2dirty.outbound_status !== 'PENDING_UPDATE') {
      throw new Error(`TESTE2: outbound_status esperado PENDING_UPDATE, got ${q2dirty.outbound_status}`);
    }

    const t2 = await processUpdateCycle(
      connection,
      httpAudit,
      'TESTE2',
      new Set(['place_id', 'place_type_id'])
    );
    report.patches.push({ teste: 'suite', ...t2.patch });
    report.gets.push({
      teste: 'suite_pos_patch',
      placeId: t2.dto.placeId,
      placeTypeId: t2.dto.placeTypeId,
    });

    log('TESTE2_restore_suite_tulipa');
    const reservaAfterSwap = await loadReservaFull(connection, TARGET_RESERVA_ID);
    await trocarSuiteReservaAdmin({
      idReservaHospedagem: TARGET_RESERVA_ID,
      idUsuario: idAdmin,
      idReservaSuite: Number(reservaAfterSwap.reserva_suite_id),
      idEventoSuiteDestino: ORIGINAL_SUITE_ID,
      motivo: 'HOMOLOG ETAPA5.3 RESTORE SUITE TULIPA',
    });

    const t2r = await processUpdateCycle(
      connection,
      httpAudit,
      'TESTE2_RESTORE',
      new Set(['place_id', 'place_type_id'])
    );
    report.patches.push({ teste: 'suite_restore', ...t2r.patch });
    const dto2final = await getHospedinReservation();
    report.gets.push({
      teste: 'suite_restore_final',
      placeId: dto2final.placeId,
      placeTypeId: dto2final.placeTypeId,
    });

    const finalReserva = await loadReservaFull(connection, TARGET_RESERVA_ID);
    const finalQueue = await assertQueueSynced(connection);
    await assertFinancialUnchanged(baseline.reserva, finalReserva);

    await restoreReservaSuiteAdultos(
      connection,
      TARGET_RESERVA_ID,
      ORIGINAL_ADULTOS,
      ORIGINAL_CRIANCAS
    );
    occupancyRestoredInFinally = true;
    const finalAfterAdultos = await loadReservaFull(connection, TARGET_RESERVA_ID);
    const finalQueueAfterAdultos = await assertQueueSynced(connection);

    const postRes = httpAudit.calls.filter(
      (c) => c.method === 'POST' && String(c.path).includes('/reservations')
    );
    const postGuests = httpAudit.calls.filter(
      (c) => c.method === 'POST' && String(c.path).includes('/guests')
    );
    const financial = httpAudit.calls.filter((c) =>
      FORBIDDEN_HTTP_FRAGMENTS.some((f) => String(c.path).includes(f))
    );
    const patches = httpAudit.calls.filter((c) => c.method === 'PATCH');

    log('RELATORIO_FINAL', {
      baseline,
      finalReserva: finalAfterAdultos,
      finalQueue: finalQueueAfterAdultos,
      report,
      http: {
        patch_count: patches.length,
        post_reservation_count: postRes.length,
        post_guest_count: postGuests.length,
        financial_count: financial.length,
        all_calls: httpAudit.calls,
      },
    });

    if (postRes.length > 0) throw new Error('POST /reservations detectado.');
    if (postGuests.length > 0) throw new Error('POST /guests detectado.');
    if (financial.length > 0) throw new Error('HTTP financeiro detectado.');
    if (Number(finalAfterAdultos.id_evento_suite) !== ORIGINAL_SUITE_ID) {
      throw new Error('Suite final nao e Tulipa.');
    }
    if (String(finalAfterAdultos.id_externo) !== EXPECTED_HOSPEDIN_ID) {
      throw new Error('idExterno alterado.');
    }
    if (String(finalAfterAdultos.codigo_externo) !== EXPECTED_HOSPEDIN_CODE) {
      throw new Error('codigoExterno alterado.');
    }

    for (const id of ISOLATE_RESERVA_IDS) {
      const f = await loadOutboundRow(connection, id);
      const r = await loadReservaFull(connection, id);
      if (JSON.stringify(r) !== JSON.stringify(reservaSnapshots[id])) {
        throw new Error(`Reserva #${id} alterada indevidamente.`);
      }
      log(`ISOLATE_CHECK_${id}`, {
        outbound_status: f?.outbound_status,
        hospedin_reservation_id: f?.hospedin_reservation_id,
      });
    }

    console.log('=== ETAPA 5.3 HOMOLOG: SUCESSO ===');
  } finally {
    if (!occupancyRestoredInFinally) {
      try {
        await restoreReservaSuiteAdultos(
          connection,
          TARGET_RESERVA_ID,
          ORIGINAL_ADULTOS,
          ORIGINAL_CRIANCAS
        );
        log('FINALLY_restore_adultos', {
          adultos: ORIGINAL_ADULTOS,
          criancas: ORIGINAL_CRIANCAS,
        });
      } catch (restoreErr) {
        console.error(
          'FINALLY_restore_adultos_FAILED',
          restoreErr && restoreErr.stack ? restoreErr.stack : restoreErr
        );
      }
    }
    for (const id of ISOLATE_RESERVA_IDS) {
      await restoreOutboundSnapshot(connection, id, isolateSnapshots[id]);
    }
    httpAudit.restore();
    console.log('FINALLY: adultos/criancas + isolamento 124/126 restaurados.');
  }
}

main().catch((e) => {
  console.error('HOMOLOG_FATAL', e && e.stack ? e.stack : e);
  process.exit(1);
});
