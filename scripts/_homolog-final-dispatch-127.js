/**
 * TESTE FINAL REAL — HOSPEDIN_OUTBOUND dispatch imediato (#127 UPDATE obs).
 * Habilita provider (autorizado), altera obs, aguarda dispatcher, valida Hospedin, restaura.
 *
 * Uso:
 *   cd ticket-node && npm run build
 *   node scripts/_homolog-final-dispatch-127.js --execute
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TARGET_RESERVA_ID = 127;
const EXPECTED_HOSPEDIN_ID = '30295972';
const OBS_TEST = 'HOMOLOG FINAL DISPATCH';
const FORBIDDEN_HTTP = [
  '/reservation_transactions',
  '/sales',
  '/rate_reservations',
];

const args = new Set(process.argv.slice(2));
if (!args.has('--execute')) {
  console.error('Homologacao REAL. Use --execute');
  process.exit(1);
}

function log(tag, data) {
  if (data === undefined) console.log(tag);
  else console.log(tag, JSON.stringify(data, null, 2));
}

async function loadProviderConfig(conn) {
  const [rows] = await conn.query(
    `SELECT provider, enabled, interval_minutes, sync_limit, priority, max_retries
     FROM integration_provider_config WHERE provider = 'HOSPEDIN_OUTBOUND'`
  );
  return rows[0] || null;
}

async function loadProviderState(conn) {
  const [rows] = await conn.query(
    `SELECT provider, status, has_pending, next_run_at, last_started_at, last_finished_at,
            last_execution_id, updated_at
     FROM integration_provider_state WHERE provider = 'HOSPEDIN_OUTBOUND'`
  );
  return rows[0] || null;
}

async function countClaimable(conn) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS n FROM hospedin_outbound_sync_state
     WHERE outbound_status IN ('PENDING_CREATE','PENDING_UPDATE','PENDING_CANCEL','WAIT_RETRY')
       AND (next_retry_at IS NULL OR next_retry_at <= UTC_TIMESTAMP())`
  );
  return Number(rows[0]?.n || 0);
}

async function loadOutbound(conn, idReserva) {
  const [rows] = await conn.query(
    `SELECT * FROM hospedin_outbound_sync_state WHERE id_reserva_hospedagem = ?`,
    { replacements: [idReserva] }
  );
  return rows[0] || null;
}

async function loadReserva(conn, idReserva) {
  const [rows] = await conn.query(
    `SELECT id, status, origem_reserva, id_externo, codigo_externo, observacoes,
            observacao_importada, observacao_operador, valor_pago, saldo_pendente, valor_total
     FROM ReservaHospedagem WHERE id = ?`,
    { replacements: [idReserva] }
  );
  return rows[0] || null;
}

async function loadProtectedSummary(conn) {
  const ids = [124, 126, 127, 128, 129];
  const out = {};
  for (const id of ids) {
    const [r] = await conn.query(
      `SELECT o.id_reserva_hospedagem, o.outbound_status, o.desired_action,
              o.hospedin_reservation_id, rh.status AS jango_status
       FROM hospedin_outbound_sync_state o
       JOIN ReservaHospedagem rh ON rh.id = o.id_reserva_hospedagem
       WHERE o.id_reserva_hospedagem = ?`,
      { replacements: [id] }
    );
    out[id] = r[0] || null;
  }
  return out;
}

async function lastExecutions(conn, limit = 5) {
  const [rows] = await conn.query(
    `SELECT id, trigger_source, status, started_at, finished_at, duration_ms
     FROM integration_sync_execution
     WHERE provider = 'HOSPEDIN_OUTBOUND'
     ORDER BY id DESC LIMIT ?`,
    { replacements: [limit] }
  );
  return rows;
}

async function resolveAdmin(conn, idReserva) {
  const [rows] = await conn.query(
    `SELECT u.id FROM ReservaHospedagem rh
     JOIN Evento e ON e.id = rh.id_evento
     JOIN ProdutorAcesso pa ON pa.id_produtor = e.id_produtor AND pa.tipo_acesso = 'Administrador'
     JOIN Usuario u ON u.id = pa.id_usuario
     WHERE rh.id = ? AND u.ativo = 1 ORDER BY u.id ASC LIMIT 1`,
    { replacements: [idReserva] }
  );
  if (rows.length) return Number(rows[0].id);
  const [adm] = await conn.query(
    `SELECT id FROM Usuario WHERE adm_geral = 1 AND ativo = 1 ORDER BY id ASC LIMIT 1`
  );
  if (adm.length) return Number(adm[0].id);
  throw new Error('Admin nao encontrado');
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
    for (const f of FORBIDDEN_HTTP) {
      if (p.includes(f)) throw new Error(`HTTP financeiro proibido: ${p}`);
    }
  }
  function wrap(method, fn) {
    return async (path, data, opts) => {
      guard(path);
      calls.push({ method, path, body: data, at: new Date().toISOString() });
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

async function pollSnapshot(conn, label, fn, timeoutMs = 90000) {
  const start = Date.now();
  const trail = [];
  while (Date.now() - start < timeoutMs) {
    const snap = await fn();
    trail.push({ t: new Date().toISOString(), ms: Date.now() - start, ...snap });
    if (snap.done) return { trail, snap };
    await sleep(300);
  }
  throw new Error(`Timeout aguardando: ${label}`);
}

async function main() {
  const timeline = [];
  const result = {
    PROVIDER_ENABLED: 'NAO',
    WATCHDOG_INTERVAL: 15,
    FINAL_TEST_RESERVA: 127,
    TRIGGER: 'FAIL',
    HAS_PENDING_TRUE: 'FAIL',
    DISPATCHER_IMMEDIATE: 'FAIL',
    RUNNER: 'FAIL',
    HOSPEDIN_PATCH: 'FAIL',
    SYNCED: 'FAIL',
    HAS_PENDING_FALSE: 'FAIL',
    RESTORE_UPDATE: 'FAIL',
    CLAIMABLE_FINAL: -1,
    FINAL_RESULT: 'FAIL',
  };

  const conn = require('../dist/database').default || require('../dist/database');
  await sleep(3000);

  let httpAudit = null;
  let originalObsText = null;
  let configBefore = null;

  try {
    log('=== PREFLIGHT ===');
    const claimable = await countClaimable(conn);
    const config = await loadProviderConfig(conn);
    const protectedRows = await loadProtectedSummary(conn);
    log('PREFLIGHT', { claimable, config, protectedRows });

    if (claimable !== 0) {
      throw new Error(`claimable_count=${claimable} — PARE`);
    }
    if (Number(config?.enabled) !== 0) {
      throw new Error('HOSPEDIN_OUTBOUND ja habilitado — abortado por seguranca');
    }
    if (protectedRows[127]?.outbound_status !== 'SYNCED') {
      throw new Error(`#127 outbound ${protectedRows[127]?.outbound_status}`);
    }
    if (protectedRows[127]?.desired_action !== 'UPDATE') {
      throw new Error(`#127 action ${protectedRows[127]?.desired_action}`);
    }
    if (String(protectedRows[127]?.hospedin_reservation_id) !== EXPECTED_HOSPEDIN_ID) {
      throw new Error('Hospedin ID #127 incorreto');
    }
    if (protectedRows[128]?.outbound_status !== 'SYNCED' || protectedRows[128]?.desired_action !== 'CANCEL') {
      throw new Error('#128 estado inesperado');
    }
    if (String(protectedRows[128]?.hospedin_reservation_id) !== '30297720') {
      throw new Error('Hospedin ID #128 incorreto');
    }
    for (const id of [124, 126, 129]) {
      if (protectedRows[id]?.outbound_status !== 'ABORTED') {
        throw new Error(`#${id} deveria ABORTED`);
      }
    }

    configBefore = { ...config };
    log('=== HABILITAR PROVIDER ===');
    await conn.query(
      `UPDATE integration_provider_config
       SET enabled = 1, interval_minutes = 15, updated_at = UTC_TIMESTAMP()
       WHERE provider = 'HOSPEDIN_OUTBOUND'`
    );
    await conn.query(
      `UPDATE integration_provider_state
       SET status = 'IDLE',
           has_pending = 0,
           next_run_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE),
           updated_at = UTC_TIMESTAMP()
       WHERE provider = 'HOSPEDIN_OUTBOUND'`
    );
    const configAfter = await loadProviderConfig(conn);
    const stateAfter = await loadProviderState(conn);
    log('PROVIDER_ENABLED', { configAfter, stateAfter });
    result.PROVIDER_ENABLED = Number(configAfter?.enabled) === 1 ? 'SIM' : 'NAO';
    if (result.PROVIDER_ENABLED !== 'SIM') throw new Error('Falha ao habilitar provider');

    const { bootstrapIntegrationProviders } = require('../dist/integrations/bootstrap');
    const { atualizarObservacoesReservaAdmin } = require('../dist/services/hospedagemAdminService');
    const { hospedinReservationService } = require('../dist/integrations/hospedin/services/HospedinReservationService');
    bootstrapIntegrationProviders();
    httpAudit = installHttpAudit();

    const reservaBefore = await loadReserva(conn, TARGET_RESERVA_ID);
    const queueBefore = await loadOutbound(conn, TARGET_RESERVA_ID);
    const execBefore = await lastExecutions(conn, 3);
    log('STEP_127_ANTES', { reserva: reservaBefore, fila: queueBefore, execBefore });
    timeline.push({ step: 'antes', queue: queueBefore, state: await loadProviderState(conn) });

    originalObsText = reservaBefore?.observacoes || OBS_TEST;
    const idAdmin = await resolveAdmin(conn, TARGET_RESERVA_ID);

    const t0 = Date.now();
    log('STEP_MARK_DIRTY_UPDATE', { obs: OBS_TEST, idAdmin });
    await atualizarObservacoesReservaAdmin(TARGET_RESERVA_ID, idAdmin, OBS_TEST);

    const queueAfterDirty = await loadOutbound(conn, TARGET_RESERVA_ID);
    const stateAfterDirty = await loadProviderState(conn);
    log('APOS_MARK_DIRTY', { queue: queueAfterDirty, state: stateAfterDirty });
    timeline.push({ step: 'apos_markDirty', queue: queueAfterDirty, state: stateAfterDirty });

    if (queueAfterDirty?.outbound_status === 'PENDING_UPDATE') {
      result.TRIGGER = 'PASS';
    }
    if (Number(stateAfterDirty?.has_pending) === 1) {
      result.HAS_PENDING_TRUE = 'PASS';
    }

    const syncWait = await pollSnapshot(conn, 'SYNCED', async () => {
      const q = await loadOutbound(conn, TARGET_RESERVA_ID);
      const st = await loadProviderState(conn);
      const claim = await countClaimable(conn);
      return {
        outbound_status: q?.outbound_status,
        has_pending: st?.has_pending,
        claimable: claim,
        done: q?.outbound_status === 'SYNCED' && Number(st?.has_pending) === 0,
      };
    });

    const elapsedMs = Date.now() - t0;
    log('POLL_SYNC_TRAIL', syncWait.trail);
    log('ELAPSED_MS', elapsedMs);

    const queueSynced = await loadOutbound(conn, TARGET_RESERVA_ID);
    const stateSynced = await loadProviderState(conn);
    const execAfter = await lastExecutions(conn, 5);
    log('STEP_SYNCED', { queue: queueSynced, state: stateSynced, execAfter });

    const patchCalls = httpAudit.calls.filter((c) => c.method === 'PATCH');
    const postRes = httpAudit.calls.filter(
      (c) => c.method === 'POST' && String(c.path).includes('/reservations')
    );
    if (postRes.length) throw new Error('POST /reservations detectado — PARE');

    if (patchCalls.length >= 1) result.RUNNER = 'PASS';
    if (queueSynced?.outbound_status === 'SYNCED') result.SYNCED = 'PASS';
    if (Number(stateSynced?.has_pending) === 0) result.HAS_PENDING_FALSE = 'PASS';

    const lastExec = execAfter[0];
    const immediate =
      elapsedMs < 120000 &&
      lastExec?.trigger_source === 'WEBHOOK' &&
      patchCalls.length >= 1;
    if (immediate) result.DISPATCHER_IMMEDIATE = 'PASS';

    let hospedinDto = await hospedinReservationService.getReservationDto(EXPECTED_HOSPEDIN_ID);
    log('HOSPEDIN_GET_1', { note: hospedinDto?.note, id: hospedinDto?.id });
    const note1 = String(hospedinDto?.note || '');
    if (note1.includes('HOMOLOG FINAL DISPATCH')) {
      result.HOSPEDIN_PATCH = 'PASS';
    }

    log('=== RESTAURAR OBS ORIGINAL ===');
    const tRestore = Date.now();
    await atualizarObservacoesReservaAdmin(TARGET_RESERVA_ID, idAdmin, originalObsText);

    await pollSnapshot(conn, 'RESTORE_SYNCED', async () => {
      const q = await loadOutbound(conn, TARGET_RESERVA_ID);
      const st = await loadProviderState(conn);
      return {
        outbound_status: q?.outbound_status,
        has_pending: st?.has_pending,
        done: q?.outbound_status === 'SYNCED' && Number(st?.has_pending) === 0,
      };
    });

    const patchAfterRestore = httpAudit.calls.filter((c) => c.method === 'PATCH');
    hospedinDto = await hospedinReservationService.getReservationDto(EXPECTED_HOSPEDIN_ID);
    log('HOSPEDIN_GET_2', { note: hospedinDto?.note, restoreMs: Date.now() - tRestore });

    const restoredOk =
      patchAfterRestore.length >= 2 &&
      (await loadOutbound(conn, TARGET_RESERVA_ID))?.outbound_status === 'SYNCED';
    const queueFinal = await loadOutbound(conn, TARGET_RESERVA_ID);
    const claimFinal = await countClaimable(conn);
    result.CLAIMABLE_FINAL = claimFinal;

    if (
      patchAfterRestore.length >= 2 &&
      queueFinal?.outbound_status === 'SYNCED' &&
      claimFinal === 0 &&
      Number((await loadProviderState(conn))?.has_pending) === 0
    ) {
      result.RESTORE_UPDATE = 'PASS';
    }

    log('FINAL_STATE', {
      queueFinal,
      claimFinal,
      httpCalls: httpAudit.calls,
      timeline,
      execAfter: await lastExecutions(conn, 5),
    });

    const allPass = [
      result.TRIGGER,
      result.HAS_PENDING_TRUE,
      result.DISPATCHER_IMMEDIATE,
      result.RUNNER,
      result.HOSPEDIN_PATCH,
      result.SYNCED,
      result.HAS_PENDING_FALSE,
      result.RESTORE_UPDATE,
    ].every((v) => v === 'PASS');

    result.FINAL_RESULT = allPass && claimFinal === 0 ? 'PASS' : 'FAIL';
    log('RESULT', result);
  } catch (err) {
    log('FATAL', { message: err?.message, stack: err?.stack });
    log('RESULT', result);
    process.exitCode = 1;
  } finally {
    if (httpAudit) httpAudit.restore();
  }
}

main();
