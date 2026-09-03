/**
 * Homologação controlada — ETAPA 3: PRIMEIRO CREATE REAL Jango → Hospedin.
 *
 * Processa EXATAMENTE UMA nova reserva via runProviderCycle(HOSPEDIN_OUTBOUND).
 * Isola temporariamente as filas 124 e 126 (BLOCKED) e restaura no finally.
 *
 * Uso:
 *   cd ticket-node
 *   npm run build
 *
 *   # Somente leitura / plano (sem HTTP Hospedin, sem criar reserva):
 *   node scripts/_homolog-etapa3-outbound-create-real.js --preview
 *
 *   # Execução real (POST /guests e POST /reservations permitidos):
 *   node scripts/_homolog-etapa3-outbound-create-real.js --execute
 *
 * Não altera src/. Não altera reservas 124/126 permanentemente.
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ISOLATE_RESERVA_IDS = [124, 126];
const HOMOLOG_DAY_OFFSETS = [45, 60, 90, 120, 150, 180, 210, 270, 365, 455, 545];
const FORBIDDEN_HTTP_FRAGMENTS = [
  '/reservation_transactions',
  '/sales',
  '/rate_reservations',
];

const args = new Set(process.argv.slice(2));
const MODE_PREVIEW = args.has('--preview') || !args.has('--execute');
const MODE_EXECUTE = args.has('--execute');

if (!MODE_PREVIEW && !MODE_EXECUTE) {
  console.error('Use --preview ou --execute');
  process.exit(1);
}

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

async function loadOutboundRow(sequelize, idReserva) {
  const [rows] = await sequelize.query(
    `SELECT * FROM hospedin_outbound_sync_state WHERE id_reserva_hospedagem = ?`,
    { replacements: [idReserva] }
  );
  return rows[0] || null;
}

async function loadReservaSnapshot(sequelize, idReserva) {
  const [rows] = await sequelize.query(
    `SELECT id, id_externo, codigo_externo, origem_reserva, valor_pago, saldo_pendente,
            valor_total, status, checkin, checkout
     FROM ReservaHospedagem WHERE id = ?`,
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
          placeId: Number(suite.place_id),
          placeTypeId: suite.place_type_id != null ? Number(suite.place_type_id) : null,
          checkin,
          checkout,
          daysFromNow,
        };
      }
    }
  }
  throw new Error('Nenhuma suite LINKED disponivel no periodo testado.');
}

async function resolveIdOperador(sequelize) {
  const [scoped] = await sequelize.query(
    `SELECT u.id, u.nome_completo, e.id AS id_evento, e.id_produtor
     FROM hospedin_place_suite_map m
     JOIN EventoSuite es ON es.id = m.id_evento_suite
     JOIN Evento e ON e.id = es.id_evento
     JOIN ProdutorAcesso pa
       ON pa.id_produtor = e.id_produtor
      AND pa.tipo_acesso = 'Administrador'
     JOIN Usuario u ON u.id = pa.id_usuario
     WHERE m.ativo = 1
       AND m.mapping_status = 'LINKED'
       AND u.ativo = 1
     ORDER BY m.id_evento_suite ASC, u.id ASC
     LIMIT 1`
  );
  if (scoped.length) {
    return { idOperador: Number(scoped[0].id), source: 'produtor_admin_scoped', detail: scoped[0] };
  }
  const [admGeral] = await sequelize.query(
    `SELECT id, nome_completo FROM Usuario WHERE adm_geral = 1 AND ativo = 1 ORDER BY id ASC LIMIT 1`
  );
  if (admGeral.length) {
    return { idOperador: Number(admGeral[0].id), source: 'adm_geral', detail: admGeral[0] };
  }
  throw new Error('Nenhum operador valido para checkout de homologacao.');
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
        throw new Error(`HTTP proibido nesta homologacao: ${p}`);
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

async function previewPhase(connection, suiteTemConflito) {
  console.log('=== ETAPA 3 — PREVIEW HOMOLOG CREATE REAL (sem HTTP Hospedin) ===');

  const [maps] = await connection.query(
    `SELECT m.id_evento_suite, m.place_id, es.id_evento, es.nome,
            hp.place_type_id
     FROM hospedin_place_suite_map m
     JOIN EventoSuite es ON es.id = m.id_evento_suite
     LEFT JOIN hospedin_places hp ON hp.place_id = m.place_id
     WHERE m.ativo = 1 AND m.mapping_status = 'LINKED'
     ORDER BY m.id_evento_suite ASC`
  );
  if (!maps.length) throw new Error('Nenhuma suite LINKED.');

  const plan = await resolveLinkedSuiteAvailable(suiteTemConflito, maps);
  const operador = await resolveIdOperador(connection);

  const isolateSnapshots = {};
  for (const id of ISOLATE_RESERVA_IDS) {
    isolateSnapshots[id] = await loadOutboundRow(connection, id);
  }

  const dueBefore = await countDueCandidates(connection);

  log('PLANO_SUITE', {
    idEvento: plan.idEvento,
    idEventoSuite: plan.idEventoSuite,
    suiteNome: plan.suiteNome,
    place_id: plan.placeId,
    place_type_id: plan.placeTypeId,
    checkin: plan.checkin.toISOString(),
    checkout: plan.checkout.toISOString(),
    daysFromNow: plan.daysFromNow,
    idOperador: operador.idOperador,
    operadorSource: operador.source,
  });

  log('ISOLAMENTO_TEMPORARIO_124_126', {
    reservas: ISOLATE_RESERVA_IDS,
    estadoAtual: isolateSnapshots,
    acaoDuranteTeste:
      'outbound_status -> BLOCKED (somente se claimable); restauracao completa no finally',
    camposPreservadosNaRestauracao:
      'todos os campos do snapshot (dirty_at, retry_count, hospedin_reservation_id, etc.)',
  });

  log('FILA_DUE_ANTES_DO_TESTE', {
    totalDue: dueBefore.length,
    rows: dueBefore,
    observacao:
      'Apos isolamento de 124/126, a unica candidata esperada sera a NOVA reserva criada no --execute',
  });

  log('RESERVA_TESTE_ID', {
    preview: 'sera definido apos checkoutHospedagem no --execute',
    candidatoUnicoEsperado:
      'syncLimit=1 processara somente a nova reserva se 124/126 estiverem BLOCKED',
  });

  console.log('');
  console.log('COMANDO_PARA_EXECUCAO_REAL:');
  console.log('  cd ticket-node');
  console.log('  npm run build');
  console.log('  node scripts/_homolog-etapa3-outbound-create-real.js --execute');
  console.log('');
  console.log('HTTP permitido no --execute: POST /guests, POST /reservations');
  console.log('HTTP proibido: /reservation_transactions, /sales, /rate_reservations');
  console.log('=== FIM PREVIEW — aguardando aprovacao manual ===');
}

async function executePhase(connection, suiteTemConflito) {
  console.log('=== ETAPA 3 — EXECUCAO CREATE REAL (HTTP Hospedin habilitado) ===');

  const outboundSnapshots = {};
  const reservaSnapshots = {};
  let httpAudit = null;
  let idReservaTeste = null;
  let financialBefore = null;

  try {
    const { checkoutHospedagem } = require('../dist/services/reservaSuiteService');
    const { bootstrapIntegrationProviders } = require('../dist/integrations/bootstrap');
    const { providerRegistry } = require('../dist/integrations/core/ProviderRegistry');
    const { runProviderCycle } = require('../dist/integrations/core/SyncRunOrchestrator');
    const { IntegrationSyncTrigger } = require('../dist/models/IntegrationSyncExecution');

    bootstrapIntegrationProviders();
    if (!providerRegistry.ids().includes('HOSPEDIN_OUTBOUND')) {
      throw new Error('HOSPEDIN_OUTBOUND nao registrado apos bootstrap.');
    }

    httpAudit = installHttpAudit();

    const [maps] = await connection.query(
      `SELECT m.id_evento_suite, m.place_id, es.id_evento, es.nome,
              hp.place_type_id
       FROM hospedin_place_suite_map m
       JOIN EventoSuite es ON es.id = m.id_evento_suite
       LEFT JOIN hospedin_places hp ON hp.place_id = m.place_id
       WHERE m.ativo = 1 AND m.mapping_status = 'LINKED'
       ORDER BY m.id_evento_suite ASC`
    );
    const plan = await resolveLinkedSuiteAvailable(suiteTemConflito, maps);
    const operador = await resolveIdOperador(connection);

    const [users] = await connection.query(
      `SELECT id FROM Usuario WHERE ativo = 1 ORDER BY id ASC LIMIT 1`
    );
    if (!users.length) throw new Error('Nenhum usuario ativo.');

    for (const id of ISOLATE_RESERVA_IDS) {
      outboundSnapshots[id] = await loadOutboundRow(connection, id);
      reservaSnapshots[id] = await loadReservaSnapshot(connection, id);
    }

    log('STEP_0_isolate_124_126', { ids: ISOLATE_RESERVA_IDS });
    for (const id of ISOLATE_RESERVA_IDS) {
      const isolated = await isolateForTest(connection, id, outboundSnapshots[id]);
      log(`ISOLATED_${id}`, { isolated, before: outboundSnapshots[id] });
    }

    const dueAfterIsolate = await countDueCandidates(connection);
    log('FILA_DUE_APOS_ISOLAMENTO', dueAfterIsolate);

    const obsHomolog =
      'HOMOLOG OUTBOUND ETAPA3 CREATE REAL ' + new Date().toISOString();

    log('STEP_1_checkoutHospedagem', {
      idEvento: plan.idEvento,
      idEventoSuite: plan.idEventoSuite,
      suite: plan.suiteNome,
      place_id: plan.placeId,
      place_type_id: plan.placeTypeId,
      checkin: plan.checkin.toISOString(),
      checkout: plan.checkout.toISOString(),
      idOperador: operador.idOperador,
    });

    const created = await checkoutHospedagem({
      idEvento: plan.idEvento,
      idUsuario: Number(users[0].id),
      checkin: plan.checkin,
      checkout: plan.checkout,
      origem: 'recepcao',
      idUsuarioOperador: operador.idOperador,
      observacoes: obsHomolog,
      suites: [
        {
          idEventoSuite: plan.idEventoSuite,
          adultos: 2,
          criancas: 0,
          hospedes: [{ nome: 'Hospede Homolog Outbound ETAPA3', tipo: 'Adulto' }],
        },
      ],
      pagamento: null,
    });

    idReservaTeste = created.hospedagem.id;
    financialBefore = await loadReservaSnapshot(connection, idReservaTeste);
    log('RESERVA_TESTE_ID', idReservaTeste);

    const queueNew = await loadOutboundRow(connection, idReservaTeste);
    log('STEP_2_fila_nova_reserva', queueNew);

    const queueOk =
      queueNew &&
      queueNew.outbound_status === 'PENDING_CREATE' &&
      queueNew.desired_action === 'CREATE' &&
      (queueNew.hospedin_reservation_id == null ||
        queueNew.hospedin_reservation_id === '');

    if (!queueOk) {
      throw new Error('Fila da nova reserva invalida para CREATE outbound.');
    }

    const dueBeforeRun = await countDueCandidates(connection);
    log('STEP_3_candidatos_antes_provider', dueBeforeRun);

    if (
      dueBeforeRun.length !== 1 ||
      Number(dueBeforeRun[0].id_reserva_hospedagem) !== Number(idReservaTeste)
    ) {
      throw new Error(
        `Esperado 1 candidato (reserva ${idReservaTeste}), encontrado: ${JSON.stringify(dueBeforeRun)}`
      );
    }

    console.log('STEP_4_runProviderCycle (syncLimit=1, force=true)');
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

    const queueFinal = await loadOutboundRow(connection, idReservaTeste);
    const reservaFinal = await loadReservaSnapshot(connection, idReservaTeste);

    log('STEP_5_fila_final', queueFinal);
    log('STEP_5_reserva_final', reservaFinal);
    log('STEP_5_http_calls', httpAudit.calls);

    const forbiddenCalls = httpAudit.calls.filter((c) =>
      FORBIDDEN_HTTP_FRAGMENTS.some((f) => String(c.path || '').includes(f))
    );

    const validation = {
      outbound_SYNCED: queueFinal?.outbound_status === 'SYNCED',
      desired_CREATE: queueFinal?.desired_action === 'CREATE',
      hospedin_reservation_id: Boolean(queueFinal?.hospedin_reservation_id),
      hospedin_guest_id: Boolean(queueFinal?.hospedin_guest_id),
      id_externo: Boolean(reservaFinal?.id_externo),
      codigo_externo: Boolean(reservaFinal?.codigo_externo),
      origem_nao_HOSPEDIN:
        String(reservaFinal?.origem_reserva || '').toUpperCase() !== 'HOSPEDIN',
      valor_pago_inalterado:
        String(financialBefore?.valor_pago) === String(reservaFinal?.valor_pago),
      saldo_pendente_inalterado:
        String(financialBefore?.saldo_pendente ?? '') ===
        String(reservaFinal?.saldo_pendente ?? ''),
      sem_http_financeiro: forbiddenCalls.length === 0,
      provider_nao_skipped: !run.skipped,
    };

    log('VALIDATION', validation);

    const reservationPost = httpAudit.calls.find(
      (c) => c.method === 'POST' && String(c.path || '').includes('/reservations')
    );
    const guestPost = httpAudit.calls.find(
      (c) => c.method === 'POST' && String(c.path || '').includes('/guests')
    );

    log('RELATORIO_FINAL', {
      id_reserva_jango: idReservaTeste,
      id_reserva_hospedin: queueFinal?.hospedin_reservation_id || reservaFinal?.id_externo,
      searchable_code: reservaFinal?.codigo_externo,
      id_hospede_hospedin: queueFinal?.hospedin_guest_id,
      place_id: plan.placeId,
      place_type_id: plan.placeTypeId,
      payload_reservation_enviado: reservationPost?.body || null,
      payload_guest_enviado: guestPost?.body || null,
      provider: run.summary || null,
      fila_final: queueFinal,
      validation,
      http_calls_count: httpAudit.calls.length,
    });

    const allOk = Object.values(validation).every(Boolean);
    if (!allOk) {
      throw new Error('Validacao pos-CREATE falhou — ver VALIDATION/RELATORIO_FINAL.');
    }

    console.log('=== HOMOLOG ETAPA 3 CREATE REAL: SUCESSO ===');
    console.log('RESERVA_TESTE_ID', idReservaTeste);
  } finally {
    console.log('FINALLY: restaurando filas 124 e 126...');
    for (const id of ISOLATE_RESERVA_IDS) {
      try {
        await restoreOutboundSnapshot(connection, id, outboundSnapshots[id]);
        log(`RESTORED_OUTBOUND_${id}`, { ok: true });
      } catch (e) {
        log(`RESTORED_OUTBOUND_${id}_ERROR`, {
          message: e && e.message ? e.message : String(e),
          snapshot: outboundSnapshots[id],
        });
      }
    }
    if (httpAudit) httpAudit.restore();
    console.log('FINALLY: concluido. Nova reserva de homologacao mantida para auditoria:', idReservaTeste);
  }
}

async function main() {
  const connection =
    require('../dist/database').default || require('../dist/database');
  await sleep(4000);

  const { suiteTemConflito } = require('../dist/services/reservaSuiteService');

  if (MODE_PREVIEW) {
    await previewPhase(connection, suiteTemConflito);
    return;
  }

  if (MODE_EXECUTE) {
    await executePhase(connection, suiteTemConflito);
  }
}

main().catch((e) => {
  console.error('HOMOLOG_FATAL', e && e.stack ? e.stack : e);
  process.exit(1);
});
