/**
 * ETAPA 7.8 — Homologar cancelamento Jango ANTES de CREATE Hospedin.
 *
 * Uso:
 *   cd ticket-node
 *   npm run build
 *   node scripts/_homolog-etapa78-cancel-before-create.js
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MOTIVO = 'HOMOLOG CANCEL ANTES CREATE 7.8';
const HOMOLOG_OBS = 'HOMOLOG CANCEL ANTES CREATE 7.8';
const PROTECTED_RESERVA_IDS = [124, 126, 127, 128];
const HOMOLOG_DAY_OFFSETS = [55, 70, 100, 130, 160, 190, 220, 280, 375, 465, 555];
const FORBIDDEN_HTTP_FRAGMENTS = [
  '/reservation_transactions',
  '/sales',
  '/rate_reservations',
];
const NON_TERMINAL_OUTBOUND = new Set([
  'PENDING_CREATE',
  'PENDING_UPDATE',
  'PENDING_CANCEL',
  'WAIT_RETRY',
  'PROCESSING',
  'SYNCED',
]);

function log(tag, data) {
  if (data === undefined) console.log(tag);
  else console.log(tag, JSON.stringify(data, null, 2));
}

function buildStayDates(daysFromNow) {
  const checkin = new Date();
  checkin.setUTCDate(checkin.getUTCDate() + daysFromNow);
  checkin.setUTCHours(14, 0, 0, 0);
  const checkout = new Date(checkin);
  checkout.setUTCDate(checkout.getUTCDate() + 2);
  checkout.setUTCHours(12, 0, 0, 0);
  return { checkin, checkout };
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
            hospedin_reservation_id, hospedin_guest_id, error_code, last_error
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

async function countDueCandidatesSql(sequelize) {
  const [rows] = await sequelize.query(
    `SELECT id_reserva_hospedagem, outbound_status, desired_action
     FROM hospedin_outbound_sync_state
     WHERE outbound_status IN ('PENDING_CREATE','PENDING_UPDATE','PENDING_CANCEL','WAIT_RETRY')
       AND (next_retry_at IS NULL OR next_retry_at <= UTC_TIMESTAMP())
     ORDER BY dirty_at ASC`
  );
  return rows;
}

async function resolveLinkedSuiteAvailable(suiteTemConflito, linkedSuites) {
  for (const daysFromNow of HOMOLOG_DAY_OFFSETS) {
    const { checkin, checkout } = buildStayDates(daysFromNow);
    for (const suite of linkedSuites) {
      const idEventoSuite = Number(suite.id_evento_suite);
      const conflito = await suiteTemConflito(idEventoSuite, checkin, checkout);
      if (!conflito) {
        return {
          idEvento: Number(suite.id_evento),
          idEventoSuite,
          suiteNome: suite.nome,
          checkin,
          checkout,
        };
      }
    }
  }
  throw new Error('Nenhuma suite LINKED disponivel.');
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

function assertSchedulerDisabled(sequelizeRows) {
  const envEnabled = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.HOSPEDIN_OUTBOUND_SYNC_ENABLED || '').toLowerCase()
  );
  if (envEnabled) throw new Error('HOSPEDIN_OUTBOUND_SYNC_ENABLED=true — abortado.');
  for (const row of sequelizeRows) {
    if (Number(row.enabled) === 1) {
      throw new Error(`Provider ${row.provider} habilitado — abortado.`);
    }
  }
}

async function testCreateGuardAbortsWithoutPost(stateRow) {
  let postCalled = false;
  const mockReservationService = {
    createReservation: async () => {
      postCalled = true;
      throw new Error('POST /reservations nao deveria ser chamado');
    },
    getReservationDto: async () => {
      throw new Error('GET nao deveria ser chamado no guard CREATE');
    },
    cancelReservation: async () => {
      throw new Error('PATCH nao deveria ser chamado no guard CREATE');
    },
    updateReservation: async () => {
      throw new Error('UPDATE nao deveria ser chamado no guard CREATE');
    },
  };
  const mockGuestService = {
    resolveOrCreateGuestId: async () => {
      throw new Error('guest service nao deveria ser chamado');
    },
  };

  const { HospedinOutboundCreateService } = require('../dist/integrations/hospedin/outbound/HospedinOutboundCreateService');
  const svc = new HospedinOutboundCreateService(
    mockReservationService,
    mockGuestService
  );
  const result = await svc.create(stateRow, {
    correlationId: 'homolog-etapa78-guard',
  });
  return { result, postCalled };
}

async function main() {
  console.log('=== ETAPA 7.8 — CANCEL ANTES DO CREATE HOSPEDIN ===');

  const connection =
    require('../dist/database').default || require('../dist/database');
  await sleep(4000);

  const [scheduler] = await connection.query(
    `SELECT provider, enabled FROM integration_provider_config
     WHERE provider IN ('HOSPEDIN', 'HOSPEDIN_OUTBOUND')`
  );
  assertSchedulerDisabled(scheduler);
  log('SCHEDULER', scheduler);

  const protectedBefore = {};
  for (const id of PROTECTED_RESERVA_IDS) {
    protectedBefore[id] = {
      reserva: await loadReservaSnapshot(connection, id),
      outbound: await loadOutboundRow(connection, id),
    };
  }
  log('PROTECTED_BEFORE', protectedBefore);

  const httpAudit = installHttpAudit();
  let idReserva = null;

  try {
    const { suiteTemConflito, checkoutHospedagem } = require('../dist/services/reservaSuiteService');

    const [maps] = await connection.query(
      `SELECT m.id_evento_suite, m.place_id, es.id_evento, es.nome
       FROM hospedin_place_suite_map m
       JOIN EventoSuite es ON es.id = m.id_evento_suite
       WHERE m.ativo = 1 AND m.mapping_status = 'LINKED'
       ORDER BY m.id_evento_suite ASC`
    );
    const plan = await resolveLinkedSuiteAvailable(suiteTemConflito, maps);
    const idOperador = await resolveIdOperador(connection);
    const [users] = await connection.query(
      `SELECT id FROM Usuario WHERE ativo = 1 ORDER BY id ASC LIMIT 1`
    );

    log('STEP_1_create', { plan, idOperador });

    const created = await checkoutHospedagem({
      idEvento: plan.idEvento,
      idUsuario: Number(users[0].id),
      checkin: plan.checkin,
      checkout: plan.checkout,
      origem: 'recepcao',
      idUsuarioOperador: idOperador,
      observacoes: HOMOLOG_OBS,
      suites: [
        {
          idEventoSuite: plan.idEventoSuite,
          adultos: 2,
          criancas: 0,
          hospedes: [{ nome: 'Hospede Homolog Cancel Before Create 7.8', tipo: 'Adulto' }],
        },
      ],
      pagamento: null,
    });

    idReserva = created.hospedagem.id;
    const reservaBefore = await loadReservaSnapshot(connection, idReserva);
    const outboundBefore = await loadOutboundRow(connection, idReserva);
    const financialBeforeCancel = await loadFinancialSnapshot(connection, idReserva);

    log('A_RESERVA_CRIADA', { id: idReserva, reserva: reservaBefore, outbound: outboundBefore });

    const step2 = {
      status_Confirmada: reservaBefore?.status === 'Confirmada',
      sem_id_externo: !reservaBefore?.id_externo,
      sem_codigo_externo: !reservaBefore?.codigo_externo,
      outbound_PENDING_CREATE: outboundBefore?.outbound_status === 'PENDING_CREATE',
      desired_CREATE: outboundBefore?.desired_action === 'CREATE',
      hospedin_id_null: !outboundBefore?.hospedin_reservation_id,
    };
    log('STEP_2_antes_cancel', step2);
    if (!Object.values(step2).every(Boolean)) {
      throw new Error('Reserva #129? nao esta pronta para homolog cancel-before-create.');
    }

    const postResBefore = httpAudit.calls.filter(
      (c) => c.method === 'POST' && String(c.path || '').includes('/reservations')
    );
    if (postResBefore.length > 0) {
      throw new Error('POST /reservations detectado antes do cancelamento — abortado.');
    }

    const { cancelarReservaHospedagemAdmin } = require('../dist/services/hospedagemCancelamentoAdminService');
    const cancelResult = await cancelarReservaHospedagemAdmin({
      idReservaHospedagem: idReserva,
      idUsuario: idOperador,
      motivo: MOTIVO,
    });
    log('STEP_3_cancel_admin', cancelResult);

    const reservaAfter = await loadReservaSnapshot(connection, idReserva);
    const outboundAfter = await loadOutboundRow(connection, idReserva);
    const financialAfterCancel = await loadFinancialSnapshot(connection, idReserva);

    const { hospedinOutboundStateService } = require('../dist/integrations/hospedin/outbound/HospedinOutboundStateService');
    const { HospedinOutboundSyncState } = require('../dist/models/HospedinOutboundSyncState');

    const dueList = await hospedinOutboundStateService.listDue(200);
    const dueSql = await countDueCandidatesSql(connection);
    const inDueList = dueList.some(
      (r) => Number(r.id_reserva_hospedagem) === Number(idReserva)
    );
    const inDueSql = dueSql.some(
      (r) => Number(r.id_reserva_hospedagem) === Number(idReserva)
    );

    const stateRow = await HospedinOutboundSyncState.findByPk(outboundAfter.id);
    const tryClaimResult = await hospedinOutboundStateService.tryClaim(
      Number(outboundAfter.id),
      'homolog-etapa78-claim-test'
    );

    const guardTest = await testCreateGuardAbortsWithoutPost(stateRow);
    log('STEP_8_create_guard', guardTest);

    const protectedAfter = {};
    for (const id of PROTECTED_RESERVA_IDS) {
      protectedAfter[id] = {
        reserva: await loadReservaSnapshot(connection, id),
        outbound: await loadOutboundRow(connection, id),
      };
    }

    const postReservations = httpAudit.calls.filter(
      (c) => c.method === 'POST' && String(c.path || '').includes('/reservations')
    );
    const patchCalls = httpAudit.calls.filter((c) => c.method === 'PATCH');
    const forbiddenCalls = httpAudit.calls.filter((c) =>
      FORBIDDEN_HTTP_FRAGMENTS.some((f) => String(c.path || '').includes(f))
    );

    const validation = {
      step2_ok: Object.values(step2).every(Boolean),
      jango_Cancelada: reservaAfter?.status === 'Cancelada',
      sem_id_externo_depois: !reservaAfter?.id_externo,
      sem_codigo_externo_depois: !reservaAfter?.codigo_externo,
      outbound_ABORTED: outboundAfter?.outbound_status === 'ABORTED',
      nao_claimable_status: !NON_TERMINAL_OUTBOUND.has(outboundAfter?.outbound_status),
      not_in_listDue: !inDueList,
      not_in_due_sql: !inDueSql,
      tryClaim_false: tryClaimResult === false,
      error_code_CREATE_ABORTED: outboundAfter?.error_code === 'CREATE_ABORTED',
      no_post_reservations: postReservations.length === 0,
      no_patch: patchCalls.length === 0,
      no_finance_http: forbiddenCalls.length === 0,
      create_guard_aborted: guardTest.result.outcome === 'aborted',
      create_guard_no_post: guardTest.postCalled === false,
      financeiro_inalterado:
        String(financialBeforeCancel.valor_total) === String(reservaAfter?.valor_total) &&
        String(financialBeforeCancel.valor_pago) === String(reservaAfter?.valor_pago) &&
        String(financialBeforeCancel.saldo_pendente) === String(reservaAfter?.saldo_pendente) &&
        financialBeforeCancel.pagamentos_count === financialAfterCancel.pagamentos_count,
      protected_124: JSON.stringify(protectedBefore[124]) === JSON.stringify(protectedAfter[124]),
      protected_126: JSON.stringify(protectedBefore[126]) === JSON.stringify(protectedAfter[126]),
      protected_127: JSON.stringify(protectedBefore[127]) === JSON.stringify(protectedAfter[127]),
      protected_128: JSON.stringify(protectedBefore[128]) === JSON.stringify(protectedAfter[128]),
    };

    const report = {
      A_id_reserva: idReserva,
      B_status_antes: reservaBefore?.status,
      C_outbound_antes: outboundBefore,
      D_status_depois: reservaAfter?.status,
      E_outbound_depois: outboundAfter,
      F_desired_action: outboundAfter?.desired_action,
      G_hospedin_id: outboundAfter?.hospedin_reservation_id ?? null,
      H_sem_post_reservations: postReservations.length === 0,
      I_ABORTED_nao_claimable: {
        listDue_contains: inDueList,
        due_sql_contains: inDueSql,
        tryClaim: tryClaimResult,
      },
      J_financeiro: { antes_cancel: financialBeforeCancel, depois_cancel: financialAfterCancel },
      K_protegidas: protectedAfter,
      L_scheduler: scheduler,
      M_http: httpAudit.calls,
      create_guard: guardTest.result,
    };

    log('VALIDATION', validation);
    log('RELATORIO_ETAPA_7_8', report);

    const allOk = Object.values(validation).every(Boolean);
    const resultado = allOk ? 'APROVADO' : 'FALHOU';
    console.log('');
    console.log(`=== ETAPA 7.8 RESULTADO: ${resultado} ===`);
    console.log('RESERVA_HOMOLOG_ID', idReserva);

    if (!allOk) {
      throw new Error('Validacao ETAPA 7.8 falhou.');
    }
  } finally {
    httpAudit.restore();
  }
}

main().catch((e) => {
  console.error('HOMOLOG_FATAL', e && e.stack ? e.stack : e);
  process.exit(1);
});
