/**
 * ETAPA 7.9 — Auditoria read-only filas homologação (sem alterações).
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const AUDIT_IDS = [124, 126, 127, 128, 129];

function log(tag, data) {
  if (data === undefined) console.log(tag);
  else console.log(tag, JSON.stringify(data, null, 2));
}

async function main() {
  const connection =
    require('../dist/database').default || require('../dist/database');
  await sleep(3000);

  const [scheduler] = await connection.query(
    `SELECT provider, enabled, interval_minutes, sync_limit, priority, max_retries,
            backoff_base_seconds, mode, updated_at
     FROM integration_provider_config
     WHERE provider IN ('HOSPEDIN', 'HOSPEDIN_OUTBOUND')
     ORDER BY provider`
  );

  const outboundRows = {};
  for (const id of AUDIT_IDS) {
    const [rows] = await connection.query(
      `SELECT o.*, rh.status AS jango_status, rh.origem_reserva, rh.id_externo,
              rh.codigo_externo, rh.observacoes, es.nome AS suite_nome
       FROM hospedin_outbound_sync_state o
       JOIN ReservaHospedagem rh ON rh.id = o.id_reserva_hospedagem
       LEFT JOIN ReservaSuite rs ON rs.id_reserva_hospedagem = rh.id
       LEFT JOIN EventoSuite es ON es.id = rs.id_evento_suite
       WHERE o.id_reserva_hospedagem = ?
       LIMIT 1`,
      { replacements: [id] }
    );
    outboundRows[id] = rows[0] || null;
  }

  const [dueSql] = await connection.query(
    `SELECT o.id_reserva_hospedagem, rh.status AS jango_status, rh.origem_reserva,
            rh.id_externo, o.outbound_status, o.desired_action,
            o.hospedin_reservation_id, o.dirty_at, o.last_error
     FROM hospedin_outbound_sync_state o
     JOIN ReservaHospedagem rh ON rh.id = o.id_reserva_hospedagem
     WHERE o.outbound_status IN ('PENDING_CREATE','PENDING_UPDATE','PENDING_CANCEL','WAIT_RETRY')
       AND (o.next_retry_at IS NULL OR o.next_retry_at <= UTC_TIMESTAMP())
     ORDER BY o.dirty_at ASC`
  );

  const [allOutbound] = await connection.query(
    `SELECT id_reserva_hospedagem, outbound_status, desired_action, hospedin_reservation_id
     FROM hospedin_outbound_sync_state
     ORDER BY id_reserva_hospedagem ASC`
  );

  const { hospedinOutboundStateService } = require('../dist/integrations/hospedin/outbound/HospedinOutboundStateService');
  const dueService = await hospedinOutboundStateService.listDue(200);

  log('SCHEDULER_CONFIG', scheduler);
  log('OUTBOUND_124_126_DETAIL', {
    '124': outboundRows[124],
    '126': outboundRows[126],
  });
  log('OUTBOUND_PROTECTED', {
    '127': outboundRows[127],
    '128': outboundRows[128],
    '129': outboundRows[129],
  });
  log('ALL_OUTBOUND_ROWS', allOutbound);
  log('DUE_SQL', dueSql);
  log('DUE_SERVICE', dueService.map((r) => ({
    id_reserva_hospedagem: r.id_reserva_hospedagem,
    outbound_status: r.outbound_status,
    desired_action: r.desired_action,
    hospedin_reservation_id: r.hospedin_reservation_id,
  })));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
