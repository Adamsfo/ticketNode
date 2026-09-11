/**
 * Homologação isolada — POST /reservations com daily + daily_cents + total_daily_cents.
 *
 * Testa se o CREATE da API V2 aceita/persiste:
 *   - daily (campo do painel interno)
 *   - daily_cents / total_daily_cents (API v2 documentada)
 *
 * NÃO altera integração outbound, services, controllers, models ou banco.
 * NÃO faz PATCH, SALE, TRANSACTION ou DELETE após o POST.
 *
 * Uso:
 *   cd ticket-node
 *   npm run build
 *   node scripts/_homolog-hospedin-post-daily-probe.js
 *   node scripts/_homolog-hospedin-post-daily-probe.js --execute
 *
 * Variáveis (.env): HOSPEDIN_EMAIL, HOSPEDIN_PASSWORD (ou HOSPEDIN_TOKEN), HOSPEDIN_ACCOUNT_ID
 *
 * Opcionais:
 *   HOSPEDIN_PROBE_GUEST_ID=22709407
 *   HOSPEDIN_PROBE_PLACE_ID=445898
 *   HOSPEDIN_PROBE_PLACE_TYPE_ID=117778
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const DEFAULT_ACCOUNT_ID = '69532';
const DEFAULT_PLACE_ID = 445898;
const DEFAULT_PLACE_TYPE_ID = 117778;
const DEFAULT_GUEST_ID = 22709407;

const POST_BODY = {
  sale_channel_id: null,
  place_type_id: DEFAULT_PLACE_TYPE_ID,
  place_id: DEFAULT_PLACE_ID,
  status: 'reservation',
  check_in: '2027-10-20T14:00:00',
  check_out: '2027-10-22T12:00:00',
  daily: 422,
  daily_cents: 42200,
  total_daily_cents: 84400,
  adults: 1,
  children: 0,
  exempt: 0,
  note: 'TESTE DAILY JANGO',
  guest_id: DEFAULT_GUEST_ID,
  has_payment_coming_from_ota: false,
  license_plate: null,
  has_breakfast: false,
};

const SENT_FINANCE = {
  daily: POST_BODY.daily,
  daily_cents: POST_BODY.daily_cents,
  total_daily_cents: POST_BODY.total_daily_cents,
};

const GET_FINANCE_FIELDS = [
  'daily',
  'daily_cents',
  'total_daily_cents',
  'total_amount',
  'total_to_receive',
  'total_received',
  'report_total_daily',
  'total_product',
  'total_service',
  'total_items',
];

const args = new Set(process.argv.slice(2));
const MODE_EXECUTE = args.has('--execute');

function log(tag, data) {
  if (data === undefined) console.log(tag);
  else console.log(tag, JSON.stringify(data, null, 2));
}

function asNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseProbeBody() {
  const body = { ...POST_BODY };
  body.place_id = asNumber(process.env.HOSPEDIN_PROBE_PLACE_ID) || body.place_id;
  body.place_type_id =
    asNumber(process.env.HOSPEDIN_PROBE_PLACE_TYPE_ID) || body.place_type_id;
  body.guest_id = asNumber(process.env.HOSPEDIN_PROBE_GUEST_ID) || body.guest_id;
  return body;
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
  if (!reqStart || !reqEnd) {
    return { ok: false, reason: 'datas inválidas no payload' };
  }

  const conflicts = [];
  let page = 1;
  const maxPages = 30;
  const activeStatuses = new Set([
    'pre_reservation',
    'reservation',
    'waitlist',
    'check_in',
    'cleaning',
    'blocked',
  ]);

  while (page <= maxPages) {
    const meta = await client.requestMeta('GET', `/api/v2/${accountId}/reservations`, {
      params: { page, limit: 100 },
    });
    if (!meta.success) {
      return { ok: false, reason: `falha ao listar reservas page=${page}`, status: meta.status };
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
    if (rows.length === 0) break;
    const last =
      meta.data && typeof meta.data === 'object' ? meta.data.pagination?.last : undefined;
    if (typeof last === 'number' && page >= last) break;
    if (rows.length < 100) break;
    page += 1;
  }

  return {
    ok: conflicts.length === 0,
    reqStart,
    reqEnd,
    place_id: placeId,
    conflicts,
    pages_scanned: page,
  };
}

async function checkAvailability(client, accountId, placeTypeId, checkIn, checkOut) {
  const begin = dateOnly(checkIn);
  const end = dateOnly(checkOut);
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
    days: rows.length,
    min_availability: minAvailability,
    sample: rows.slice(0, 5),
  };
}

function pickFinance(body, fields) {
  const row = body && typeof body === 'object' ? body : {};
  const out = {};
  for (const f of fields) {
    out[f] = row[f] !== undefined ? row[f] : null;
  }
  return out;
}

function classifyField(field, sent, received) {
  const hasSent = sent !== undefined && sent !== null;
  if (!hasSent) {
    return { field, sent, received, accepted: null, persisted: null, note: 'não enviado' };
  }
  if (received === sent) {
    return { field, sent, received, accepted: true, persisted: true, note: 'igual ao enviado' };
  }
  if (received == null || received === 0) {
    return {
      field,
      sent,
      received,
      accepted: 'desconhecido',
      persisted: false,
      note: 'ausente ou zero no GET',
    };
  }
  return {
    field,
    sent,
    received,
    accepted: 'desconhecido',
    persisted: false,
    note: 'diverge do enviado',
  };
}

async function main() {
  const { getHospedinConfig } = require('../dist/integrations/hospedin/constants/config');
  const { hospedinAuthService } = require('../dist/integrations/hospedin/services/HospedinAuthService');
  const { hospedinApiClient } = require('../dist/integrations/hospedin/api/HospedinApiClient');

  const cfg = getHospedinConfig();
  const accountId =
    (process.env.HOSPEDIN_PROBE_ACCOUNT_ID || cfg.accountId || DEFAULT_ACCOUNT_ID).trim();
  const postBody = parseProbeBody();
  const postPath = `/api/v2/${accountId}/reservations`;
  const postUrl = `${cfg.apiUrl}${postPath}`;

  const sentFinance = {
    daily: postBody.daily,
    daily_cents: postBody.daily_cents,
    total_daily_cents: postBody.total_daily_cents,
  };

  log('PROBE_PLAN', {
    phase: 'HOMOLOG_POST_DAILY_AND_DAILY_CENTS',
    mode: MODE_EXECUTE ? 'execute' : 'dry-run',
    purpose:
      'Testar POST CREATE com daily (painel) + daily_cents + total_daily_cents simultaneamente',
    post_url: postUrl,
    post_path: postPath,
    post_body_exact: postBody,
    sent_finance: sentFinance,
    nights_hint: '2 diárias (20→22/out/2027); total_daily_cents=84400 = 42200 x 2',
    note_daily_not_in_swagger:
      'campo "daily" não consta em reservation_input no Swagger — incluído de propósito',
    does_not: ['PATCH', 'SALE', 'TRANSACTION', 'DELETE', 'outbound', 'banco'],
  });

  await hospedinAuthService.ensureAuthenticated();

  const conflict = await checkPlaceConflicts(
    hospedinApiClient,
    accountId,
    postBody.place_id,
    postBody.check_in,
    postBody.check_out
  );
  const availability = await checkAvailability(
    hospedinApiClient,
    accountId,
    postBody.place_type_id,
    postBody.check_in,
    postBody.check_out
  );

  log('PRECHECK_CONFLICT', conflict);
  log('PRECHECK_AVAILABILITY', availability);

  if (!MODE_EXECUTE) {
    log('PROBE_ABORT', {
      reason: 'dry-run — reexecute com --execute para criar reserva real',
      warning_if_conflicts: conflict.ok ? null : 'Há conflitos no place_id para o período',
    });
    return;
  }

  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error('Abortado: NODE_ENV=production.');
    process.exit(1);
  }

  if (!conflict.ok) {
    log('PROBE_ABORT', {
      reason: 'conflito de place_id no período — POST não executado',
      conflicts: conflict.conflicts,
    });
    process.exit(1);
  }

  const postMeta = await hospedinApiClient.requestMeta('POST', postPath, { data: postBody });

  log('POST_RESULT', {
    http_status: postMeta.status,
    success: postMeta.success,
    error: postMeta.errorMessage || null,
    response_body: postMeta.data,
  });

  if (!postMeta.success) {
    log('CONCLUSION', {
      post_failed: true,
      validation_error: postMeta.status === 422,
      http_status: postMeta.status,
    });
    process.exit(1);
  }

  const newId = asNumber(postMeta.data?.id);
  if (!newId) {
    log('PROBE_ABORT', { reason: 'POST 200 sem id na resposta' });
    process.exit(1);
  }

  const getMeta = await hospedinApiClient.requestMeta(
    'GET',
    `/api/v2/${accountId}/reservations/${newId}`
  );
  const salesMeta = await hospedinApiClient.requestMeta(
    'GET',
    `/api/v2/${accountId}/reservations/${newId}/sales`
  );
  const txMeta = await hospedinApiClient.requestMeta(
    'GET',
    `/api/v2/${accountId}/reservations/${newId}/reservation_transactions`
  );

  const postFinance = pickFinance(postMeta.data, GET_FINANCE_FIELDS);
  const getFinance = pickFinance(getMeta.data, GET_FINANCE_FIELDS);

  const classifications = [
    classifyField('daily', sentFinance.daily, getFinance.daily),
    classifyField('daily_cents', sentFinance.daily_cents, getFinance.daily_cents),
    classifyField(
      'total_daily_cents',
      sentFinance.total_daily_cents,
      getFinance.total_daily_cents
    ),
  ];

  log('GET_AFTER', {
    http_status: getMeta.status,
    reservation_id: newId,
    searchable_code: getMeta.data?.searchable_code ?? null,
    finance: getFinance,
    full_body: getMeta.data,
  });

  log('GET_NESTED', {
    sales: { http_status: salesMeta.status, data: salesMeta.data },
    reservation_transactions: { http_status: txMeta.status, data: txMeta.data },
  });

  log('FINANCE_SUMMARY', {
    ENVIADO: sentFinance,
    RESPOSTA_POST: postFinance,
    GET_DEPOIS: getFinance,
    classifications,
    answers: {
      post_aceitou_daily: postMeta.success,
      post_aceitou_daily_cents: postMeta.success,
      post_aceitou_total_daily_cents: postMeta.success,
      daily_persistido: getFinance.daily === sentFinance.daily,
      daily_cents_persistido: getFinance.daily_cents === sentFinance.daily_cents,
      total_daily_cents_persistido:
        getFinance.total_daily_cents === sentFinance.total_daily_cents,
      daily_cents_no_get: getFinance.daily_cents,
      total_daily_cents_no_get: getFinance.total_daily_cents,
      total_amount_no_get: getFinance.total_amount,
      daily_ignorado:
        sentFinance.daily != null &&
        (getFinance.daily === null || getFinance.daily !== sentFinance.daily),
      erro_validacao: false,
    },
    reservation_created: {
      id: newId,
      searchable_code: getMeta.data?.searchable_code ?? null,
      note: 'Reserva NÃO excluída automaticamente — analisar antes de limpar',
    },
  });
}

main().catch((error) => {
  if (error && error.stack) console.error(error.stack);
  else console.error('PROBE_FATAL', error);
  process.exit(1);
});
