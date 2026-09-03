/**
 * Homologação funcional mínima — ETAPA 2 outbound (dry-run, sem HTTP Hospedin).
 *
 * Uso:
 *   cd ticket-node
 *   npm run build
 *   node scripts/_homolog-etapa2-outbound.js
 *
 * Não altera id_externo nem simula PENDING_UPDATE.
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Offsets em dias (UTC) testados até achar suite LINKED sem conflito. */
const HOMOLOG_DAY_OFFSETS = [45, 60, 90, 120, 150, 180, 210, 270, 365, 455, 545];

const report = {
  CREATE_QUEUE: 'NOK',
  PROCESSING_CLAIM: 'NOK',
  RELEASE_TO_PENDING: 'NOK',
  DRY_RUN: 'NOK',
  HASH_UPDATE: 'NOK',
  SINGLE_ROW: 'NOK',
  HTTP_HOSPEDIN: 0,
};

function log(msg, data) {
  console.log(data === undefined ? msg : msg + ' ' + JSON.stringify(data, null, 2));
}

async function loadQueue(sequelize, idReserva) {
  const [rows] = await sequelize.query(
    `SELECT id, id_reserva_hospedagem, outbound_status, desired_action,
            hospedin_reservation_id, pending_payload_hash, payload_hash,
            processing_started_at, processing_correlation_id, dirty_at
     FROM hospedin_outbound_sync_state
     WHERE id_reserva_hospedagem = ?`,
    { replacements: [idReserva] }
  );
  return rows;
}

/**
 * Resolve idOperador com colunas reais do MySQL (snake_case).
 * admGeral no Sequelize = adm_geral no banco.
 */
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
    return {
      idOperador: Number(scoped[0].id),
      source: 'produtor_admin_scoped_to_linked_suite',
      detail: scoped[0],
    };
  }

  const [admGeral] = await sequelize.query(
    `SELECT id, nome_completo
     FROM Usuario
     WHERE adm_geral = 1 AND ativo = 1
     ORDER BY id ASC
     LIMIT 1`
  );
  if (admGeral.length) {
    return {
      idOperador: Number(admGeral[0].id),
      source: 'adm_geral',
      detail: admGeral[0],
    };
  }

  const [prodAdmin] = await sequelize.query(
    `SELECT u.id, u.nome_completo, pa.id_produtor
     FROM Usuario u
     INNER JOIN ProdutorAcesso pa ON pa.id_usuario = u.id
     WHERE u.ativo = 1
       AND pa.tipo_acesso = 'Administrador'
     ORDER BY u.id ASC
     LIMIT 1`
  );
  if (prodAdmin.length) {
    return {
      idOperador: Number(prodAdmin[0].id),
      source: 'produtor_admin_any',
      detail: prodAdmin[0],
    };
  }

  throw new Error(
    'Nenhum operador válido: informe adm_geral=1 ou ProdutorAcesso tipo Administrador.'
  );
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

/**
 * Mesma verificação de checkoutHospedagem (recepção):
 *   suiteTemConflito(idEventoSuite, checkin, checkout, options?)
 *   -> listarReservasSuiteConflitantes(idEventoSuite, { inicio, fim }, options?)
 * Requer modelos Sequelize inicializados (require('../dist/database') + await).
 */
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
          daysFromNow,
          availabilityCheck: 'suiteTemConflito',
        };
      }
    }
  }

  throw new Error(
    'Nenhuma suite LINKED disponivel no periodo testado (suiteTemConflito).'
  );
}

async function main() {
  console.log('=== HOMOLOG ETAPA 2 OUTBOUND (inicio) ===');

  // Mesmo padrão de scripts/_run-hospedin-sync-once.js e _homolog-guest-resolver-smoke.js:
  // side-effect load inicia authenticate + *Init() + associate(); default export = Sequelize.
  const connection =
    require('../dist/database').default || require('../dist/database');
  await sleep(4000);

  const { checkoutHospedagem, suiteTemConflito } = require('../dist/services/reservaSuiteService');
  const { atualizarObservacoesReservaAdmin } = require('../dist/services/hospedagemAdminService');
  const { bootstrapIntegrationProviders } = require('../dist/integrations/bootstrap');
  const { providerRegistry } = require('../dist/integrations/core/ProviderRegistry');
  const { runProviderCycle } = require('../dist/integrations/core/SyncRunOrchestrator');
  const { IntegrationSyncTrigger } = require('../dist/models/IntegrationSyncExecution');
  const { hospedinOutboundStateService } = require('../dist/integrations/hospedin/outbound/HospedinOutboundStateService');

  bootstrapIntegrationProviders();
  const registeredProviders = providerRegistry.ids();
  log('TEST_PROVIDER_REGISTRY', {
    providers: registeredProviders,
    hasHospedin: registeredProviders.includes('HOSPEDIN'),
    hasHospedinOutbound: registeredProviders.includes('HOSPEDIN_OUTBOUND'),
  });
  if (
    !registeredProviders.includes('HOSPEDIN') ||
    !registeredProviders.includes('HOSPEDIN_OUTBOUND')
  ) {
    throw new Error(
      'providerRegistry incompleto apos bootstrapIntegrationProviders()'
    );
  }

  const [maps] = await connection.query(
    `SELECT m.id_evento_suite, es.id_evento, es.nome
     FROM hospedin_place_suite_map m
     JOIN EventoSuite es ON es.id = m.id_evento_suite
     WHERE m.ativo = 1 AND m.mapping_status = 'LINKED'
     ORDER BY m.id_evento_suite ASC`
  );
  if (!maps.length) throw new Error('Nenhuma suite LINKED encontrada.');

  const plan = await resolveLinkedSuiteAvailable(suiteTemConflito, maps);
  log('PLAN_HOMOLOG', {
    idEvento: plan.idEvento,
    idEventoSuite: plan.idEventoSuite,
    suite: plan.suiteNome,
    daysFromNow: plan.daysFromNow,
    checkin: plan.checkin.toISOString(),
    checkout: plan.checkout.toISOString(),
    availabilityCheck: plan.availabilityCheck,
    linkedSuitesTestadas: maps.length,
  });

  const operador = await resolveIdOperador(connection);
  const [users] = await connection.query(
    `SELECT id FROM Usuario WHERE ativo = 1 ORDER BY id ASC LIMIT 1`
  );
  if (!users.length) throw new Error('Nenhum usuario ativo encontrado.');

  const idEvento = plan.idEvento;
  const idEventoSuite = plan.idEventoSuite;
  const idOperador = operador.idOperador;
  const idUsuario = Number(users[0].id);
  const checkin = plan.checkin;
  const checkout = plan.checkout;

  const obsHomolog = 'HOMOLOG OUTBOUND ETAPA2 ' + new Date().toISOString();

  log('STEP_1_create_reservation', {
    idEvento,
    idEventoSuite,
    suite: plan.suiteNome,
    idOperador,
    operadorSource: operador.source,
    operadorDetail: operador.detail,
    idUsuario,
    checkin: checkin.toISOString(),
    checkout: checkout.toISOString(),
  });

  const created = await checkoutHospedagem({
    idEvento,
    idUsuario,
    checkin,
    checkout,
    origem: 'recepcao',
    idUsuarioOperador: idOperador,
    observacoes: obsHomolog,
    suites: [
      {
        idEventoSuite,
        adultos: 2,
        criancas: 0,
        hospedes: [{ nome: 'Hospede Homolog Outbound', tipo: 'Adulto' }],
      },
    ],
    pagamento: null,
  });

  const idReserva = created.hospedagem.id;
  log('RESERVA_CRIADA', { idReserva });

  const queue1 = await loadQueue(connection, idReserva);
  log('TEST_CREATE_QUEUE', queue1);

  const row1 = queue1[0];
  const hashBeforeRun = row1 && row1.pending_payload_hash;

  report.CREATE_QUEUE =
    queue1.length === 1 &&
    row1 &&
    row1.outbound_status === 'PENDING_CREATE' &&
    row1.desired_action === 'CREATE' &&
    (row1.hospedin_reservation_id == null || row1.hospedin_reservation_id === '') &&
    Boolean(row1.pending_payload_hash)
      ? 'OK'
      : 'NOK';

  report.SINGLE_ROW = queue1.length === 1 ? 'OK' : 'NOK';

  const correlationId = 'homolog-claim-' + Date.now();
  const claimed = await hospedinOutboundStateService.tryClaim(row1.id, correlationId);
  const mid = (await loadQueue(connection, idReserva))[0];
  log('TEST_PROCESSING_CLAIM', { claimed, row: mid });

  report.PROCESSING_CLAIM =
    claimed &&
    mid &&
    mid.outbound_status === 'PROCESSING' &&
    mid.processing_started_at &&
    mid.processing_correlation_id === correlationId
      ? 'OK'
      : 'NOK';

  await hospedinOutboundStateService.releaseToPending(row1.id, {
    desiredAction: 'CREATE',
  });
  const afterRelease = (await loadQueue(connection, idReserva))[0];
  log('TEST_RELEASE_TO_PENDING', afterRelease);

  report.RELEASE_TO_PENDING =
    afterRelease &&
    afterRelease.outbound_status === 'PENDING_CREATE' &&
    !afterRelease.processing_started_at &&
    !afterRelease.processing_correlation_id
      ? 'OK'
      : 'NOK';

  console.log('STEP_2_runProviderCycle_1 (aguarde logs outbound:*)');
  const run1 = await runProviderCycle('HOSPEDIN_OUTBOUND', IntegrationSyncTrigger.MANUAL, {
    force: true,
    syncLimit: 30,
  });
  log('RUN1_RESULT', { skipped: run1.skipped, summary: run1.summary });

  const queue2 = await loadQueue(connection, idReserva);
  log('TEST_DRY_RUN_AFTER_RUN1', queue2);

  const row2 = queue2[0];
  const dryRun1Ok =
    !run1.skipped &&
    queue2.length === 1 &&
    row2 &&
    row2.outbound_status === 'PENDING_CREATE' &&
    row2.outbound_status !== 'SYNCED' &&
    (row2.hospedin_reservation_id == null || row2.hospedin_reservation_id === '') &&
    row2.pending_payload_hash === hashBeforeRun;

  log('STEP_3_alterar_observacao');
  await atualizarObservacoesReservaAdmin(
    idReserva,
    idOperador,
    obsHomolog + ' - obs alterada homolog'
  );

  const queue3 = await loadQueue(connection, idReserva);
  log('TEST_HASH_UPDATE', queue3);

  report.HASH_UPDATE =
    queue3.length === 1 &&
    queue3[0] &&
    queue3[0].pending_payload_hash &&
    queue3[0].pending_payload_hash !== hashBeforeRun
      ? 'OK'
      : 'NOK';

  console.log('STEP_4_runProviderCycle_2 (aguarde logs outbound:*)');
  const run2 = await runProviderCycle('HOSPEDIN_OUTBOUND', IntegrationSyncTrigger.MANUAL, {
    force: true,
    syncLimit: 30,
  });
  log('RUN2_RESULT', { skipped: run2.skipped, summary: run2.summary });

  const queue4 = await loadQueue(connection, idReserva);
  log('TEST_DRY_RUN_AFTER_RUN2', queue4);

  const row4 = queue4[0];
  const dryRun2Ok =
    !run2.skipped &&
    queue4.length === 1 &&
    row4 &&
    row4.outbound_status === 'PENDING_CREATE' &&
    (row4.hospedin_reservation_id == null || row4.hospedin_reservation_id === '');

  report.DRY_RUN = dryRun1Ok && dryRun2Ok ? 'OK' : 'NOK';
  report.SINGLE_ROW = queue4.length === 1 ? 'OK' : 'NOK';

  console.log('=== FINAL_REPORT ===');
  console.log(JSON.stringify(report, null, 2));
  console.log('RESERVA_TESTE_ID', idReserva);
  console.log('=== HOMOLOG ETAPA 2 OUTBOUND (fim) ===');
}

main().catch((e) => {
  console.error('HOMOLOG_FATAL', e && e.stack ? e.stack : e);
  process.exit(1);
});
