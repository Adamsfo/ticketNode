/**
 * ETAPA 7.4 — Preparar reserva descartável para homologação CANCEL outbound.
 *
 * - Verifica scheduler DESABILITADO
 * - Verifica #127 / #124 / #126 (somente leitura)
 * - Cria reserva via checkoutHospedagem (fluxo recepção)
 * - Valida fila PENDING_CREATE
 *
 * NÃO executa: runner, POST/PATCH Hospedin, cancelamento.
 *
 * Uso:
 *   cd ticket-node
 *   npm run build
 *   node scripts/_homolog-etapa74-prepare-cancel-outbound.js
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROTECTED_RESERVA_IDS = [127, 124, 126];
const HOMOLOG_OBS = 'HOMOLOG CANCEL OUTBOUND 7.4';
const HOMOLOG_DAY_OFFSETS = [50, 65, 95, 125, 155, 185, 215, 275, 370, 460, 550];

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
    `SELECT id, id_reserva_hospedagem, outbound_status, desired_action,
            hospedin_reservation_id, hospedin_guest_id, dirty_at, last_error, error_code
     FROM hospedin_outbound_sync_state WHERE id_reserva_hospedagem = ?`,
    { replacements: [idReserva] }
  );
  return rows[0] || null;
}

async function loadReservaDetail(sequelize, idReserva) {
  const [rows] = await sequelize.query(
    `SELECT rh.id, rh.status, rh.origem_reserva, rh.id_externo, rh.codigo_externo,
            rh.checkin, rh.checkout, rh.valor_pago, rh.saldo_pendente, rh.observacoes,
            rs.id AS reserva_suite_id, rs.id_evento_suite, es.nome AS suite_nome
     FROM ReservaHospedagem rh
     LEFT JOIN ReservaSuite rs ON rs.id_reserva_hospedagem = rh.id
     LEFT JOIN EventoSuite es ON es.id = rs.id_evento_suite
     WHERE rh.id = ?
     ORDER BY rs.id ASC
     LIMIT 1`,
    { replacements: [idReserva] }
  );
  return rows[0] || null;
}

async function loadSchedulerState(sequelize) {
  const [rows] = await sequelize.query(
    `SELECT provider, enabled, interval_minutes, updated_at
     FROM integration_provider_config
     WHERE provider IN ('HOSPEDIN', 'HOSPEDIN_OUTBOUND')
     ORDER BY provider ASC`
  );
  const envOutbound = String(process.env.HOSPEDIN_OUTBOUND_SYNC_ENABLED || '')
    .trim()
    .toLowerCase();
  return {
    env_HOSPEDIN_OUTBOUND_SYNC_ENABLED: envOutbound || '(unset/false)',
    db: rows,
  };
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
    `SELECT u.id, u.nome_completo
     FROM hospedin_place_suite_map m
     JOIN EventoSuite es ON es.id = m.id_evento_suite
     JOIN Evento e ON e.id = es.id_evento
     JOIN ProdutorAcesso pa ON pa.id_produtor = e.id_produtor AND pa.tipo_acesso = 'Administrador'
     JOIN Usuario u ON u.id = pa.id_usuario
     WHERE m.ativo = 1 AND m.mapping_status = 'LINKED' AND u.ativo = 1
     ORDER BY m.id_evento_suite ASC, u.id ASC
     LIMIT 1`
  );
  if (scoped.length) {
    return { idOperador: Number(scoped[0].id), source: 'produtor_admin_scoped' };
  }
  const [admGeral] = await sequelize.query(
    `SELECT id FROM Usuario WHERE adm_geral = 1 AND ativo = 1 ORDER BY id ASC LIMIT 1`
  );
  if (admGeral.length) {
    return { idOperador: Number(admGeral[0].id), source: 'adm_geral' };
  }
  throw new Error('Nenhum operador valido.');
}

function assertSchedulerDisabled(scheduler) {
  const outboundDb = (scheduler.db || []).find((r) => r.provider === 'HOSPEDIN_OUTBOUND');
  const envEnabled = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.HOSPEDIN_OUTBOUND_SYNC_ENABLED || '').toLowerCase()
  );
  if (envEnabled) {
    throw new Error('HOSPEDIN_OUTBOUND_SYNC_ENABLED=true no ambiente — abortado.');
  }
  if (outboundDb && Number(outboundDb.enabled) === 1) {
    throw new Error('HOSPEDIN_OUTBOUND habilitado no banco — abortado.');
  }
}

async function main() {
  console.log('=== ETAPA 7.4 — PREPARAR HOMOLOG CANCEL OUTBOUND ===');

  const connection =
    require('../dist/database').default || require('../dist/database');
  await sleep(4000);

  const scheduler = await loadSchedulerState(connection);
  log('SCHEDULER_STATE', scheduler);
  assertSchedulerDisabled(scheduler);
  log('SCHEDULER_OK', { globalOutbound: 'DESABILITADO' });

  const protectedSnapshots = {};
  for (const id of PROTECTED_RESERVA_IDS) {
    protectedSnapshots[id] = {
      reserva: await loadReservaDetail(connection, id),
      outbound: await loadOutboundRow(connection, id),
    };
  }
  log('PROTECTED_RESERVAS_127_124_126', protectedSnapshots);

  const { suiteTemConflito, checkoutHospedagem } = require('../dist/services/reservaSuiteService');

  const [maps] = await connection.query(
    `SELECT m.id_evento_suite, m.place_id, es.id_evento, es.nome
     FROM hospedin_place_suite_map m
     JOIN EventoSuite es ON es.id = m.id_evento_suite
     WHERE m.ativo = 1 AND m.mapping_status = 'LINKED'
     ORDER BY m.id_evento_suite ASC`
  );
  if (!maps.length) throw new Error('Nenhuma suite LINKED.');

  const plan = await resolveLinkedSuiteAvailable(suiteTemConflito, maps);
  const operador = await resolveIdOperador(connection);

  const [users] = await connection.query(
    `SELECT id FROM Usuario WHERE ativo = 1 ORDER BY id ASC LIMIT 1`
  );
  if (!users.length) throw new Error('Nenhum usuario ativo.');

  log('PLANO_CRIACAO', {
    idEvento: plan.idEvento,
    idEventoSuite: plan.idEventoSuite,
    suiteNome: plan.suiteNome,
    place_id: plan.placeId,
    checkin: plan.checkin.toISOString(),
    checkout: plan.checkout.toISOString(),
    idOperador: operador.idOperador,
    observacao: HOMOLOG_OBS,
  });

  const created = await checkoutHospedagem({
    idEvento: plan.idEvento,
    idUsuario: Number(users[0].id),
    checkin: plan.checkin,
    checkout: plan.checkout,
    origem: 'recepcao',
    idUsuarioOperador: operador.idOperador,
    observacoes: HOMOLOG_OBS,
    suites: [
      {
        idEventoSuite: plan.idEventoSuite,
        adultos: 2,
        criancas: 0,
        hospedes: [{ nome: 'Hospede Homolog Cancel 7.4', tipo: 'Adulto' }],
      },
    ],
    pagamento: null,
  });

  const idReserva = created.hospedagem.id;
  const reserva = await loadReservaDetail(connection, idReserva);
  const outbound = await loadOutboundRow(connection, idReserva);

  const validation = {
    status_Confirmada: reserva?.status === 'Confirmada',
    origem_ATENDENTE: String(reserva?.origem_reserva || '') === 'ATENDENTE',
    sem_id_externo: !reserva?.id_externo,
    sem_codigo_externo: !reserva?.codigo_externo,
    outbound_PENDING_CREATE: outbound?.outbound_status === 'PENDING_CREATE',
    desired_CREATE: outbound?.desired_action === 'CREATE',
    hospedin_reservation_id_null:
      outbound?.hospedin_reservation_id == null ||
      outbound?.hospedin_reservation_id === '',
    observacao_contem_homolog: String(reserva?.observacoes || '').includes(HOMOLOG_OBS),
  };

  log('NOVA_RESERVA', { id: idReserva, reserva, outbound });
  log('VALIDATION', validation);

  const allOk = Object.values(validation).every(Boolean);
  if (!allOk) {
    throw new Error('Validacao da reserva de homologacao falhou.');
  }

  console.log('');
  console.log('=== ETAPA 7.4 PREPARACAO: SUCESSO ===');
  console.log('RESERVA_HOMOLOG_ID', idReserva);
  console.log('Proximos passos (NAO executados nesta etapa): CREATE Hospedin, CANCEL Jango, CANCEL Hospedin');
}

main().catch((e) => {
  console.error('HOMOLOG_FATAL', e && e.stack ? e.stack : e);
  process.exit(1);
});
