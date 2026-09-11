/**
 * Homologação isolada — PATCH API v2 com JSON completo exato (todos os campos).
 * Uso: node scripts/_homolog-hospedin-patch-full-json-probe.js --execute
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const PATCH_BODY = {
  id: 30417128,
  searchable_code: 'HO:001348',
  sale_channel_id: null,
  place_type_id: 117778,
  place_id: 445898,
  status: 'reservation',
  check_in: '2026-09-10T14:00:00.000-03:00',
  check_out: '2026-09-11T12:00:00.000-03:00',
  daily_cents: 5000,
  total_daily_cents: 5000,
  adults: 1,
  children: 0,
  exempt: 0,
  note: 'Reserva Jango #150',
  guest_id: 22709407,
  has_payment_coming_from_ota: false,
  license_plate: null,
  has_breakfast: false,
  total_product: 0,
  total_service: 50000,
  total_amount: 55000,
  total_to_receive: 55000,
  total_discount: 0,
  total_items: 50000,
  total_received: 0,
  report_total_daily: 5000,
};

const FIELDS = Object.keys(PATCH_BODY);
const MODE_EXECUTE = process.argv.includes('--execute');

async function main() {
  const { hospedinAuthService } = require('../dist/integrations/hospedin/services/HospedinAuthService');
  const { hospedinApiClient } = require('../dist/integrations/hospedin/api/HospedinApiClient');
  const { getHospedinConfig } = require('../dist/integrations/hospedin/constants/config');
  const cfg = getHospedinConfig();
  const path = '/api/v2/69532/reservations/30417128';

  await hospedinAuthService.ensureAuthenticated();

  const before = await hospedinApiClient.requestMeta('GET', path);

  console.log(
    JSON.stringify(
      {
        phase: MODE_EXECUTE ? 'execute' : 'dry-run',
        get_before: { http_status: before.status, body: before.data },
        patch_plan: {
          method: 'PATCH',
          url: `${cfg.apiUrl}${path}`,
          request_body_exact: PATCH_BODY,
        },
      },
      null,
      2
    )
  );

  if (!MODE_EXECUTE) {
    console.log(JSON.stringify({ abort: 'use --execute para enviar PATCH' }, null, 2));
    return;
  }

  const patch = await hospedinApiClient.requestMeta('PATCH', path, { data: PATCH_BODY });
  const after = await hospedinApiClient.requestMeta('GET', path);

  const compare = FIELDS.map((k) => ({
    field: k,
    sent: PATCH_BODY[k],
    before: before.data ? before.data[k] : undefined,
    after: after.data ? after.data[k] : undefined,
    persisted_matches_sent: after.data ? after.data[k] === PATCH_BODY[k] : false,
  }));

  console.log(
    JSON.stringify(
      {
        patch: {
          http_status: patch.status,
          success: patch.success,
          response_body: patch.data,
          error: patch.errorMessage || null,
        },
        get_after: { http_status: after.status, body: after.data },
        field_compare: compare,
        checks: {
          daily_cents_5000: after.data?.daily_cents === 5000,
          total_daily_cents_5000: after.data?.total_daily_cents === 5000,
          total_amount_55000: after.data?.total_amount === 55000,
          total_to_receive_55000: after.data?.total_to_receive === 55000,
          report_total_daily_5000: after.data?.report_total_daily === 5000,
          total_service_50000: after.data?.total_service === 50000,
          total_items_50000: after.data?.total_items === 50000,
        },
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
