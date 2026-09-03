/**
 * ETAPA 7.7 — CANCEL outbound REAL somente da Jango #128.
 *
 * Uso:
 *   cd ticket-node
 *   npm run build
 *   node scripts/_homolog-etapa77-cancel-outbound-128.js
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TARGET_RESERVA_ID = 128;
const EXPECTED_HOSPEDIN_ID = '30297720';
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

  hospedinApiClient.post = async (path, data, opts) => {
    guard(path);
    calls.push({
      method: 'POST',
      path,
      body: data && typeof data === 'object' ? { ...data, password: data.password ? '***' : undefined } : data,
    });
    return orig.post(path, data, opts);
  };
  hospedinApiClient.get = async (path, opts) => {
    guard(path);
    calls.push({ method: 'GET', path });
    return orig.get(path, opts);
  };
  hospedinApiClient.patch = async (path, data, opts) => {
    guard(path);
    calls.push({ method: 'PATCH', path, body: data });
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
            valor_pago, saldo_pendente, valor_total
     FROM ReservaHospedagem WHERE id = ?`,
    { replacements: [idReserva] }
  );
  return rows[0] || null;
}

async function loadFinancialSnapshot(sequelize, idReserva) {
  const reserva = await loadReservaSnapshot(sequelize, idReserva);
  const [pagamentos] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM PagamentoHospedagem WHERE id_reserva_hospedagem = ?`,
    { replacements: [idReserva] }
  );
  const [transacao] = await sequelize.query(
    `SELECT t.id, t.status, t.valor_total
     FROM ReservaHospedagem rh
     LEFT JOIN Transacao t ON t.id = rh.id_transacao
     WHERE rh.id = ?`,
    { replacements: [idReserva] }
  );
  return {
    valor_total: reserva?.valor_total,
    valor_pago: reserva?.valor_pago,
    saldo_pendente: reserva?.saldo_pendente,
    pagamentos_count: Number(pagamentos[0]?.cnt || 0),
    transacao: transacao[0] || null,
  };
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
      throw new Error(`Provider ${row.provider} habilitado — abortado.`);
    }
  }
}

async function main() {
  console.log('=== ETAPA 7.7 — CANCEL OUTBOUND REAL #128 ===');

  const connection =
    require('../dist/database').default || require('../dist/database');
  await sleep(4000);

  const scheduler = await loadSchedulerState(connection);
  assertSchedulerDisabled(scheduler);

  const protectedBefore = {};
  for (const id of PROTECTED_RESERVA_IDS) {
    protectedBefore[id] = {
      reserva: await loadReservaSnapshot(connection, id),
      outbound: await loadOutboundRow(connection, id),
    };
  }

  const reservaBefore = await loadReservaSnapshot(connection, TARGET_RESERVA_ID);
  const outboundBefore = await loadOutboundRow(connection, TARGET_RESERVA_ID);
  const financialBefore = await loadFinancialSnapshot(connection, TARGET_RESERVA_ID);

  log('TARGET_128_BEFORE', { reserva: reservaBefore, outbound: outboundBefore, financial: financialBefore });

  if (!outboundBefore) throw new Error('Fila #128 não encontrada.');
  if (outboundBefore.outbound_status !== 'PENDING_CANCEL') {
    throw new Error(`Esperado PENDING_CANCEL, encontrado: ${outboundBefore.outbound_status}`);
  }
  if (outboundBefore.desired_action !== 'CANCEL') {
    throw new Error(`Esperado desired_action CANCEL, encontrado: ${outboundBefore.desired_action}`);
  }
  if (String(outboundBefore.hospedin_reservation_id || '') !== EXPECTED_HOSPEDIN_ID) {
    throw new Error('hospedin_reservation_id divergente — abortado.');
  }

  const { HospedinOutboundSyncState } = require('../dist/models/HospedinOutboundSyncState');
  const { hospedinOutboundStateService } = require('../dist/integrations/hospedin/outbound/HospedinOutboundStateService');
  const { hospedinOutboundCancelService } = require('../dist/integrations/hospedin/outbound/HospedinOutboundCancelService');
  const { hospedinReservationService } = require('../dist/integrations/hospedin/services/HospedinReservationService');

  const stateRow = await HospedinOutboundSyncState.findByPk(outboundBefore.id);
  if (!stateRow) throw new Error('State row não carregada.');

  const httpAudit = installHttpAudit();
  const correlationId = `homolog-etapa77-128-${Date.now()}`;

  let hospedinStatusBefore = null;
  let hospedinStatusAfterCancel = null;

  try {
    hospedinStatusBefore = await hospedinReservationService.getReservationDto(
      EXPECTED_HOSPEDIN_ID
    );
    log('HOSPEDIN_BEFORE_CANCEL', {
      status: hospedinStatusBefore.status,
      reservationId: hospedinStatusBefore.reservationId,
    });

    if (String(hospedinStatusBefore.status || '') !== 'reservation') {
      throw new Error(
        `Hospedin antes do PATCH deveria ser reservation, encontrado: ${hospedinStatusBefore.status}`
      );
    }

    const claimed = await hospedinOutboundStateService.tryClaim(
      Number(stateRow.id),
      correlationId
    );
    log('TRY_CLAIM', { stateId: stateRow.id, claimed });
    if (!claimed) throw new Error('tryClaim falhou para #128.');

    const cancelResult = await hospedinOutboundCancelService.cancel(stateRow, {
      correlationId,
      maxRetries: 5,
      backoffBaseSeconds: 30,
    });
    log('CANCEL_RESULT', cancelResult);

    if (
      cancelResult.outcome !== 'cancelled' &&
      cancelResult.outcome !== 'idempotent'
    ) {
      throw new Error(`CANCEL falhou: outcome=${cancelResult.outcome}, message=${cancelResult.message}`);
    }

    hospedinStatusAfterCancel = await hospedinReservationService.getReservationDto(
      EXPECTED_HOSPEDIN_ID
    );
    log('HOSPEDIN_AFTER_CANCEL', {
      status: hospedinStatusAfterCancel.status,
      reservationId: hospedinStatusAfterCancel.reservationId,
    });

    const reservaAfter = await loadReservaSnapshot(connection, TARGET_RESERVA_ID);
    const outboundAfter = await loadOutboundRow(connection, TARGET_RESERVA_ID);
    const financialAfter = await loadFinancialSnapshot(connection, TARGET_RESERVA_ID);

    const protectedAfter = {};
    for (const id of PROTECTED_RESERVA_IDS) {
      protectedAfter[id] = {
        reserva: await loadReservaSnapshot(connection, id),
        outbound: await loadOutboundRow(connection, id),
      };
    }

    const patchCalls = httpAudit.calls.filter((c) => c.method === 'PATCH');
    const postReservations = httpAudit.calls.filter(
      (c) => c.method === 'POST' && String(c.path || '').includes('/reservations')
    );
    const forbiddenCalls = httpAudit.calls.filter((c) =>
      FORBIDDEN_HTTP_FRAGMENTS.some((f) => String(c.path || '').includes(f))
    );
    const cancelPatchCalls = patchCalls.filter(
      (c) =>
        c.body &&
        String(c.body.status || '').toLowerCase() === 'canceled' &&
        Object.keys(c.body).length === 1
    );

    const validation = {
      patch_count_exactly_1: cancelPatchCalls.length === 1,
      patch_body_exact: cancelPatchCalls.length === 1 && cancelPatchCalls[0].body?.status === 'canceled',
      no_post_reservations: postReservations.length === 0,
      no_finance_http: forbiddenCalls.length === 0,
      hospedin_before_reservation: String(hospedinStatusBefore.status) === 'reservation',
      hospedin_after_canceled:
        String(hospedinStatusAfterCancel.status || '').toLowerCase() === 'canceled',
      outbound_SYNCED: outboundAfter?.outbound_status === 'SYNCED',
      hospedin_id_preserved:
        String(outboundAfter?.hospedin_reservation_id || '') === EXPECTED_HOSPEDIN_ID,
      guest_id_preserved: String(outboundAfter?.hospedin_guest_id || '') === '22620073',
      jango_Cancelada: reservaAfter?.status === 'Cancelada',
      jango_id_externo: String(reservaAfter?.id_externo || '') === EXPECTED_HOSPEDIN_ID,
      jango_codigo_externo: reservaAfter?.codigo_externo === 'HO:001323',
      jango_origem_ATENDENTE: reservaAfter?.origem_reserva === 'ATENDENTE',
      financeiro_inalterado: JSON.stringify(financialBefore) === JSON.stringify(financialAfter),
      protected_124: JSON.stringify(protectedBefore[124]) === JSON.stringify(protectedAfter[124]),
      protected_126: JSON.stringify(protectedBefore[126]) === JSON.stringify(protectedAfter[126]),
      protected_127: JSON.stringify(protectedBefore[127]) === JSON.stringify(protectedAfter[127]),
    };

    const report = {
      A_state_id: outboundBefore.id,
      B_jango_id: TARGET_RESERVA_ID,
      C_hospedin_reservation_id: EXPECTED_HOSPEDIN_ID,
      D_http_ordem: httpAudit.calls.map((c) => ({ method: c.method, path: c.path })),
      E_patch_count: cancelPatchCalls.length,
      F_patch_body: cancelPatchCalls[0]?.body || null,
      G_status_hospedin_antes: hospedinStatusBefore.status,
      H_status_hospedin_depois: hospedinStatusAfterCancel.status,
      I_status_jango: reservaAfter?.status,
      J_outbound_final: {
        outbound_status: outboundAfter?.outbound_status,
        desired_action: outboundAfter?.desired_action,
        hospedin_reservation_id: outboundAfter?.hospedin_reservation_id,
        hospedin_guest_id: outboundAfter?.hospedin_guest_id,
      },
      K_vinculo_preservado: {
        id_externo: reservaAfter?.id_externo,
        codigo_externo: reservaAfter?.codigo_externo,
        hospedin_reservation_id: outboundAfter?.hospedin_reservation_id,
      },
      L_financeiro: { antes: financialBefore, depois: financialAfter },
      M_protegidas: {
        '124': protectedAfter[124],
        '126': protectedAfter[126],
        '127': protectedAfter[127],
      },
      N_scheduler: scheduler,
      cancel_outcome: cancelResult.outcome,
    };

    log('VALIDATION', validation);
    log('RELATORIO_ETAPA_7_7', report);

    const allOk = Object.values(validation).every(Boolean);
    const resultado = allOk ? 'APROVADO' : 'FALHOU';

    console.log('');
    console.log(`=== ETAPA 7.7 RESULTADO: ${resultado} ===`);

    if (!allOk) {
      throw new Error('Validação pós-CANCEL outbound falhou — não repetir PATCH.');
    }
  } finally {
    httpAudit.restore();
  }
}

main().catch((e) => {
  console.error('HOMOLOG_FATAL', e && e.stack ? e.stack : e);
  process.exit(1);
});
