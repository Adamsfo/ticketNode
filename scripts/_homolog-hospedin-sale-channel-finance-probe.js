/**
 * Homologação isolada — CREATE com sale_channel_id + daily_cents + total_daily_cents.
 *
 * Testa se sale_channel_id preenchido permite persistir diária financeira no POST /reservations.
 * NÃO usa SALE. Um único POST de reserva (+ POST /guests se necessário).
 *
 * Uso:
 *   cd ticket-node
 *   npm run build
 *   node scripts/_homolog-hospedin-sale-channel-finance-probe.js --execute
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const { formatInTimeZone } = require('date-fns-tz');

const ACCOUNT_ID = '69532';
const TZ = 'America/Cuiaba';

const CHECK_IN_DATE = '2026-09-10';
const CHECK_OUT_DATE = '2026-09-11';
const CHECK_IN = `${CHECK_IN_DATE}T14:00`;
const CHECK_OUT = `${CHECK_OUT_DATE}T12:00`;

const SALE_CHANNEL_ID = 154837;
const DAILY_CENTS = 40000;
const TOTAL_DAILY_CENTS = 40000;

const NOTE = 'HOMOLOG SALE_CHANNEL FINANCE TEST - JANGO';

/** Candidatos conhecidos na conta 69532 (homologs anteriores). */
const PLACE_CANDIDATES = [
  { place_id: 445906, place_type_id: 131939 },
  { place_id: 445907, place_type_id: 131939 },
  { place_id: 445904, place_type_id: 131939 },
  { place_id: 445905, place_type_id: 131939 },
  { place_id: 445900, place_type_id: 117778 },
  { place_id: 445901, place_type_id: 117778 },
  { place_id: 445899, place_type_id: 117778 },
  { place_id: 445902, place_type_id: 131938 },
  { place_id: 445903, place_type_id: 131938 },
  { place_id: 503749, place_type_id: 131938 },
];

const PREVIOUS_TEST = {
  label: 'create-finance-probe (sale_channel_id=null, 2 diárias)',
  sale_channel_id: null,
  daily_cents_sent: 40000,
  total_daily_cents_sent: 80000,
  nights: 2,
  result: 'valores financeiros ignorados no GET',
};

const MODE_EXECUTE = process.argv.includes('--execute');

function log(tag, data) {
  if (data === undefined) console.log(tag);
  else console.log(tag, JSON.stringify(data, null, 2));
}

function asNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateOnly(isoLike) {
  if (!isoLike) return null;
  const s = String(isoLike);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function extractDataArray(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body.data)) return body.data;
  return [];
}

async function checkPlaceConflicts(client, accountId, placeId, checkIn, checkOut) {
  const reqStart = dateOnly(checkIn);
  const reqEnd = dateOnly(checkOut);
  const conflicts = [];
  let page = 1;
  const activeStatuses = new Set([
    'pre_reservation',
    'reservation',
    'waitlist',
    'check_in',
    'cleaning',
    'blocked',
  ]);

  while (page <= 20) {
    const meta = await client.requestMeta('GET', `/api/v2/${accountId}/reservations`, {
      params: { page, limit: 100 },
    });
    if (!meta.success) {
      return { ok: false, conflicts, error: meta.errorMessage, status: meta.status };
    }
    const rows = extractDataArray(meta.data);
    for (const row of rows) {
      if (asNumber(row.place_id) !== placeId) continue;
      if (!activeStatuses.has(String(row.status || ''))) continue;
      const rowStart = dateOnly(row.check_in);
      const rowEnd = dateOnly(row.check_out);
      if (!rowStart || !rowEnd) continue;
      if (rangesOverlap(reqStart, reqEnd, rowStart, rowEnd)) {
        conflicts.push({
          id: row.id,
          searchable_code: row.searchable_code,
          status: row.status,
          check_in: row.check_in,
          check_out: row.check_out,
        });
      }
    }
    const last = meta.data?.pagination?.last;
    if (typeof last === 'number' && page >= last) break;
    if (rows.length < 100) break;
    page += 1;
  }

  return { ok: conflicts.length === 0, conflicts };
}

async function checkAvailability(client, accountId, placeTypeId, begin, end) {
  const path =
    `/api/v2/${accountId}/place_types/${placeTypeId}/rates_and_availabilities` +
    `?begin_date=${begin}&end_date=${end}`;
  const meta = await client.requestMeta('GET', path);
  if (!meta.success) {
    return { ok: false, http_status: meta.status, error: meta.errorMessage, data: meta.data };
  }
  const rows = Array.isArray(meta.data) ? meta.data : [];
  const minAvailability = rows.length
    ? rows.reduce((min, r) => Math.min(min, asNumber(r.availability) ?? 0), Infinity)
    : null;
  return {
    ok: true,
    http_status: meta.status,
    begin_date: begin,
    end_date: end,
    days: rows.length,
    min_availability: minAvailability,
    rows,
  };
}

async function pickAvailablePlace(client, accountId) {
  const checked = [];
  for (const candidate of PLACE_CANDIDATES) {
    const conflict = await checkPlaceConflicts(
      client,
      accountId,
      candidate.place_id,
      CHECK_IN,
      CHECK_OUT
    );
    const availability = await checkAvailability(
      client,
      accountId,
      candidate.place_type_id,
      CHECK_IN_DATE,
      CHECK_OUT_DATE
    );
    const entry = {
      ...candidate,
      conflict_ok: conflict.ok,
      conflicts: conflict.conflicts,
      availability,
    };
    checked.push(entry);
    if (conflict.ok) {
      return { selected: candidate, checked };
    }
  }
  return { selected: null, checked };
}

async function createGuest(client, accountId) {
  const fromEnv = asNumber(process.env.HOSPEDIN_PROBE_GUEST_ID);
  if (fromEnv != null && fromEnv > 0) {
    return { guestId: fromEnv, created: false };
  }
  const guestBody = {
    name: `HOMOLOG SALE_CHANNEL FINANCE ${new Date().toISOString()}`,
  };
  const guestResponse = await client.post(
    `/api/v2/${encodeURIComponent(accountId)}/guests`,
    guestBody
  );
  const guestId = asNumber(guestResponse?.id);
  if (!guestId) {
    throw new Error('POST /guests não retornou id válido');
  }
  return { guestId, created: true, guestBody, guestResponse };
}

function pickFinance(body) {
  return {
    sale_channel_id: body?.sale_channel_id ?? null,
    daily_cents: asNumber(body?.daily_cents),
    total_daily_cents: asNumber(body?.total_daily_cents),
    total_amount: asNumber(body?.total_amount),
    total_to_receive: asNumber(body?.total_to_receive),
    total_received: asNumber(body?.total_received),
    total_service: asNumber(body?.total_service),
    total_product: asNumber(body?.total_product),
    total_items: asNumber(body?.total_items),
    total_discount: asNumber(body?.total_discount),
    report_total_daily: asNumber(body?.report_total_daily),
  };
}

function answerBool(sent, received) {
  if (received === sent) return 'SIM';
  if (received == null || received === 0) return 'NÃO';
  return `NÃO (recebido=${received})`;
}

async function main() {
  const { getHospedinConfig } = require('../dist/integrations/hospedin/constants/config');
  const { hospedinAuthService } = require('../dist/integrations/hospedin/services/HospedinAuthService');
  const { hospedinApiClient } = require('../dist/integrations/hospedin/api/HospedinApiClient');
  const cfg = getHospedinConfig();

  log('PROBE_META', {
    phase: 'HOMOLOG_SALE_CHANNEL_FINANCE_CREATE',
    mode: MODE_EXECUTE ? 'execute' : 'dry-run',
    account_id: ACCOUNT_ID,
    check_in: CHECK_IN,
    check_out: CHECK_OUT,
    nights: 1,
    sale_channel_id: SALE_CHANNEL_ID,
    daily_cents: DAILY_CENTS,
    total_daily_cents: TOTAL_DAILY_CENTS,
    previous_test_reference: PREVIOUS_TEST,
    does_not: ['PATCH', 'SALE', 'DELETE', 'outbound', 'banco', 'total_amount no body'],
  });

  await hospedinAuthService.ensureAuthenticated();

  const placePick = await pickAvailablePlace(hospedinApiClient, ACCOUNT_ID);
  log('PRECHECK_PLACE_SCAN', placePick.checked);
  log('PRECHECK_SELECTED_PLACE', placePick.selected);

  if (!placePick.selected) {
    log('PROBE_ABORT', { reason: 'nenhum place_id disponível sem conflito no período' });
    process.exit(1);
  }

  const guestInfo = MODE_EXECUTE
    ? await createGuest(hospedinApiClient, ACCOUNT_ID)
    : { guestId: asNumber(process.env.HOSPEDIN_PROBE_GUEST_ID) || 0, created: false };

  const postBody = {
    place_id: placePick.selected.place_id,
    place_type_id: placePick.selected.place_type_id,
    status: 'reservation',
    check_in: CHECK_IN,
    check_out: CHECK_OUT,
    adults: 1,
    children: 0,
    exempt: 0,
    note: NOTE,
    guest_id: guestInfo.guestId || 0,
    has_payment_coming_from_ota: false,
    has_breakfast: false,
    sale_channel_id: SALE_CHANNEL_ID,
    daily_cents: DAILY_CENTS,
    total_daily_cents: TOTAL_DAILY_CENTS,
  };

  log('POST_BODY_EXACT', postBody);

  if (!MODE_EXECUTE) {
    log('PROBE_ABORT', { reason: 'dry-run — use --execute para POST real' });
    return;
  }

  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error('Abortado: NODE_ENV=production');
    process.exit(1);
  }

  if (!guestInfo.guestId) {
    log('PROBE_ABORT', { reason: 'guest_id ausente' });
    process.exit(1);
  }
  postBody.guest_id = guestInfo.guestId;

  const postPath = `/api/v2/${ACCOUNT_ID}/reservations`;
  const postMeta = await hospedinApiClient.requestMeta('POST', postPath, { data: postBody });

  log('POST_RESULT', {
    http_status: postMeta.status,
    success: postMeta.success,
    request_body: postBody,
    response_body: postMeta.data,
    error: postMeta.errorMessage || null,
    guest: guestInfo,
  });

  const reservationId = asNumber(postMeta.data?.id);
  if (!postMeta.success || !reservationId) {
    log('PROBE_ABORT', { reason: 'POST falhou — sem GET posterior' });
    process.exit(1);
  }

  const getMeta = await hospedinApiClient.requestMeta(
    'GET',
    `/api/v2/${ACCOUNT_ID}/reservations/${reservationId}`
  );

  const getFinance = pickFinance(getMeta.data);

  log('GET_AFTER_POST', {
    http_status: getMeta.status,
    reservation_id: reservationId,
    searchable_code: getMeta.data?.searchable_code ?? null,
    finance: getFinance,
    full_body: getMeta.data,
  });

  log('ANSWERS', {
    q1_sale_channel_id_154837_persisted: answerBool(SALE_CHANNEL_ID, getFinance.sale_channel_id),
    q2_daily_cents_40000_persisted: answerBool(DAILY_CENTS, getFinance.daily_cents),
    q3_total_daily_cents_40000_persisted: answerBool(
      TOTAL_DAILY_CENTS,
      getFinance.total_daily_cents
    ),
    q4_total_amount_calculated: getFinance.total_amount === TOTAL_DAILY_CENTS
      ? 'SIM (40000)'
      : `NÃO ou diferente (recebido=${getFinance.total_amount})`,
    q5_total_to_receive_calculated: getFinance.total_to_receive === TOTAL_DAILY_CENTS
      ? 'SIM (40000)'
      : `recebido=${getFinance.total_to_receive}`,
    q6_report_total_daily_filled: getFinance.report_total_daily === TOTAL_DAILY_CENTS
      ? 'SIM (40000)'
      : `recebido=${getFinance.report_total_daily}`,
    q7_total_service_zero: getFinance.total_service === 0 ? 'SIM' : `recebido=${getFinance.total_service}`,
    q8_different_from_previous_null_channel_test:
      getFinance.daily_cents === DAILY_CENTS && getFinance.total_daily_cents === TOTAL_DAILY_CENTS
        ? 'SIM — financeiro persistiu (teste anterior ignorou)'
        : 'NÃO — mesmo comportamento de ignorar (ou parcial)',
  });

  log('COMPARISON_PREVIOUS_TEST', {
    previous: PREVIOUS_TEST,
    current_sent: {
      sale_channel_id: SALE_CHANNEL_ID,
      daily_cents: DAILY_CENTS,
      total_daily_cents: TOTAL_DAILY_CENTS,
      nights: 1,
    },
    current_get: getFinance,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
