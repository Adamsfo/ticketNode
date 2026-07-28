/**
 * Sync completo via pipeline oficial (Import com guest enrich → Validate → Sync).
 * node scripts/_run-hospedin-sync-once.js
 *
 * Env: HOSPEDIN_SYNC_USER_ID, HOSPEDIN_SYNC_LIMIT=10, HOSPEDIN_SYNC_VALIDATE=20
 */
require('dotenv').config();
require('ts-node/register/transpile-only');

const LIMIT = Math.max(1, Number(process.env.HOSPEDIN_SYNC_LIMIT || 10));
const VALIDATE_N = Math.max(
  LIMIT,
  Number(process.env.HOSPEDIN_SYNC_VALIDATE || 20)
);

function isCancelled(status) {
  return /cancel|no_?show|void|deleted/i.test(String(status || ''));
}

(async () => {
  const connection =
    require('../src/database').default || require('../src/database');
  await new Promise((r) => setTimeout(r, 2000));

  let syncUserId = Number(process.env.HOSPEDIN_SYNC_USER_ID);
  if (!Number.isFinite(syncUserId) || syncUserId <= 0) {
    const [[row]] = await connection.query(
      'SELECT id FROM Usuario WHERE ativo = 1 ORDER BY id ASC LIMIT 1'
    );
    if (!row?.id) throw new Error('HOSPEDIN_SYNC_USER_ID / Usuario ausente');
    syncUserId = Number(row.id);
    process.env.HOSPEDIN_SYNC_USER_ID = String(syncUserId);
  }
  console.log('HOSPEDIN_SYNC_USER_ID', syncUserId);

  const {
    importHospedinReservations,
  } = require('../src/integrations/hospedin/services/HospedinImportReservationService');
  const { HospedinReservation } = require('../src/models/HospedinReservation');
  const {
    hospedinReservationValidationService,
  } = require('../src/integrations/hospedin/services/HospedinReservationValidationService');
  const {
    reservationSyncRunner,
  } = require('../src/integrations/hospedin/sync/ReservationSyncRunner');
  const {
    payloadHasNamedGuests,
  } = require('../src/integrations/hospedin/services/HospedinGuestService');

  console.log('--- IMPORT oficial (lista + guest enrich com detalhe se preciso) ---');
  const importResult = await importHospedinReservations({ fetchDetails: false });
  console.log(JSON.stringify(importResult, null, 2));

  const staging = await HospedinReservation.findAll({
    order: [['reservation_id', 'DESC']],
    limit: 80,
  });

  let withGuests = 0;
  const candidates = [];
  for (const row of staging) {
    const payload = row.payload_json || {};
    if (payloadHasNamedGuests(payload)) withGuests += 1;
    if (candidates.length >= VALIDATE_N) continue;
    if (isCancelled(row.status)) continue;
    // Prefer future check-ins for CREATE success
    const ci = row.checkin ? new Date(row.checkin).getTime() : 0;
    if (ci < Date.now() - 86400000) continue;
    candidates.push(Number(row.reservation_id));
  }
  // fallback: any active
  if (candidates.length < LIMIT) {
    for (const row of staging) {
      if (candidates.length >= VALIDATE_N) break;
      if (isCancelled(row.status)) continue;
      const id = Number(row.reservation_id);
      if (!candidates.includes(id)) candidates.push(id);
    }
  }

  console.log('staging com hóspedes nomeados (amostra 80):', withGuests);
  console.log('validate candidates:', candidates);

  console.log('--- VALIDATE ---');
  for (const reservationId of candidates) {
    const v =
      await hospedinReservationValidationService.validateReservation(
        reservationId
      );
    console.log(
      `validate ${reservationId}: ready=${v.ready} status=${v.status}`
    );
  }

  console.log('--- SYNC limit=' + LIMIT + ' ---');
  const sync = await reservationSyncRunner.processReady({ limit: LIMIT });
  console.log(JSON.stringify(sync, null, 2));

  const ok = (sync.results || []).filter((r) => r.ok);
  const fail = (sync.results || []).filter((r) => !r.ok);
  console.log('--- RESUMO ---');
  console.log(JSON.stringify({ ok: ok.length, fail: fail.length, ok, fail }, null, 2));

  process.exit(0);
})().catch((e) => {
  console.error('SYNC_ONCE_FAIL', e?.message || e);
  process.exit(1);
});
