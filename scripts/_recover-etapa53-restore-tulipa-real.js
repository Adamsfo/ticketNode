/**
 * ETAPA 5.3 — Recuperação: Prata → Tulipa (#127 → Hospedin #30295972).
 *
 * Outcomes:
 *   UPDATED        — PATCH real emitido
 *   ALREADY_SYNCED — Jango + Hospedin + fila já alinhados; zero PATCH
 *   FAILED         — erro real
 *
 *   npm run build
 *   node scripts/_recover-etapa53-restore-tulipa-real.js --preview
 *   node scripts/_recover-etapa53-restore-tulipa-real.js --execute
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TARGET_RESERVA_ID = 127;
const EXPECTED_HOSPEDIN_ID = '30295972';
const EXPECTED_HOSPEDIN_CODE = 'HO:001321';
const TULIPA_SUITE_ID = 3;
const TULIPA_PLACE_ID = 445912;
const TULIPA_PLACE_TYPE_ID = 131941;
const PRATA_SUITE_ID = 18;
const ORIGINAL_ADULTOS = 2;
const ORIGINAL_CRIANCAS = 0;
const ISOLATE_RESERVA_IDS = [124, 126];

const FORBIDDEN_HTTP_FRAGMENTS = [
  '/reservation_transactions',
  '/sales',
  '/rate_reservations',
];
const PATCH_ALLOWED = new Set(['place_id', 'place_type_id']);
const PATCH_FORBIDDEN = new Set([
  'check_in',
  'check_out',
  'adults',
  'children',
  'note',
  'guest_id',
  'daily_cents',
  'total_daily_cents',
  'sale_channel_id',
  'status',
]);

const MODE_PREVIEW = new Set(process.argv.slice(2)).has('--preview');
const MODE_EXECUTE = new Set(process.argv.slice(2)).has('--execute');

if (!MODE_PREVIEW && !MODE_EXECUTE) {
  console.error('Use --preview (somente validacao offline) ou --execute (recuperacao real).');
  process.exit(1);
}

const OUTCOME = {
  UPDATED: 'UPDATED',
  ALREADY_SYNCED: 'ALREADY_SYNCED',
  FAILED: 'FAILED',
};

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
  await sequelize.query(
    `UPDATE hospedin_outbound_sync_state SET ${sets} WHERE id_reserva_hospedagem = ?`,
    { replacements: [...keys.map((k) => snap[k]), idReserva] }
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
    restore() {
      hospedinApiClient.post = orig.post;
      hospedinApiClient.get = orig.get;
      hospedinApiClient.patch = orig.patch;
    },
  };
}

function assertPatchTulipaOnly(body) {
  if (!body || typeof body !== 'object') throw new Error('PATCH body vazio');
  for (const key of Object.keys(body)) {
    if (PATCH_FORBIDDEN.has(key)) throw new Error(`PATCH campo proibido: ${key}`);
    if (!PATCH_ALLOWED.has(key)) throw new Error(`PATCH campo inesperado: ${key}`);
  }
  if (
    Number(body.place_id) !== TULIPA_PLACE_ID ||
    Number(body.place_type_id) !== TULIPA_PLACE_TYPE_ID
  ) {
    throw new Error('PATCH nao e Tulipa esperada.');
  }
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

function assertQueueSyncedState(fila, label = 'fila') {
  if (!fila) throw new Error(`${label}: registro outbound ausente`);
  if (fila.outbound_status !== 'SYNCED') {
    throw new Error(`${label}: outbound_status esperado SYNCED, got ${fila.outbound_status}`);
  }
  if (fila.payload_hash !== fila.pending_payload_hash) {
    throw new Error(`${label}: payload_hash != pending_payload_hash`);
  }
  if (fila.last_error || fila.error_code) {
    throw new Error(`${label}: erro persistido (${fila.error_code} ${fila.last_error})`);
  }
}

function assertJangoTulipaState(reserva, baseline) {
  if (Number(reserva.id_evento_suite) !== TULIPA_SUITE_ID) {
    throw new Error('suite Jango nao e Tulipa');
  }
  if (reserva.suite_nome !== 'Tulipa') throw new Error('nome suite');
  if (Number(reserva.adultos) !== ORIGINAL_ADULTOS) throw new Error('adultos final');
  if (Number(reserva.criancas) !== ORIGINAL_CRIANCAS) throw new Error('criancas final');
  if (String(reserva.valor_total) !== String(baseline.valor_total)) {
    throw new Error('valor_total');
  }
  if (
    !String(reserva.observacoes || '').includes('HOMOLOG UPDATE OUTBOUND #127 - OBS ALTERADA')
  ) {
    throw new Error('observacao');
  }
  if (
    new Date(reserva.checkin).getTime() !== new Date(baseline.checkin).getTime() ||
    new Date(reserva.checkout).getTime() !== new Date(baseline.checkout).getTime()
  ) {
    throw new Error('datas alteradas');
  }
}

function assertHospedinTulipaState(dto) {
  if (String(dto.reservationId) !== EXPECTED_HOSPEDIN_ID) throw new Error('reservation_id');
  if (String(dto.searchableCode) !== EXPECTED_HOSPEDIN_CODE) throw new Error('codigo');
  if (Number(dto.placeId) !== TULIPA_PLACE_ID) throw new Error('place_id Hospedin');
  if (Number(dto.placeTypeId) !== TULIPA_PLACE_TYPE_ID) throw new Error('place_type_id');
}

function isJangoTulipaBaseline(reserva) {
  return (
    Number(reserva.id_evento_suite) === TULIPA_SUITE_ID &&
    Number(reserva.adultos) === ORIGINAL_ADULTOS &&
    Number(reserva.criancas) === ORIGINAL_CRIANCAS
  );
}

function isQueueSyncedSnapshot(fila) {
  if (!fila) return false;
  return (
    fila.outbound_status === 'SYNCED' &&
    fila.payload_hash === fila.pending_payload_hash &&
    !fila.last_error &&
    !fila.error_code
  );
}

function isHospedinTulipaDto(dto) {
  if (!dto) return false;
  return (
    String(dto.reservationId) === EXPECTED_HOSPEDIN_ID &&
    String(dto.searchableCode) === EXPECTED_HOSPEDIN_CODE &&
    Number(dto.placeId) === TULIPA_PLACE_ID &&
    Number(dto.placeTypeId) === TULIPA_PLACE_TYPE_ID
  );
}

async function detectAlreadySynced(connection, reserva, { verifyHospedin = false } = {}) {
  if (!isJangoTulipaBaseline(reserva)) return null;
  const fila = await loadOutboundRow(connection, TARGET_RESERVA_ID);
  if (!isQueueSyncedSnapshot(fila)) return null;

  if (!verifyHospedin) {
    return { fila, dto: null, hospedinVerified: false };
  }

  const dto = await getHospedinReservation();
  if (!isHospedinTulipaDto(dto)) return null;
  return { fila, dto, hospedinVerified: true };
}

function printFinalReport(outcome, payload) {
  log('RELATORIO_FINAL', { outcome, ...payload });
  if (outcome === OUTCOME.ALREADY_SYNCED) {
    console.log('=== RECUPERACAO ETAPA 5.3: ALREADY_SYNCED (sem PATCH) ===');
  } else if (outcome === OUTCOME.UPDATED) {
    console.log('=== RECUPERACAO ETAPA 5.3: UPDATED (PATCH real) ===');
  }
}

async function assertIsolationIntact(connection, reservaSnapshots) {
  for (const id of ISOLATE_RESERVA_IDS) {
    const r = await loadReservaFull(connection, id);
    if (JSON.stringify(r) !== JSON.stringify(reservaSnapshots[id])) {
      throw new Error(`Reserva #${id} alterada`);
    }
    const f = await loadOutboundRow(connection, id);
    log(`ISOLATE_${id}`, {
      outbound_status: f?.outbound_status,
      hospedin_reservation_id: f?.hospedin_reservation_id,
    });
  }
}

async function main() {
  console.log(
    MODE_PREVIEW
      ? '=== ETAPA 5.3 RECUPERACAO PREVIEW: PRATA → TULIPA (#127) ==='
      : '=== ETAPA 5.3 RECUPERACAO: PRATA → TULIPA (#127) ==='
  );

  const connection =
    require('../dist/database').default || require('../dist/database');
  await sleep(4000);

  const baseline = await loadReservaFull(connection, TARGET_RESERVA_ID);
  log('BASELINE_ANTES', baseline);

  if (Number(baseline.adultos) !== ORIGINAL_ADULTOS) {
    throw new Error(`adultos deve ser ${ORIGINAL_ADULTOS}`);
  }
  if (Number(baseline.criancas) !== ORIGINAL_CRIANCAS) {
    throw new Error(`criancas deve ser ${ORIGINAL_CRIANCAS}`);
  }

  if (MODE_PREVIEW) {
    const filaPreview = await loadOutboundRow(connection, TARGET_RESERVA_ID);
    const dbAlreadySynced =
      isJangoTulipaBaseline(baseline) && isQueueSyncedSnapshot(filaPreview);
    const previewReport = {
      outcome: dbAlreadySynced ? OUTCOME.ALREADY_SYNCED : OUTCOME.UPDATED,
      mode: 'preview',
      hospedinVerified: false,
      baseline,
      fila: filaPreview,
      note: dbAlreadySynced
        ? 'Jango Tulipa + fila SYNCED. Em --execute, GET Hospedin confirmara ALREADY_SYNCED sem PATCH.'
        : 'Seria necessario troca admin e/ou PATCH outbound.',
    };
    printFinalReport(previewReport.outcome, previewReport);
    return;
  }

  const { trocarSuiteReservaAdmin } = require('../dist/services/hospedagemAdminService');
  const { bootstrapIntegrationProviders } = require('../dist/integrations/bootstrap');
  bootstrapIntegrationProviders();

  const httpAudit = installHttpAudit();
  const isolateSnapshots = {};
  const reservaSnapshots = {};

  let idAdmin = null;
  let tulipaRestored = false;
  let outcome = OUTCOME.FAILED;

  try {
    for (const id of ISOLATE_RESERVA_IDS) {
      isolateSnapshots[id] = await loadOutboundRow(connection, id);
      reservaSnapshots[id] = await loadReservaFull(connection, id);
      await isolateForTest(connection, id, isolateSnapshots[id]);
    }

    if (
      Number(baseline.id_evento_suite) !== PRATA_SUITE_ID &&
      Number(baseline.id_evento_suite) !== TULIPA_SUITE_ID
    ) {
      throw new Error(
        `Estado inesperado: suite id=${baseline.id_evento_suite} (esperado Prata=18 ou Tulipa=3).`
      );
    }

    const alreadySynced = await detectAlreadySynced(connection, baseline, {
      verifyHospedin: true,
    });
    if (alreadySynced) {
      outcome = OUTCOME.ALREADY_SYNCED;
      console.log('Jango + Hospedin + fila ja alinhados em Tulipa — sem PATCH necessario.');

      const finalReserva = await loadReservaFull(connection, TARGET_RESERVA_ID);
      assertJangoTulipaState(finalReserva, baseline);
      assertQueueSyncedState(alreadySynced.fila);
      assertHospedinTulipaState(alreadySynced.dto);
      await assertIsolationIntact(connection, reservaSnapshots);

      printFinalReport(outcome, {
        baseline,
        finalReserva,
        fila: alreadySynced.fila,
        hospedin: {
          reservationId: alreadySynced.dto.reservationId,
          searchableCode: alreadySynced.dto.searchableCode,
          placeId: alreadySynced.dto.placeId,
          placeTypeId: alreadySynced.dto.placeTypeId,
          checkin: alreadySynced.dto.checkin,
          checkout: alreadySynced.dto.checkout,
        },
        http: {
          patches: [],
          patch_count: 0,
          post_reservation: 0,
          post_guests: 0,
          financial: 0,
        },
        hospedinVerified: true,
      });
      return;
    }

    idAdmin = await resolveAdminForReserva(connection, TARGET_RESERVA_ID);

    if (Number(baseline.id_evento_suite) === PRATA_SUITE_ID) {
      await trocarSuiteReservaAdmin({
        idReservaHospedagem: TARGET_RESERVA_ID,
        idUsuario: idAdmin,
        idReservaSuite: Number(baseline.reserva_suite_id),
        idEventoSuiteDestino: TULIPA_SUITE_ID,
        motivo: 'HOMOLOG ETAPA5.3 RECUPERACAO PRATA → TULIPA',
      });
      tulipaRestored = true;

      const afterSwap = await loadReservaFull(connection, TARGET_RESERVA_ID);
      log('APOS_TROCA_ADMIN', afterSwap);
      if (Number(afterSwap.adultos) !== ORIGINAL_ADULTOS) {
        throw new Error('adultos alterados apos trocarSuiteReservaAdmin');
      }
      if (Number(afterSwap.criancas) !== ORIGINAL_CRIANCAS) {
        throw new Error('criancas alteradas apos trocarSuiteReservaAdmin');
      }
      if (Number(afterSwap.id_evento_suite) !== TULIPA_SUITE_ID) {
        throw new Error('Jango nao voltou para Tulipa apos troca admin');
      }

      const qDirty = await loadOutboundRow(connection, TARGET_RESERVA_ID);
      log('FILA_APOS_TROCA', qDirty);
      if (qDirty.pending_payload_hash === qDirty.payload_hash) {
        throw new Error('pending_payload_hash nao divergiu');
      }
      if (qDirty.outbound_status !== 'PENDING_UPDATE') {
        throw new Error(`outbound_status esperado PENDING_UPDATE, got ${qDirty.outbound_status}`);
      }
    } else if (Number(baseline.id_evento_suite) === TULIPA_SUITE_ID) {
      console.log('Jango em Tulipa, mas Hospedin/fila divergentes — sincronizando outbound...');
    }

    const callsBefore = httpAudit.calls.length;
    const run = await runOutboundProvider();
    log('PROVIDER_RESULT', run.summary);

    const patches = httpAudit.calls
      .slice(callsBefore)
      .filter((c) => c.method === 'PATCH');

    if (patches.length === 0) {
      const dtoCheck = await getHospedinReservation();
      const filaCheck = await loadOutboundRow(connection, TARGET_RESERVA_ID);
      if (isHospedinTulipaDto(dtoCheck) && isQueueSyncedSnapshot(filaCheck)) {
        outcome = OUTCOME.ALREADY_SYNCED;
        log('PATCH_SKIPPED_ALREADY_SYNCED', {
          reason: 'provider candidates=0 com Hospedin Tulipa e fila SYNCED',
        });
      } else {
        throw new Error(
          `Esperado 1 PATCH ou ALREADY_SYNCED, got 0 PATCH com estado divergente`
        );
      }
    } else if (patches.length !== 1) {
      throw new Error(`Esperado 1 PATCH, got ${patches.length}`);
    } else {
      outcome = OUTCOME.UPDATED;
      const patch = patches[0];
      if (!String(patch.path).includes(`/reservations/${EXPECTED_HOSPEDIN_ID}`)) {
        throw new Error(`PATCH destino invalido: ${patch.path}`);
      }
      assertPatchTulipaOnly(patch.body);
      log('PATCH_TULIPA', patch);
    }

    const dto = await getHospedinReservation();
    log('GET_HOSPEDIN', {
      reservationId: dto.reservationId,
      searchableCode: dto.searchableCode,
      placeId: dto.placeId,
      placeTypeId: dto.placeTypeId,
      checkin: dto.checkin,
      checkout: dto.checkout,
    });

    const fila = await loadOutboundRow(connection, TARGET_RESERVA_ID);
    const finalReserva = await loadReservaFull(connection, TARGET_RESERVA_ID);

    const postRes = httpAudit.calls.filter(
      (c) =>
        c.method === 'POST' &&
        String(c.path || '').includes('/reservations') &&
        !String(c.path || '').includes('/authentication/')
    );
    const postGuests = httpAudit.calls.filter(
      (c) =>
        c.method === 'POST' &&
        String(c.path || '').includes('/guests') &&
        !String(c.path || '').includes('/authentication/')
    );
    const financial = httpAudit.calls.filter((c) =>
      FORBIDDEN_HTTP_FRAGMENTS.some((f) => String(c.path || '').includes(f))
    );

    printFinalReport(outcome, {
      baseline,
      finalReserva,
      fila,
      http: {
        patches: httpAudit.calls.filter((c) => c.method === 'PATCH'),
        patch_count: patches.length,
        gets: httpAudit.calls.filter((c) => c.method === 'GET'),
        post_reservation: postRes.length,
        post_guests: postGuests.length,
        financial: financial.length,
      },
    });

    if (postRes.length > 0) throw new Error('POST /reservations');
    if (postGuests.length > 0) throw new Error('POST /guests');
    if (financial.length > 0) throw new Error('HTTP financeiro');

    assertHospedinTulipaState(dto);
    assertQueueSyncedState(fila);
    assertJangoTulipaState(finalReserva, baseline);
    await assertIsolationIntact(connection, reservaSnapshots);
  } finally {
    try {
      if (idAdmin && !tulipaRestored) {
        const cur = await loadReservaFull(connection, TARGET_RESERVA_ID);
        if (Number(cur.id_evento_suite) !== TULIPA_SUITE_ID) {
          await trocarSuiteReservaAdmin({
            idReservaHospedagem: TARGET_RESERVA_ID,
            idUsuario: idAdmin,
            idReservaSuite: Number(cur.reserva_suite_id),
            idEventoSuiteDestino: TULIPA_SUITE_ID,
            motivo: 'FINALLY RECUPERACAO TULIPA',
          });
          await runOutboundProvider().catch((e) => log('FINALLY_provider_err', String(e)));
        }
      }
    } catch (e) {
      console.error('FINALLY_ERROR', e);
    }
    for (const id of ISOLATE_RESERVA_IDS) {
      await restoreOutboundSnapshot(connection, id, isolateSnapshots[id]);
    }
    httpAudit.restore();
    console.log('FINALLY: isolamento 124/126 restaurado.');
  }
}

main().catch((e) => {
  console.error('RECOVER_FATAL', e && e.stack ? e.stack : e);
  log('RELATORIO_FINAL', { outcome: OUTCOME.FAILED, error: String(e && e.message ? e.message : e) });
  process.exit(1);
});
