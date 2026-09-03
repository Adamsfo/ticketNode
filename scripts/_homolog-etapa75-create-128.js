/**
 * ETAPA 7.5 — CREATE outbound REAL controlado somente da reserva Jango #128.
 *
 * - NÃO habilita scheduler
 * - NÃO usa runProviderCycle / runner genérico
 * - Chama HospedinOutboundCreateService diretamente após tryClaim da #128
 * - GET Hospedin pós-POST para validação
 *
 * Uso:
 *   cd ticket-node
 *   npm run build
 *   node scripts/_homolog-etapa75-create-128.js
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TARGET_RESERVA_ID = 128;
const PROTECTED_RESERVA_IDS = [124, 126, 127];
const FORBIDDEN_HTTP_FRAGMENTS = [
  '/reservation_transactions',
  '/sales',
  '/rate_reservations',
];

function log(tag, data) {
  if (data === undefined) console.log(tag);
  else console.log(tag, JSON.stringify(data, null, 2));
}

function sanitizePayload(data) {
  if (data == null) return data;
  if (typeof data !== 'object') return data;
  const out = { ...data };
  for (const k of Object.keys(out)) {
    if (/password|token|authorization/i.test(k)) out[k] = '***';
  }
  return out;
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
      if (p.includes(frag)) {
        throw new Error(`HTTP financeiro proibido: ${p}`);
      }
    }
  }

  hospedinApiClient.post = async (path, data, opts) => {
    guard(path);
    calls.push({ method: 'POST', path, body: sanitizePayload(data) });
    return orig.post(path, data, opts);
  };
  hospedinApiClient.get = async (path, opts) => {
    guard(path);
    calls.push({ method: 'GET', path });
    return orig.get(path, opts);
  };
  hospedinApiClient.patch = async (path, data, opts) => {
    guard(path);
    calls.push({ method: 'PATCH', path, body: sanitizePayload(data) });
    return orig.patch(path, data, opts);
  };

  return {
    calls,
    restore() {
      hospedinApiClient.post = orig.post;
      hospedinApiClient.get = orig.get;
      hospedinApiClient.patch = orig.patch;
    },
  };
}

async function loadOutboundRow(sequelize, idReserva) {
  const [rows] = await sequelize.query(
    `SELECT * FROM hospedin_outbound_sync_state WHERE id_reserva_hospedagem = ?`,
    { replacements: [idReserva] }
  );
  return rows[0] || null;
}

async function loadReservaSnapshot(sequelize, idReserva) {
  const [rows] = await sequelize.query(
    `SELECT id, status, origem_reserva, id_externo, codigo_externo,
            valor_pago, saldo_pendente, valor_total, checkin, checkout, observacoes
     FROM ReservaHospedagem WHERE id = ?`,
    { replacements: [idReserva] }
  );
  return rows[0] || null;
}

async function loadSchedulerState(sequelize) {
  const [rows] = await sequelize.query(
    `SELECT provider, enabled FROM integration_provider_config
     WHERE provider IN ('HOSPEDIN', 'HOSPEDIN_OUTBOUND')`
  );
  return rows;
}

function assertSchedulerDisabled(rows) {
  const envEnabled = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.HOSPEDIN_OUTBOUND_SYNC_ENABLED || '').toLowerCase()
  );
  if (envEnabled) throw new Error('HOSPEDIN_OUTBOUND_SYNC_ENABLED=true — abortado.');
  for (const row of rows) {
    if (Number(row.enabled) === 1) {
      throw new Error(`Provider ${row.provider} habilitado no banco — abortado.`);
    }
  }
}

async function main() {
  console.log('=== ETAPA 7.5 — CREATE OUTBOUND REAL #128 ===');

  const connection =
    require('../dist/database').default || require('../dist/database');
  await sleep(4000);

  const scheduler = await loadSchedulerState(connection);
  log('SCHEDULER', scheduler);
  assertSchedulerDisabled(scheduler);

  const protectedBefore = {};
  for (const id of PROTECTED_RESERVA_IDS) {
    protectedBefore[id] = {
      reserva: await loadReservaSnapshot(connection, id),
      outbound: await loadOutboundRow(connection, id),
    };
  }
  log('PROTECTED_BEFORE', protectedBefore);

  const reservaBefore = await loadReservaSnapshot(connection, TARGET_RESERVA_ID);
  const outboundBefore = await loadOutboundRow(connection, TARGET_RESERVA_ID);
  log('TARGET_128_BEFORE', { reserva: reservaBefore, outbound: outboundBefore });

  if (!outboundBefore) {
    throw new Error('Fila outbound da #128 não encontrada.');
  }
  if (outboundBefore.outbound_status !== 'PENDING_CREATE') {
    throw new Error(
      `Esperado PENDING_CREATE, encontrado: ${outboundBefore.outbound_status}`
    );
  }
  if (outboundBefore.desired_action !== 'CREATE') {
    throw new Error(
      `Esperado desired_action CREATE, encontrado: ${outboundBefore.desired_action}`
    );
  }
  if (outboundBefore.hospedin_reservation_id) {
    throw new Error('hospedin_reservation_id já preenchido — abortado.');
  }

  const financialBefore = {
    valor_pago: reservaBefore?.valor_pago,
    saldo_pendente: reservaBefore?.saldo_pendente,
    valor_total: reservaBefore?.valor_total,
  };

  const { HospedinOutboundSyncState } = require('../dist/models/HospedinOutboundSyncState');
  const { hospedinOutboundStateService } = require('../dist/integrations/hospedin/outbound/HospedinOutboundStateService');
  const { hospedinOutboundCreateService } = require('../dist/integrations/hospedin/outbound/HospedinOutboundCreateService');
  const { hospedinReservationService } = require('../dist/integrations/hospedin/services/HospedinReservationService');

  const stateRow = await HospedinOutboundSyncState.findByPk(outboundBefore.id);
  if (!stateRow) throw new Error('State row #128 não carregada via Sequelize.');

  const correlationId = `homolog-etapa75-128-${Date.now()}`;
  const httpAudit = installHttpAudit();

  try {
    const claimed = await hospedinOutboundStateService.tryClaim(
      Number(stateRow.id),
      correlationId
    );
    log('TRY_CLAIM', { stateId: stateRow.id, claimed });
    if (!claimed) {
      throw new Error('tryClaim falhou — fila #128 não claimable.');
    }

    const createResult = await hospedinOutboundCreateService.create(stateRow, {
      correlationId,
      maxRetries: 5,
      backoffBaseSeconds: 30,
    });
    log('CREATE_RESULT', createResult);

    if (
      createResult.outcome !== 'created' &&
      createResult.outcome !== 'idempotent'
    ) {
      throw new Error(`CREATE falhou: outcome=${createResult.outcome}`);
    }

    const hospedinReservationId = String(
      createResult.hospedinReservationId || ''
    ).trim();
    if (!hospedinReservationId) {
      throw new Error('CREATE sem hospedinReservationId.');
    }

    const remote = await hospedinReservationService.getReservationDto(
      hospedinReservationId
    );
    log('HOSPEDIN_GET_AFTER_POST', remote);

    const reservaAfter = await loadReservaSnapshot(connection, TARGET_RESERVA_ID);
    const outboundAfter = await loadOutboundRow(connection, TARGET_RESERVA_ID);

    const protectedAfter = {};
    for (const id of PROTECTED_RESERVA_IDS) {
      protectedAfter[id] = {
        reserva: await loadReservaSnapshot(connection, id),
        outbound: await loadOutboundRow(connection, id),
      };
    }

    const forbiddenCalls = httpAudit.calls.filter((c) =>
      FORBIDDEN_HTTP_FRAGMENTS.some((f) => String(c.path || '').includes(f))
    );
    const cancelPatch = httpAudit.calls.filter(
      (c) =>
        c.method === 'PATCH' &&
        c.body &&
        String(c.body.status || '').toLowerCase() === 'canceled'
    );

    const validation = {
      get_status_reservation: String(remote.status || '') === 'reservation',
      jango_status_Confirmada: reservaAfter?.status === 'Confirmada',
      jango_id_externo: String(reservaAfter?.id_externo || '') === hospedinReservationId,
      jango_codigo_externo: Boolean(reservaAfter?.codigo_externo),
      outbound_SYNCED: outboundAfter?.outbound_status === 'SYNCED',
      outbound_desired_CREATE: outboundAfter?.desired_action === 'CREATE',
      outbound_hospedin_reservation_id:
        String(outboundAfter?.hospedin_reservation_id || '') ===
        hospedinReservationId,
      outbound_hospedin_guest_id: Boolean(outboundAfter?.hospedin_guest_id),
      financeiro_inalterado:
        String(financialBefore.valor_pago) === String(reservaAfter?.valor_pago) &&
        String(financialBefore.saldo_pendente) ===
          String(reservaAfter?.saldo_pendente) &&
        String(financialBefore.valor_total) === String(reservaAfter?.valor_total),
      sem_http_financeiro: forbiddenCalls.length === 0,
      sem_patch_cancel: cancelPatch.length === 0,
      protected_124_intacta:
        JSON.stringify(protectedBefore[124]) === JSON.stringify(protectedAfter[124]),
      protected_126_intacta:
        JSON.stringify(protectedBefore[126]) === JSON.stringify(protectedAfter[126]),
      protected_127_intacta:
        JSON.stringify(protectedBefore[127]) === JSON.stringify(protectedAfter[127]),
    };

    const reservationPost = httpAudit.calls.find(
      (c) => c.method === 'POST' && String(c.path || '').includes('/reservations')
    );
    const guestPost = httpAudit.calls.find(
      (c) => c.method === 'GET' || c.method === 'POST'
        ? String(c.path || '').includes('/guests')
        : false
    );

    log('HTTP_CALLS', httpAudit.calls);
    log('RESERVA_128_AFTER', reservaAfter);
    log('OUTBOUND_128_AFTER', outboundAfter);
    log('PROTECTED_AFTER', protectedAfter);
    log('VALIDATION', validation);

    const report = {
      A_http_executados: httpAudit.calls.map((c) => ({
        method: c.method,
        path: c.path,
      })),
      B_reservation_id: hospedinReservationId,
      C_searchable_code: remote.searchableCode ?? reservaAfter?.codigo_externo,
      D_guest_id: remote.guestId ?? outboundAfter?.hospedin_guest_id,
      E_place_id: remote.placeId,
      F_place_type_id: remote.placeTypeId,
      G_status_hospedin: remote.status,
      H_status_jango: reservaAfter?.status,
      I_outbound_final: {
        outbound_status: outboundAfter?.outbound_status,
        desired_action: outboundAfter?.desired_action,
        hospedin_reservation_id: outboundAfter?.hospedin_reservation_id,
        hospedin_guest_id: outboundAfter?.hospedin_guest_id,
      },
      J_protected_intactas: {
        '124': validation.protected_124_intacta,
        '126': validation.protected_126_intacta,
        '127': validation.protected_127_intacta,
      },
      K_zero_financeiro: validation.sem_http_financeiro && validation.financeiro_inalterado,
      L_scheduler_desabilitado: true,
      payload_reservation_post: reservationPost?.body || null,
      guest_http: guestPost || null,
    };

    log('RELATORIO_ETAPA_7_5', report);

    const allOk = Object.values(validation).every(Boolean);
    if (!allOk) {
      throw new Error('Validação pós-CREATE falhou — ver VALIDATION.');
    }

    console.log('');
    console.log('=== ETAPA 7.5 CREATE #128: SUCESSO ===');
    console.log('HOSPEDIN_RESERVATION_ID', hospedinReservationId);
    console.log('SEARCHABLE_CODE', report.C_searchable_code);
  } finally {
    httpAudit.restore();
  }
}

main().catch((e) => {
  console.error('HOMOLOG_FATAL', e && e.stack ? e.stack : e);
  process.exit(1);
});
