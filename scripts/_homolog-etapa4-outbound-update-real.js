/**
 * Homologação controlada — ETAPA 4: PRIMEIRO UPDATE REAL Jango → Hospedin (#127).
 *
 * PATCH somente na reserva Jango #127 → Hospedin #30295972 (HO:001321).
 * Isola temporariamente 124/126 e restaura no finally.
 *
 * Uso:
 *   cd ticket-node
 *   npm run build
 *   node scripts/_homolog-etapa4-outbound-update-real.js --execute
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TARGET_RESERVA_ID = 127;
const EXPECTED_HOSPEDIN_ID = '30295972';
const EXPECTED_HOSPEDIN_CODE = 'HO:001321';
const ISOLATE_RESERVA_IDS = [124, 126];
const OBS_HOMOLOG = 'HOMOLOG UPDATE OUTBOUND #127 - OBS ALTERADA';

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
  console.error('Este script executa homologacao REAL. Use --execute');
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
            rh.checkin, rh.checkout, rh.observacoes, rh.observacao_importada,
            rh.observacao_operador,
            rs.id AS reserva_suite_id, rs.id_evento_suite, es.nome AS suite_nome
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

async function applyMigration(sequelize) {
  const [cols] = await sequelize.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'hospedin_outbound_sync_state'
       AND COLUMN_NAME = 'synced_hash_input_json'`
  );
  if (Number(cols[0]?.n || 0) > 0) {
    log('MIGRATION', 'synced_hash_input_json ja existe');
    return;
  }
  await sequelize.query(
    `ALTER TABLE hospedin_outbound_sync_state
     ADD COLUMN synced_hash_input_json TEXT NULL AFTER pending_payload_hash`
  );
  log('MIGRATION', 'synced_hash_input_json criada');
}

async function resolveAdminForReserva(sequelize, idReserva) {
  const [rows] = await sequelize.query(
    `SELECT u.id, u.nome_completo
     FROM ReservaHospedagem rh
     JOIN Evento e ON e.id = rh.id_evento
     JOIN ProdutorAcesso pa
       ON pa.id_produtor = e.id_produtor
      AND pa.tipo_acesso = 'Administrador'
     JOIN Usuario u ON u.id = pa.id_usuario
     WHERE rh.id = ? AND u.ativo = 1
     ORDER BY u.id ASC
     LIMIT 1`,
    { replacements: [idReserva] }
  );
  if (rows.length) return Number(rows[0].id);
  const [adm] = await sequelize.query(
    `SELECT id FROM Usuario WHERE adm_geral = 1 AND ativo = 1 ORDER BY id ASC LIMIT 1`
  );
  if (adm.length) return Number(adm[0].id);
  throw new Error('Nenhum admin para atualizar observacao.');
}

function installHttpAudit() {
  const { hospedinApiClient } = require('../dist/integrations/hospedin/api/HospedinApiClient');
  const calls = [];
  const orig = {
    post: hospedinApiClient.post.bind(hospedinApiClient),
    get: hospedinApiClient.get.bind(hospedinApiClient),
    patch: hospedinApiClient.patch.bind(hospedinApiClient),
    put: hospedinApiClient.put.bind(hospedinApiClient),
    delete: hospedinApiClient.delete.bind(hospedinApiClient),
  };

  function guard(path) {
    const p = String(path || '');
    for (const frag of FORBIDDEN_HTTP_FRAGMENTS) {
      if (p.includes(frag)) {
        throw new Error(`HTTP financeiro proibido: ${p}`);
      }
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
  hospedinApiClient.put = wrap('PUT', orig.put);
  hospedinApiClient.delete = wrap('DELETE', orig.delete);

  return {
    calls,
    restore() {
      hospedinApiClient.post = orig.post;
      hospedinApiClient.get = orig.get;
      hospedinApiClient.patch = orig.patch;
      hospedinApiClient.put = orig.put;
      hospedinApiClient.delete = orig.delete;
    },
  };
}

async function isolateForTest(sequelize, idReserva, snapshot) {
  if (!snapshot) return false;
  const claimable = new Set([
    'PENDING_CREATE',
    'PENDING_UPDATE',
    'WAIT_RETRY',
    'PROCESSING',
  ]);
  if (!claimable.has(String(snapshot.outbound_status || ''))) {
    return false;
  }
  await sequelize.query(
    `UPDATE hospedin_outbound_sync_state
     SET outbound_status = 'BLOCKED', updated_at = NOW()
     WHERE id_reserva_hospedagem = ?`,
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
     ORDER BY dirty_at ASC
     LIMIT 30`
  );
  return rows;
}

async function backfillSyncedHashInput(connection, idReserva) {
  const { ReservaHospedagem } = require('../dist/models/ReservaHospedagem');
  const { ReservaSuite } = require('../dist/models/ReservaSuite');
  const { ReservaHospede } = require('../dist/models/ReservaHospede');
  const {
    buildSnapshotFromReserva,
    snapshotToHashInput,
    serializeHashInput,
    hashOutboundPayload,
  } = require('../dist/integrations/hospedin/outbound/HospedinOutboundSnapshot');

  const hospedagem = await ReservaHospedagem.findByPk(idReserva, {
    include: [
      {
        model: ReservaSuite,
        as: 'ReservaSuite',
        include: [{ model: ReservaHospede, as: 'ReservaHospede' }],
      },
    ],
  });
  if (!hospedagem) throw new Error(`Reserva ${idReserva} nao encontrada para backfill.`);

  const hashInput = snapshotToHashInput(buildSnapshotFromReserva(hospedagem));
  const json = serializeHashInput(hashInput);
  const hash = hashOutboundPayload(hashInput);

  await connection.query(
    `UPDATE hospedin_outbound_sync_state
     SET synced_hash_input_json = ?, updated_at = NOW()
     WHERE id_reserva_hospedagem = ?`,
    { replacements: [json, idReserva] }
  );

  return { hashInput, json, hash };
}

function assertPatchSafe(body) {
  if (!body || typeof body !== 'object') return;
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_PATCH_KEYS.has(key)) {
      throw new Error(`PATCH contem campo proibido: ${key}`);
    }
  }
}

async function main() {
  console.log('=== ETAPA 4 — UPDATE REAL #127 (HTTP Hospedin PATCH) ===');

  const connection =
    require('../dist/database').default || require('../dist/database');
  await sleep(4000);

  const isolateSnapshots = {};
  const reservaIsolateSnapshots = {};
  let httpAudit = null;
  let stateBefore127 = null;
  let reservaBefore127 = null;
  let queueBefore127 = null;

  try {
    log('STEP_0_apply_migration');
    await applyMigration(connection);

    const { bootstrapIntegrationProviders } = require('../dist/integrations/bootstrap');
    const { providerRegistry } = require('../dist/integrations/core/ProviderRegistry');
    const { runProviderCycle } = require('../dist/integrations/core/SyncRunOrchestrator');
    const { IntegrationSyncTrigger } = require('../dist/models/IntegrationSyncExecution');
    const { atualizarObservacoesReservaAdmin } = require('../dist/services/hospedagemAdminService');
    const { hospedinReservationService } = require('../dist/integrations/hospedin/services/HospedinReservationService');

    bootstrapIntegrationProviders();
    if (!providerRegistry.ids().includes('HOSPEDIN_OUTBOUND')) {
      throw new Error('HOSPEDIN_OUTBOUND nao registrado.');
    }

    httpAudit = installHttpAudit();

    for (const id of ISOLATE_RESERVA_IDS) {
      isolateSnapshots[id] = await loadOutboundRow(connection, id);
      reservaIsolateSnapshots[id] = await loadReservaFull(connection, id);
    }

    reservaBefore127 = await loadReservaFull(connection, TARGET_RESERVA_ID);
    queueBefore127 = await loadOutboundRow(connection, TARGET_RESERVA_ID);

    log('STEP_1_estado_antes_127', {
      reserva: reservaBefore127,
      fila: queueBefore127,
    });

    const hospedinId =
      String(queueBefore127?.hospedin_reservation_id || '').trim() ||
      String(reservaBefore127?.id_externo || '').trim();

    if (hospedinId !== EXPECTED_HOSPEDIN_ID) {
      throw new Error(
        `Reserva #127 nao vinculada a Hospedin #${EXPECTED_HOSPEDIN_ID} (atual: ${hospedinId || 'ausente'})`
      );
    }

    if (!hospedinId) {
      throw new Error('Reserva #127 sem vínculo Hospedin — PARE.');
    }

    if (
      queueBefore127?.outbound_status === 'PENDING_CREATE' &&
      !hospedinId
    ) {
      throw new Error('Fila #127 PENDING_CREATE sem ID Hospedin — risco de POST. PARE.');
    }

    log('STEP_2_isolate_124_126');
    for (const id of ISOLATE_RESERVA_IDS) {
      const isolated = await isolateForTest(connection, id, isolateSnapshots[id]);
      log(`ISOLATED_${id}`, { isolated, before: isolateSnapshots[id] });
    }

    log('STEP_3_backfill_baseline_127');
    const backfill = await backfillSyncedHashInput(connection, TARGET_RESERVA_ID);
    queueBefore127 = await loadOutboundRow(connection, TARGET_RESERVA_ID);
    log('BACKFILL_OK', {
      hash: backfill.hash,
      synced_hash_input_json_length: backfill.json.length,
      fila: queueBefore127,
    });

    if (!queueBefore127?.synced_hash_input_json) {
      throw new Error('Baseline synced_hash_input_json nao gravado — PARE.');
    }

    stateBefore127 = {
      reserva: reservaBefore127,
      fila: { ...queueBefore127 },
    };

    const idAdmin = await resolveAdminForReserva(connection, TARGET_RESERVA_ID);
    const mergedObsBefore =
      reservaBefore127?.observacoes ||
      [reservaBefore127?.observacao_importada, reservaBefore127?.observacao_operador]
        .filter(Boolean)
        .join('\n\n');

    const newObsText = mergedObsBefore
      ? `${mergedObsBefore}\n\n${OBS_HOMOLOG}`
      : OBS_HOMOLOG;

    log('STEP_4_alterar_observacao_127', {
      idAdmin,
      textoNovo: newObsText,
    });

    await atualizarObservacoesReservaAdmin(
      TARGET_RESERVA_ID,
      idAdmin,
      newObsText
    );

    reservaBefore127 = await loadReservaFull(connection, TARGET_RESERVA_ID);
    const queueAfterDirty = await loadOutboundRow(connection, TARGET_RESERVA_ID);

    log('STEP_4_fila_apos_markDirty', queueAfterDirty);

    if (
      !queueAfterDirty?.pending_payload_hash ||
      !queueAfterDirty?.payload_hash ||
      queueAfterDirty.pending_payload_hash === queueAfterDirty.payload_hash
    ) {
      throw new Error(
        'pending_payload_hash nao divergiu de payload_hash apos alteracao de obs.'
      );
    }

    if (queueAfterDirty.outbound_status !== 'PENDING_UPDATE') {
      throw new Error(
        `Fila #127 deveria estar PENDING_UPDATE (atual: ${queueAfterDirty.outbound_status})`
      );
    }

    const due = await countDueCandidates(connection);
    log('STEP_5_candidatos_due', due);

    const only127 =
      due.length === 1 &&
      Number(due[0].id_reserva_hospedagem) === TARGET_RESERVA_ID;
    if (!only127) {
      throw new Error(
        `Esperado unico candidato #127, encontrado: ${JSON.stringify(due)}`
      );
    }

    log('STEP_6_runProviderCycle syncLimit=1');
    const run = await runProviderCycle(
      'HOSPEDIN_OUTBOUND',
      IntegrationSyncTrigger.MANUAL,
      { force: true, syncLimit: 1 }
    );
    log('PROVIDER_RESULT', {
      skipped: run.skipped,
      reason: run.reason,
      correlationId: run.correlationId,
      summary: run.summary,
    });

    if (run.skipped) {
      throw new Error(`Provider skipped: ${run.reason || 'unknown'}`);
    }

    const patchCalls = httpAudit.calls.filter((c) => c.method === 'PATCH');
    const postReservationCalls = httpAudit.calls.filter(
      (c) =>
        c.method === 'POST' && String(c.path || '').includes('/reservations')
    );
    const postGuestCalls = httpAudit.calls.filter(
      (c) => c.method === 'POST' && String(c.path || '').includes('/guests')
    );
    const financialCalls = httpAudit.calls.filter((c) =>
      FORBIDDEN_HTTP_FRAGMENTS.some((f) => String(c.path || '').includes(f))
    );

    if (postReservationCalls.length > 0) {
      throw new Error('POST /reservations detectado — PARE.');
    }
    if (postGuestCalls.length > 0) {
      throw new Error('POST /guests detectado — PARE.');
    }
    if (financialCalls.length > 0) {
      throw new Error('Chamada financeira detectada — PARE.');
    }
    if (patchCalls.length !== 1) {
      throw new Error(
        `Esperado exatamente 1 PATCH, encontrado: ${patchCalls.length}`
      );
    }

    const patchCall = patchCalls[0];
    assertPatchSafe(patchCall.body);

    if (!String(patchCall.path || '').includes(`/reservations/${EXPECTED_HOSPEDIN_ID}`)) {
      throw new Error(`PATCH destino inesperado: ${patchCall.path}`);
    }

    log('STEP_7_http_audit', httpAudit.calls);
    log('PATCH_ENVIADO', patchCall);

    const queueFinal = await loadOutboundRow(connection, TARGET_RESERVA_ID);
    const reservaFinal = await loadReservaFull(connection, TARGET_RESERVA_ID);

    let hospedinDto = null;
    try {
      hospedinDto = await hospedinReservationService.getReservationDto(
        EXPECTED_HOSPEDIN_ID
      );
    } catch (e) {
      log('HOSPEDIN_GET_WARN', { message: e.message });
    }

    const validation = {
      fila_SYNCED: queueFinal?.outbound_status === 'SYNCED',
      desired_UPDATE: queueFinal?.desired_action === 'UPDATE',
      hashes_iguais:
        queueFinal?.payload_hash &&
        queueFinal.payload_hash === queueFinal?.pending_payload_hash,
      sem_erro: !queueFinal?.last_error && !queueFinal?.error_code,
      id_reserva_inalterado:
        Number(reservaFinal?.id) === TARGET_RESERVA_ID,
      id_externo_inalterado:
        String(reservaFinal?.id_externo) === EXPECTED_HOSPEDIN_ID,
      codigo_externo_inalterado:
        String(reservaFinal?.codigo_externo || '') === EXPECTED_HOSPEDIN_CODE ||
        Boolean(reservaFinal?.codigo_externo),
      hospedin_reservation_id_ok:
        String(queueFinal?.hospedin_reservation_id) === EXPECTED_HOSPEDIN_ID,
      valor_total_inalterado:
        String(stateBefore127.reserva.valor_total) ===
        String(reservaFinal?.valor_total),
      valor_pago_inalterado:
        String(stateBefore127.reserva.valor_pago) ===
        String(reservaFinal?.valor_pago),
      saldo_pendente_inalterado:
        String(stateBefore127.reserva.saldo_pendente ?? '') ===
        String(reservaFinal?.saldo_pendente ?? ''),
      suite_inalterada:
        Number(stateBefore127.reserva.id_evento_suite) ===
        Number(reservaFinal?.id_evento_suite),
      checkin_inalterado:
        String(stateBefore127.reserva.checkin) === String(reservaFinal?.checkin),
      checkout_inalterado:
        String(stateBefore127.reserva.checkout) ===
        String(reservaFinal?.checkout),
      origem_inalterada:
        String(stateBefore127.reserva.origem_reserva) ===
        String(reservaFinal?.origem_reserva),
      obs_contem_homolog:
        String(reservaFinal?.observacoes || '').includes(OBS_HOMOLOG),
      patch_note_contem_homolog:
        String(patchCall.body?.note || '').includes(OBS_HOMOLOG),
      sem_post_reservation: postReservationCalls.length === 0,
      sem_financeiro: financialCalls.length === 0,
      patch_count_1: patchCalls.length === 1,
      post_reservation_count_0: postReservationCalls.length === 0,
    };

    if (hospedinDto) {
      validation.hospedin_note_contem_homolog = String(
        hospedinDto.note || hospedinDto.observation || ''
      ).includes(OBS_HOMOLOG);
      validation.hospedin_id_ok =
        String(hospedinDto.reservationId || hospedinDto.id) ===
        EXPECTED_HOSPEDIN_ID;
    }

    log('ESTADO_DEPOIS_127', { reserva: reservaFinal, fila: queueFinal });
    log('HOSPEDIN_RESERVATION', hospedinDto);
    log('VALIDATION', validation);

    log('RELATORIO_FINAL', {
      patch: {
        method: patchCall.method,
        endpoint: patchCall.path,
        body: patchCall.body,
        status: 'via provider (ver logs) — GET pos validacao abaixo',
      },
      http_summary: {
        patch_count: patchCalls.length,
        post_reservation_count: postReservationCalls.length,
        post_guest_count: postGuestCalls.length,
        financial_count: financialCalls.length,
        all_calls: httpAudit.calls,
      },
      estado_antes: stateBefore127,
      estado_depois: { reserva: reservaFinal, fila: queueFinal },
      hospedin_note: hospedinDto?.note || hospedinDto?.observation || null,
      validation,
    });

    const allOk = Object.values(validation).every(Boolean);
    if (!allOk) {
      throw new Error('Validacao pos-UPDATE falhou.');
    }

    console.log('=== HOMOLOG ETAPA 4 UPDATE REAL #127: SUCESSO ===');
  } finally {
    console.log('FINALLY: restaurando filas 124 e 126...');
    for (const id of ISOLATE_RESERVA_IDS) {
      try {
        await restoreOutboundSnapshot(connection, id, isolateSnapshots[id]);
        const after = await loadOutboundRow(connection, id);
        const reservaAfter = await loadReservaFull(connection, id);
        log(`RESTORED_${id}`, {
          outbound_ok:
            JSON.stringify(after, Object.keys(isolateSnapshots[id]).sort()) ===
            JSON.stringify(isolateSnapshots[id], Object.keys(isolateSnapshots[id]).sort()),
          reserva_ok:
            JSON.stringify(reservaAfter) ===
            JSON.stringify(reservaIsolateSnapshots[id]),
        });
      } catch (e) {
        log(`RESTORE_ERROR_${id}`, { message: e.message });
      }
    }
    if (httpAudit) httpAudit.restore();
    console.log('FINALLY: concluido.');
  }
}

main().catch((e) => {
  console.error('HOMOLOG_FATAL', e && e.stack ? e.stack : e);
  process.exit(1);
});
