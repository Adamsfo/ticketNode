/**
 * ETAPA 7.6 — Cancelar Jango #128 e validar PENDING_CANCEL (sem runner, sem PATCH).
 *
 * Uso:
 *   cd ticket-node
 *   npm run build
 *   node scripts/_homolog-etapa76-cancel-128.js
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TARGET_RESERVA_ID = 128;
const PROTECTED_RESERVA_IDS = [124, 126, 127];
const MOTIVO = 'HOMOLOG CANCEL OUTBOUND 7.6';
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
    calls.push({ method: 'POST', path });
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
    `SELECT id, id_reserva_hospedagem, outbound_status, desired_action,
            hospedin_reservation_id, hospedin_guest_id
     FROM hospedin_outbound_sync_state WHERE id_reserva_hospedagem = ?`,
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

async function loadFinancialTables(sequelize, idReserva) {
  const [pagamentos] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM PagamentoHospedagem WHERE id_reserva_hospedagem = ?`,
    { replacements: [idReserva] }
  );
  const [origemFin] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM reserva_origem_financeira WHERE id_reserva_hospedagem = ?`,
    { replacements: [idReserva] }
  );
  const [transacao] = await sequelize.query(
    `SELECT rh.id_transacao, t.status, t.valor_total
     FROM ReservaHospedagem rh
     LEFT JOIN Transacao t ON t.id = rh.id_transacao
     WHERE rh.id = ?`,
    { replacements: [idReserva] }
  );
  return {
    pagamentos_count: Number(pagamentos[0]?.cnt || 0),
    origem_financeira_count: Number(origemFin[0]?.cnt || 0),
    transacao: transacao[0] || null,
  };
}

async function resolveIdOperador(sequelize) {
  const [admGeral] = await sequelize.query(
    `SELECT id FROM Usuario WHERE adm_geral = 1 AND ativo = 1 ORDER BY id ASC LIMIT 1`
  );
  if (admGeral.length) return Number(admGeral[0].id);
  const [any] = await sequelize.query(
    `SELECT id FROM Usuario WHERE ativo = 1 ORDER BY id ASC LIMIT 1`
  );
  if (any.length) return Number(any[0].id);
  throw new Error('Nenhum operador valido.');
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
  console.log('=== ETAPA 7.6 — CANCEL JANGO #128 + VALIDAR PENDING_CANCEL ===');

  const connection =
    require('../dist/database').default || require('../dist/database');
  await sleep(4000);

  const scheduler = await loadSchedulerState(connection);
  assertSchedulerDisabled(scheduler);
  log('SCHEDULER', scheduler);

  const protectedBefore = {};
  for (const id of PROTECTED_RESERVA_IDS) {
    protectedBefore[id] = {
      reserva: await loadReservaSnapshot(connection, id),
      outbound: await loadOutboundRow(connection, id),
    };
  }

  const reservaBefore = await loadReservaSnapshot(connection, TARGET_RESERVA_ID);
  const outboundBefore = await loadOutboundRow(connection, TARGET_RESERVA_ID);
  const financialBefore = await loadFinancialTables(connection, TARGET_RESERVA_ID);

  log('TARGET_128_BEFORE', {
    reserva: reservaBefore,
    outbound: outboundBefore,
    financial: financialBefore,
  });

  if (!outboundBefore?.hospedin_reservation_id) {
    throw new Error('#128 sem hospedin_reservation_id — abortado.');
  }
  const hospedinIdBefore = String(outboundBefore.hospedin_reservation_id);

  const idOperador = await resolveIdOperador(connection);
  const { cancelarReservaHospedagemAdmin } = require('../dist/services/hospedagemCancelamentoAdminService');
  const { hospedinReservationService } = require('../dist/integrations/hospedin/services/HospedinReservationService');

  const httpAudit = installHttpAudit();

  try {
    const cancelResult = await cancelarReservaHospedagemAdmin({
      idReservaHospedagem: TARGET_RESERVA_ID,
      idUsuario: idOperador,
      motivo: MOTIVO,
    });
    log('CANCEL_ADMIN_RESULT', cancelResult);

    const reservaAfter = await loadReservaSnapshot(connection, TARGET_RESERVA_ID);
    const outboundAfter = await loadOutboundRow(connection, TARGET_RESERVA_ID);
    const financialAfter = await loadFinancialTables(connection, TARGET_RESERVA_ID);

    const remote = await hospedinReservationService.getReservationDto(hospedinIdBefore);
    log('HOSPEDIN_GET', {
      reservationId: hospedinIdBefore,
      status: remote.status,
      searchableCode: remote.searchableCode,
    });

    const protectedAfter = {};
    for (const id of PROTECTED_RESERVA_IDS) {
      protectedAfter[id] = {
        reserva: await loadReservaSnapshot(connection, id),
        outbound: await loadOutboundRow(connection, id),
      };
    }

    const patchCancel = httpAudit.calls.filter(
      (c) =>
        c.method === 'PATCH' &&
        c.body &&
        String(c.body.status || '').toLowerCase() === 'canceled'
    );

    const validation = {
      jango_Cancelada: reservaAfter?.status === 'Cancelada',
      id_externo_preservado:
        String(reservaAfter?.id_externo || '') === hospedinIdBefore,
      codigo_externo_preservado: Boolean(reservaAfter?.codigo_externo),
      origem_inalterada:
        String(reservaAfter?.origem_reserva || '') ===
        String(reservaBefore?.origem_reserva || ''),
      outbound_PENDING_CANCEL: outboundAfter?.outbound_status === 'PENDING_CANCEL',
      desired_CANCEL: outboundAfter?.desired_action === 'CANCEL',
      hospedin_id_preservado:
        String(outboundAfter?.hospedin_reservation_id || '') === hospedinIdBefore,
      nao_SYNCED: outboundAfter?.outbound_status !== 'SYNCED',
      nao_PENDING_CREATE: outboundAfter?.outbound_status !== 'PENDING_CREATE',
      nao_PENDING_UPDATE: outboundAfter?.outbound_status !== 'PENDING_UPDATE',
      hospedin_status_reservation: String(remote.status || '') === 'reservation',
      sem_patch_cancel: patchCancel.length === 0,
      financeiro_inalterado:
        String(financialBefore.valor_pago) === String(reservaAfter?.valor_pago) &&
        String(financialBefore.saldo_pendente) ===
          String(reservaAfter?.saldo_pendente) &&
        String(financialBefore.valor_total) === String(reservaAfter?.valor_total) &&
        financialBefore.pagamentos_count === financialAfter.pagamentos_count &&
        financialBefore.origem_financeira_count ===
          financialAfter.origem_financeira_count,
      protected_124: JSON.stringify(protectedBefore[124]) === JSON.stringify(protectedAfter[124]),
      protected_126: JSON.stringify(protectedBefore[126]) === JSON.stringify(protectedAfter[126]),
      protected_127: JSON.stringify(protectedBefore[127]) === JSON.stringify(protectedAfter[127]),
    };

    const report = {
      A_status_jango: reservaAfter?.status,
      B_id_externo: reservaAfter?.id_externo,
      C_codigo_externo: reservaAfter?.codigo_externo,
      D_outbound_status: outboundAfter?.outbound_status,
      E_desired_action: outboundAfter?.desired_action,
      F_hospedin_reservation_id: outboundAfter?.hospedin_reservation_id,
      G_hospedin_get_status: remote.status,
      H_124: protectedAfter[124],
      I_126: protectedAfter[126],
      J_127: protectedAfter[127],
      K_zero_financeiro: validation.financeiro_inalterado && validation.sem_patch_cancel,
      L_scheduler_desabilitado: true,
      M_http_executados: httpAudit.calls,
    };

    log('RESERVA_128_AFTER', reservaAfter);
    log('OUTBOUND_128_AFTER', outboundAfter);
    log('VALIDATION', validation);
    log('RELATORIO_ETAPA_7_6', report);

    const allOk = Object.values(validation).every(Boolean);
    if (!allOk) {
      throw new Error('Validação pós-cancelamento falhou.');
    }

    console.log('');
    console.log('=== ETAPA 7.6: SUCESSO — PENDING_CANCEL confirmado ===');
    console.log('Proxima etapa: runner/PATCH cancel Hospedin (nao executado aqui)');
  } finally {
    httpAudit.restore();
  }
}

main().catch((e) => {
  console.error('HOMOLOG_FATAL', e && e.stack ? e.stack : e);
  process.exit(1);
});
