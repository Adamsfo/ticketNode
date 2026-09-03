/**
 * Outcomes por ciclo PATCH:
 *   UPDATED        — PATCH real emitido
 *   ALREADY_SYNCED — zero PATCH porque Hospedin/fila ja estavam corretos
 *   FAILED         — erro real
 *
 *   node scripts/_homolog-etapa53-teste2-suite-real.js --preview
 *   node scripts/_homolog-etapa53-teste2-suite-real.js --execute
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
const ALT_SUITE_NAME_MATCH = 'PRATA';
const TULIPA_PLACE_ID = 445912;
const TULIPA_PLACE_TYPE_ID = 131941;

const FORBIDDEN_HTTP_FRAGMENTS = [
  '/reservation_transactions',
  '/sales',
  '/rate_reservations',
];
const SUITE_PATCH_ALLOWED = new Set(['place_id', 'place_type_id']);
const FORBIDDEN_PATCH_KEYS = new Set([
  'check_in',
  'check_out',
  'adults',
  'children',
  'note',
  'daily_cents',
  'total_daily_cents',
  'sale_channel_id',
  'guest_id',
  'has_payment_coming_from_ota',
  'status',
]);

if (!new Set(process.argv.slice(2)).has('--execute') && !new Set(process.argv.slice(2)).has('--preview')) {
  console.error('Use --preview (somente validacao) ou --execute (homologacao real).');
  process.exit(1);
}

const MODE_PREVIEW = new Set(process.argv.slice(2)).has('--preview');
const MODE_EXECUTE = new Set(process.argv.slice(2)).has('--execute');

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

async function loadSuiteMapping(sequelize, idEventoSuite) {
  const [rows] = await sequelize.query(
    `SELECT m.id_evento_suite, es.nome, es.qtde_minima_pessoas, es.qtde_maxima_pessoas,
            m.place_id, hp.place_type_id
     FROM hospedin_place_suite_map m
     JOIN EventoSuite es ON es.id = m.id_evento_suite
     LEFT JOIN hospedin_places hp ON hp.place_id = m.place_id
     WHERE m.ativo = 1 AND m.mapping_status = 'LINKED' AND m.id_evento_suite = ?`,
    { replacements: [idEventoSuite] }
  );
  return rows[0] || null;
}

async function loadPrataSuiteMapping(sequelize) {
  const [rows] = await sequelize.query(
    `SELECT m.id_evento_suite, es.nome, es.qtde_minima_pessoas, es.qtde_maxima_pessoas,
            m.place_id, hp.place_type_id, m.ativo, m.mapping_status
     FROM hospedin_place_suite_map m
     JOIN EventoSuite es ON es.id = m.id_evento_suite
     LEFT JOIN hospedin_places hp ON hp.place_id = m.place_id
     WHERE m.ativo = 1
       AND m.mapping_status = 'LINKED'
       AND UPPER(es.nome) LIKE ?
     ORDER BY m.id_evento_suite ASC
     LIMIT 5`,
    { replacements: [`%${ALT_SUITE_NAME_MATCH}%`] }
  );
  return rows[0] || null;
}

async function loadOcupantesSuite(sequelize, idEventoSuite, excludeReservaId) {
  const [rows] = await sequelize.query(
    `SELECT rh.id, rh.status, rh.checkin, rh.checkout,
            rh.data_hora_checkin_real, rh.data_hora_checkout_realizado, rh.saldo_pendente
     FROM ReservaSuite rs
     INNER JOIN ReservaHospedagem rh ON rh.id = rs.id_reserva_hospedagem
     WHERE rs.id_evento_suite = ?
       AND rs.status IN ('Confirmada', 'Hospedada', 'AguardandoPagamento')`,
    { replacements: [idEventoSuite] }
  );
  return rows
    .filter((r) => Number(r.id) !== Number(excludeReservaId))
    .map((r) => ({
      id: Number(r.id),
      status: String(r.status),
      checkin: r.checkin,
      checkout: r.checkout,
      dataHoraCheckinReal: r.data_hora_checkin_real,
      dataHoraCheckoutRealizado: r.data_hora_checkout_realizado,
      saldoPendente: r.saldo_pendente,
    }));
}

async function checkPrataAvailability(sequelize, prataRow, checkin, checkout, excludeReservaId) {
  const { calcularDisponibilidadePeriodo } = require('../dist/services/suiteDisponibilidadeService');
  const ocupantes = await loadOcupantesSuite(
    sequelize,
    Number(prataRow.id_evento_suite),
    excludeReservaId
  );
  const disp = calcularDisponibilidadePeriodo({
    idEventoSuite: Number(prataRow.id_evento_suite),
    checkin: new Date(checkin),
    checkout: new Date(checkout),
    reservas: ocupantes,
  });
  return { disp, ocupantesCount: ocupantes.length };
}

/**
 * Resolve e valida a suíte Prata. Sem fallback para outras suítes.
 * Retorna { prata, validation } ou lança se inválida/indisponível.
 */
async function resolveAndValidatePrataSuite(sequelize, baselineReserva) {
  const prata = await loadPrataSuiteMapping(sequelize);
  const validation = {
    found: Boolean(prata),
    idEventoSuite: prata ? Number(prata.id_evento_suite) : null,
    nome: prata?.nome ?? null,
    qtde_minima_pessoas: prata ? Number(prata.qtde_minima_pessoas) : null,
    qtde_maxima_pessoas: prata ? Number(prata.qtde_maxima_pessoas) : null,
    place_id: prata?.place_id ?? null,
    place_type_id: prata?.place_type_id ?? null,
    mapping_status: prata?.mapping_status ?? null,
    ativo: prata?.ativo ?? null,
    diferente_tulipa: prata ? Number(prata.id_evento_suite) !== ORIGINAL_SUITE_ID : false,
    linked: prata ? String(prata.mapping_status) === 'LINKED' : false,
    place_mapeado: Boolean(prata?.place_id && prata?.place_type_id),
    ocupacao_compativel: false,
    disponivel_periodo: false,
    disponibilidade_detalhe: null,
    adultos_teste: ORIGINAL_ADULTOS,
    criancas_teste: ORIGINAL_CRIANCAS,
    periodo: {
      checkin: baselineReserva.checkin,
      checkout: baselineReserva.checkout,
    },
  };

  if (!prata) {
    validation.erro = 'Suite Prata nao encontrada (LINKED + ativo).';
    return { prata: null, validation };
  }

  const total = ORIGINAL_ADULTOS + ORIGINAL_CRIANCAS;
  const min = Number(prata.qtde_minima_pessoas || 1);
  const max = Number(prata.qtde_maxima_pessoas || min);
  validation.ocupacao_compativel = total >= min && total <= max;

  if (!validation.diferente_tulipa) {
    validation.erro = 'Prata coincide com Tulipa (id=3).';
    return { prata, validation };
  }
  if (!validation.linked || !prata.ativo) {
    validation.erro = 'Prata nao esta LINKED/ativa.';
    return { prata, validation };
  }
  if (!validation.place_mapeado) {
    validation.erro = 'Prata sem place_id ou place_type_id.';
    return { prata, validation };
  }
  if (!validation.ocupacao_compativel) {
    validation.erro = `Prata nao aceita ocupacao ${total} (min=${min}, max=${max}).`;
    return { prata, validation };
  }

  const { disp, ocupantesCount } = await checkPrataAvailability(
    sequelize,
    prata,
    baselineReserva.checkin,
    baselineReserva.checkout,
    TARGET_RESERVA_ID
  );
  validation.disponibilidade_detalhe = {
    podeReservar: disp.podeReservar,
    conflitoPeriodo: disp.conflitoPeriodo,
    ocupantesConsiderados: ocupantesCount,
    disponibilidadeNoDiaCheckin: disp.disponibilidadeNoDiaCheckin,
  };
  validation.disponivel_periodo = Boolean(disp.podeReservar);
  if (!validation.disponivel_periodo) {
    validation.erro = 'Prata indisponivel no periodo da reserva #127.';
  }

  return { prata, validation };
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

function assertPatchSuiteOnly(body, label) {
  if (!body || typeof body !== 'object') {
    throw new Error(`${label}: PATCH body vazio.`);
  }
  const keys = Object.keys(body);
  for (const key of keys) {
    if (FORBIDDEN_PATCH_KEYS.has(key)) {
      throw new Error(`${label}: campo proibido no PATCH: ${key}`);
    }
    if (!SUITE_PATCH_ALLOWED.has(key)) {
      throw new Error(`${label}: campo inesperado no PATCH: ${key}`);
    }
  }
  if (!keys.includes('place_id') || !keys.includes('place_type_id')) {
    throw new Error(`${label}: PATCH deve conter place_id e place_type_id.`);
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

async function processSuitePatchCycle(sequelize, httpAudit, label, options = {}) {
  const { expectedPlace = null, allowAlreadySynced = false } = options;
  await assertOnly127Due(sequelize);
  const callsBefore = httpAudit.calls.length;
  const run = await runOutboundProvider();
  log(`${label}_PROVIDER`, run.summary);

  const newPatches = httpAudit.calls
    .slice(callsBefore)
    .filter((c) => c.method === 'PATCH');

  if (newPatches.length === 0 && allowAlreadySynced && expectedPlace) {
    const dto = await getHospedinReservation();
    const queue = await assertQueueSynced(sequelize);
    const placeMatches =
      Number(dto.placeId) === Number(expectedPlace.place_id) &&
      Number(dto.placeTypeId) === Number(expectedPlace.place_type_id);
    if (placeMatches) {
      log(`${label}_OUTCOME`, { outcome: OUTCOME.ALREADY_SYNCED, patch_count: 0 });
      return { outcome: OUTCOME.ALREADY_SYNCED, patch: null, dto, queue, run };
    }
    throw new Error(
      `${label}: esperado 1 PATCH ou ALREADY_SYNCED, got 0 PATCH com place divergente`
    );
  }

  if (newPatches.length !== 1) {
    throw new Error(`${label}: esperado 1 PATCH, got ${newPatches.length}`);
  }
  const patch = newPatches[0];
  if (!String(patch.path).includes(`/reservations/${EXPECTED_HOSPEDIN_ID}`)) {
    throw new Error(`${label}: destino PATCH invalido: ${patch.path}`);
  }
  assertPatchSuiteOnly(patch.body, label);
  const dto = await getHospedinReservation();
  const queue = await assertQueueSynced(sequelize);
  log(`${label}_OUTCOME`, { outcome: OUTCOME.UPDATED, patch_count: 1 });
  return { outcome: OUTCOME.UPDATED, patch, dto, queue, run };
}

async function restoreTulipaIfNeeded(connection, idAdmin, reservaSuiteId, reason) {
  const current = await loadReservaFull(connection, TARGET_RESERVA_ID);
  if (Number(current.id_evento_suite) === ORIGINAL_SUITE_ID) {
    log('FINALLY_tulipa_ja_ok', { idEventoSuite: ORIGINAL_SUITE_ID });
    return false;
  }
  log('FINALLY_restore_tulipa', { de: current.id_evento_suite, motivo: reason });
  const { trocarSuiteReservaAdmin } = require('../dist/services/hospedagemAdminService');
  const afterSwap = await loadReservaFull(connection, TARGET_RESERVA_ID);
  await trocarSuiteReservaAdmin({
    idReservaHospedagem: TARGET_RESERVA_ID,
    idUsuario: idAdmin,
    idReservaSuite: Number(afterSwap.reserva_suite_id || reservaSuiteId),
    idEventoSuiteDestino: ORIGINAL_SUITE_ID,
    motivo: `HOMOLOG ETAPA5.3 FINALLY RESTORE TULIPA — ${reason}`,
  });
  return true;
}

async function main() {
  console.log(
    MODE_PREVIEW
      ? '=== ETAPA 5.3 — TESTE 2 PREVIEW: SUITE PRATA (#127) ==='
      : '=== ETAPA 5.3 — TESTE 2 ONLY: TROCA DE SUITE PRATA (#127) ==='
  );

  const connection =
    require('../dist/database').default || require('../dist/database');
  await sleep(4000);

  const baselineReserva = await loadReservaFull(connection, TARGET_RESERVA_ID);
  if (!baselineReserva) {
    throw new Error('Reserva #127 nao encontrada.');
  }

  const { prata, validation } = await resolveAndValidatePrataSuite(
    connection,
    baselineReserva
  );
  log('PRATA_IDENTIFICACAO_DISPONIBILIDADE', validation);

  const prataOk =
    validation.found &&
    validation.diferente_tulipa &&
    validation.linked &&
    validation.place_mapeado &&
    validation.ocupacao_compativel &&
    validation.disponivel_periodo;

  if (!prataOk) {
    console.error('PARE: Prata nao apta para TESTE 2.', validation.erro || 'validacao falhou');
    process.exit(1);
  }

  log('PRATA_APTA', {
    idEventoSuite: validation.idEventoSuite,
    nome: validation.nome,
    place_id: validation.place_id,
    place_type_id: validation.place_type_id,
    patch_esperado_troca: {
      place_id: Number(validation.place_id),
      place_type_id: Number(validation.place_type_id),
    },
    patch_esperado_restore_tulipa: {
      place_id: TULIPA_PLACE_ID,
      place_type_id: TULIPA_PLACE_TYPE_ID,
    },
  });

  if (MODE_PREVIEW) {
    console.log('=== PREVIEW OK — aguardando --execute ===');
    return;
  }

  const { trocarSuiteReservaAdmin } = require('../dist/services/hospedagemAdminService');
  const { bootstrapIntegrationProviders } = require('../dist/integrations/bootstrap');
  bootstrapIntegrationProviders();

  const httpAudit = installHttpAudit();
  const isolateSnapshots = {};
  const reservaSnapshots = {};
  const report = { patches: [], gets: [] };

  let idAdmin = null;
  let reservaSuiteId = null;
  let tulipaRestoredInTry = false;
  const altSuite = prata;

  try {
    for (const id of ISOLATE_RESERVA_IDS) {
      isolateSnapshots[id] = await loadOutboundRow(connection, id);
      reservaSnapshots[id] = await loadReservaFull(connection, id);
      await isolateForTest(connection, id, isolateSnapshots[id]);
    }

    const tulipaMap = await loadSuiteMapping(connection, ORIGINAL_SUITE_ID);
    const baselineFila = await loadOutboundRow(connection, TARGET_RESERVA_ID);
    const baselineReservaExec = await loadReservaFull(connection, TARGET_RESERVA_ID);

    const baseline = {
      reserva: baselineReservaExec,
      fila: baselineFila,
      tulipa: {
        idEventoSuite: ORIGINAL_SUITE_ID,
        nome: ORIGINAL_SUITE_NAME,
        place_id: tulipaMap?.place_id ?? TULIPA_PLACE_ID,
        place_type_id: tulipaMap?.place_type_id ?? TULIPA_PLACE_TYPE_ID,
        adultos: Number(baselineReservaExec.adultos),
        criancas: Number(baselineReservaExec.criancas),
      },
      prata: validation,
    };

    log('BASELINE_TESTE2', baseline);

    if (Number(baseline.reserva.adultos) !== ORIGINAL_ADULTOS) {
      throw new Error(`adultos esperado ${ORIGINAL_ADULTOS}, got ${baseline.reserva.adultos}`);
    }
    if (Number(baseline.reserva.criancas) !== ORIGINAL_CRIANCAS) {
      throw new Error(`criancas esperado ${ORIGINAL_CRIANCAS}`);
    }
    if (Number(baseline.reserva.id_evento_suite) !== ORIGINAL_SUITE_ID) {
      throw new Error('Suite inicial nao e Tulipa.');
    }
    if (String(baseline.reserva.id_externo) !== EXPECTED_HOSPEDIN_ID) {
      throw new Error('idExterno divergente.');
    }
    if (baseline.fila.outbound_status !== 'SYNCED') {
      throw new Error(`Fila inicial nao SYNCED: ${baseline.fila.outbound_status}`);
    }

    log('SUITE_ALTERNATIVA_PRATA', altSuite);

    idAdmin = await resolveAdminForReserva(connection, TARGET_RESERVA_ID);
    reservaSuiteId = Number(baseline.reserva.reserva_suite_id);

    await trocarSuiteReservaAdmin({
      idReservaHospedagem: TARGET_RESERVA_ID,
      idUsuario: idAdmin,
      idReservaSuite: reservaSuiteId,
      idEventoSuiteDestino: Number(altSuite.id_evento_suite),
      motivo: 'HOMOLOG ETAPA5.3 TESTE2 UPDATE SUITE PRATA',
    });

    const qDirty = await loadOutboundRow(connection, TARGET_RESERVA_ID);
    log('FILA_APOS_TROCA', qDirty);
    if (qDirty.pending_payload_hash === qDirty.payload_hash) {
      throw new Error('pending_payload_hash nao divergiu.');
    }
    if (String(qDirty.desired_action).toUpperCase() !== 'UPDATE') {
      throw new Error('desired_action != UPDATE');
    }
    if (qDirty.outbound_status !== 'PENDING_UPDATE') {
      throw new Error(`outbound_status != PENDING_UPDATE (${qDirty.outbound_status})`);
    }

    const t2 = await processSuitePatchCycle(connection, httpAudit, 'TESTE2');
    report.patches.push({
      fase: 'troca_suite',
      outcome: t2.outcome,
      ...(t2.patch || {}),
    });
    report.gets.push({
      fase: 'pos_troca',
      reservationId: t2.dto.reservationId,
      searchableCode: t2.dto.searchableCode,
      placeId: t2.dto.placeId,
      placeTypeId: t2.dto.placeTypeId,
    });

    if (String(t2.dto.reservationId) !== EXPECTED_HOSPEDIN_ID) {
      throw new Error('reservation_id alterado no Hospedin.');
    }
    if (String(t2.dto.searchableCode) !== EXPECTED_HOSPEDIN_CODE) {
      throw new Error('codigo Hospedin alterado.');
    }
    if (Number(t2.dto.placeId) !== Number(altSuite.place_id)) {
      throw new Error('place_id Hospedin nao bate com suite alternativa.');
    }

    log('TESTE2_restore_tulipa');
    const reservaAfterSwap = await loadReservaFull(connection, TARGET_RESERVA_ID);
    await trocarSuiteReservaAdmin({
      idReservaHospedagem: TARGET_RESERVA_ID,
      idUsuario: idAdmin,
      idReservaSuite: Number(reservaAfterSwap.reserva_suite_id),
      idEventoSuiteDestino: ORIGINAL_SUITE_ID,
      motivo: 'HOMOLOG ETAPA5.3 TESTE2 RESTORE TULIPA',
    });
    tulipaRestoredInTry = true;

    const t2r = await processSuitePatchCycle(connection, httpAudit, 'TESTE2_RESTORE', {
      allowAlreadySynced: true,
      expectedPlace: {
        place_id: tulipaMap?.place_id ?? TULIPA_PLACE_ID,
        place_type_id: tulipaMap?.place_type_id ?? TULIPA_PLACE_TYPE_ID,
      },
    });
    report.patches.push({
      fase: 'restore_tulipa',
      outcome: t2r.outcome,
      ...(t2r.patch || {}),
    });
    const dtoFinal = await getHospedinReservation();
    report.gets.push({
      fase: 'final',
      reservationId: dtoFinal.reservationId,
      searchableCode: dtoFinal.searchableCode,
      placeId: dtoFinal.placeId,
      placeTypeId: dtoFinal.placeTypeId,
      checkin: dtoFinal.checkin,
      checkout: dtoFinal.checkout,
    });

    const finalReserva = await loadReservaFull(connection, TARGET_RESERVA_ID);
    const finalQueue = await assertQueueSynced(connection);

    const postRes = httpAudit.calls.filter(
      (c) => c.method === 'POST' && String(c.path || '').includes('/reservations')
    );
    const postGuests = httpAudit.calls.filter(
      (c) => c.method === 'POST' && String(c.path || '').includes('/guests')
    );
    const postResNoAuth = postRes.filter(
      (c) => !String(c.path || '').includes('/authentication/sessions')
    );
    const postGuestsNoAuth = postGuests.filter(
      (c) => !String(c.path || '').includes('/authentication/sessions')
    );
    const financial = httpAudit.calls.filter((c) =>
      FORBIDDEN_HTTP_FRAGMENTS.some((f) => String(c.path || '').includes(f))
    );
    const patches = httpAudit.calls.filter((c) => c.method === 'PATCH');

    const patchOutcomes = report.patches.map((p) => p.outcome);
    const updatedCount = patchOutcomes.filter((o) => o === OUTCOME.UPDATED).length;
    const alreadySyncedCount = patchOutcomes.filter((o) => o === OUTCOME.ALREADY_SYNCED).length;

    log('RELATORIO_TESTE2', {
      outcome_summary: {
        troca_suite: report.patches.find((p) => p.fase === 'troca_suite')?.outcome,
        restore_tulipa: report.patches.find((p) => p.fase === 'restore_tulipa')?.outcome,
        updated_count: updatedCount,
        already_synced_count: alreadySyncedCount,
      },
      baseline,
      altSuite,
      report,
      finalReserva,
      finalQueue,
      http: {
        patch_count: patches.length,
        post_reservation_count: postResNoAuth.length,
        post_guest_count: postGuestsNoAuth.length,
        financial_count: financial.length,
        all_calls: httpAudit.calls,
      },
    });

    if (postResNoAuth.length > 0) throw new Error('POST /reservations detectado.');
    if (postGuestsNoAuth.length > 0) throw new Error('POST /guests detectado.');
    if (financial.length > 0) throw new Error('HTTP financeiro detectado.');
    if (updatedCount + alreadySyncedCount !== 2) {
      throw new Error(`Esperado 2 ciclos PATCH (troca+restore), got ${patchOutcomes.length}`);
    }
    if (updatedCount < 1) {
      throw new Error('Troca para Prata deve produzir pelo menos 1 PATCH UPDATED.');
    }

    if (Number(finalReserva.id_evento_suite) !== ORIGINAL_SUITE_ID) {
      throw new Error('Suite final Jango nao e Tulipa.');
    }
    if (Number(finalReserva.adultos) !== ORIGINAL_ADULTOS) {
      throw new Error('adultos alterados.');
    }
    if (Number(finalReserva.criancas) !== ORIGINAL_CRIANCAS) {
      throw new Error('criancas alteradas.');
    }
    if (String(finalReserva.valor_total) !== String(baseline.reserva.valor_total)) {
      throw new Error('valor_total alterado.');
    }
    if (Number(dtoFinal.placeId) !== Number(tulipaMap.place_id)) {
      throw new Error('Hospedin final nao voltou place_id Tulipa.');
    }
    if (
      new Date(finalReserva.checkin).getTime() !==
      new Date(baseline.reserva.checkin).getTime()
    ) {
      throw new Error('checkin alterado.');
    }
    if (
      new Date(finalReserva.checkout).getTime() !==
      new Date(baseline.reserva.checkout).getTime()
    ) {
      throw new Error('checkout alterado.');
    }
    if (
      !String(finalReserva.observacoes || '').includes(
        'HOMOLOG UPDATE OUTBOUND #127 - OBS ALTERADA'
      )
    ) {
      throw new Error('observacao homolog perdida.');
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

    console.log('=== ETAPA 5.3 TESTE 2: SUCESSO ===');
  } finally {
    try {
      if (idAdmin && reservaSuiteId && !tulipaRestoredInTry) {
        const needsSync = await restoreTulipaIfNeeded(
          connection,
          idAdmin,
          reservaSuiteId,
          'finally'
        );
        if (needsSync) {
          await assertOnly127Due(connection).catch(() => null);
          await runOutboundProvider().catch((e) =>
            log('FINALLY_provider_error', String(e))
          );
        }
      }
    } catch (finallyErr) {
      console.error('FINALLY_tulipa_error', finallyErr);
    }
    for (const id of ISOLATE_RESERVA_IDS) {
      await restoreOutboundSnapshot(connection, id, isolateSnapshots[id]);
    }
    httpAudit.restore();
    console.log('FINALLY: isolamento 124/126 restaurado.');
  }
}

main().catch((e) => {
  console.error('HOMOLOG_FATAL', e && e.stack ? e.stack : e);
  log('RELATORIO_TESTE2', { outcome: OUTCOME.FAILED, error: String(e && e.message ? e.message : e) });
  process.exit(1);
});
