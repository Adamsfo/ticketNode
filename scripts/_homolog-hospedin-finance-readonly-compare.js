/**
 * FASE 1 — Investigação financeira Hospedin (SOMENTE LEITURA).
 *
 * Compara duas reservas existentes na conta 69532:
 *   A) 29661017 — totais financeiros > 0 (fixture/import)
 *   B) 30416006 — probe CREATE com financeiro ignorado (zeros)
 *
 * Para cada reserva, executa GET em:
 *   - /reservations/{id}
 *   - /reservations/{id}/reservation_transactions
 *   - /reservations/{id}/sales
 *   - /reservations/{id}/rate_reservations
 *
 * Uso:
 *   cd ticket-node
 *   npm run build
 *   node scripts/_homolog-hospedin-finance-readonly-compare.js --execute
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const ACCOUNT_ID = '69532';

const RESERVATIONS = {
  A: {
    id: 29661017,
    label: 'RESERVA_A_FIXTURE_TOTAIS_POSITIVOS',
  },
  B: {
    id: 30416006,
    label: 'RESERVA_B_PROBE_FINANCEIRO_ZEROS',
  },
};

const NESTED_SUFFIXES = [
  { key: 'reservation', path: (id) => `/api/v2/${ACCOUNT_ID}/reservations/${id}` },
  {
    key: 'reservation_transactions',
    path: (id) => `/api/v2/${ACCOUNT_ID}/reservations/${id}/reservation_transactions`,
  },
  { key: 'sales', path: (id) => `/api/v2/${ACCOUNT_ID}/reservations/${id}/sales` },
  {
    key: 'rate_reservations',
    path: (id) => `/api/v2/${ACCOUNT_ID}/reservations/${id}/rate_reservations`,
  },
];

const FINANCE_FIELDS = [
  'daily_cents',
  'total_daily_cents',
  'total_amount',
  'total_product',
  'total_service',
  'total_received',
  'total_to_receive',
  'total_discount',
  'total_items',
  'report_total_daily',
];

const args = new Set(process.argv.slice(2));

function log(tag, data) {
  if (data === undefined) console.log(tag);
  else console.log(tag, JSON.stringify(data, null, 2));
}

function assertSafeEnvironment() {
  if (!args.has('--execute')) {
    console.error(
      'Modo seguro: use --execute para GET real no Hospedin.\n' +
        'Sem --execute o script apenas lista o plano e aborta.'
    );
    process.exit(1);
  }

  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error('Abortado: NODE_ENV=production.');
    process.exit(1);
  }
}

function asNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function countItems(body) {
  if (body == null) return { count: 0, shape: 'null' };
  if (Array.isArray(body)) return { count: body.length, shape: 'array' };
  if (typeof body === 'object') {
    if (Array.isArray(body.data)) return { count: body.data.length, shape: 'object.data[]' };
    if (Array.isArray(body.reservation_transactions)) {
      return {
        count: body.reservation_transactions.length,
        shape: 'object.reservation_transactions[]',
      };
    }
    if (Array.isArray(body.sales)) return { count: body.sales.length, shape: 'object.sales[]' };
    if (Array.isArray(body.rate_reservations)) {
      return { count: body.rate_reservations.length, shape: 'object.rate_reservations[]' };
    }
    if (body.id != null) return { count: 1, shape: 'object.single' };
    const arrayKeys = Object.keys(body).filter((k) => Array.isArray(body[k]));
    if (arrayKeys.length === 1) {
      return { count: body[arrayKeys[0]].length, shape: `object.${arrayKeys[0]}[]` };
    }
    return { count: 0, shape: 'object.unknown' };
  }
  return { count: 0, shape: typeof body };
}

function extractArray(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body.data)) return body.data;
  for (const key of [
    'reservation_transactions',
    'sales',
    'rate_reservations',
    'transactions',
    'items',
  ]) {
    if (Array.isArray(body[key])) return body[key];
  }
  return [];
}

function pickFinanceFields(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const field of FINANCE_FIELDS) {
    if (obj[field] != null) out[field] = obj[field];
  }
  return out;
}

function collectFinanceFromTree(value, prefix = '', acc = []) {
  if (value == null) return acc;
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectFinanceFromTree(item, `${prefix}[${i}]`, acc));
    return acc;
  }
  if (typeof value !== 'object') return acc;

  for (const field of FINANCE_FIELDS) {
    if (value[field] != null && asNumber(value[field]) !== 0) {
      acc.push({
        path: prefix ? `${prefix}.${field}` : field,
        field,
        value: value[field],
      });
    }
  }

  for (const [k, v] of Object.entries(value)) {
    if (v && typeof v === 'object') {
      const next = prefix ? `${prefix}.${k}` : k;
      collectFinanceFromTree(v, next, acc);
    }
  }
  return acc;
}

function summarizeApiFailure(error) {
  return {
    status: typeof error?.status === 'number' ? error.status : null,
    message: error?.message ? String(error.message) : String(error),
    body: error?.details != null ? error.details : null,
  };
}

async function fetchGet(client, url) {
  try {
    const body = await client.get(url);
    const { count, shape } = countItems(body);
    return {
      url,
      http_status: 200,
      item_count: count,
      response_shape: shape,
      response_body: body,
      error: null,
    };
  } catch (error) {
    const fail = summarizeApiFailure(error);
    const { count, shape } = countItems(fail.body);
    return {
      url,
      http_status: fail.status,
      item_count: count,
      response_shape: shape,
      response_body: fail.body,
      error: fail.message,
    };
  }
}

function buildReservationReport(reservationMeta, endpointResults) {
  const reservationGet = endpointResults.find((r) => r.key === 'reservation');
  const reservationBody =
    reservationGet?.response_body && typeof reservationGet.response_body === 'object'
      ? reservationGet.response_body
      : {};

  const financeOnReservation = pickFinanceFields(reservationBody);
  const nonZeroOnReservation = Object.fromEntries(
    Object.entries(financeOnReservation).filter(([, v]) => asNumber(v) !== 0)
  );

  const nestedSummary = endpointResults
    .filter((r) => r.key !== 'reservation')
    .map((r) => {
      const items = extractArray(r.response_body);
      const nonZeroFieldsInItems = [];
      for (let i = 0; i < items.length; i++) {
        const hits = collectFinanceFromTree(items[i], `[${i}]`);
        nonZeroFieldsInItems.push(...hits);
      }
      const allNonZeroInRaw = collectFinanceFromTree(r.response_body, r.key);
      return {
        endpoint: r.key,
        url: r.url,
        http_status: r.http_status,
        item_count: r.item_count,
        response_shape: r.response_shape,
        error: r.error,
        non_zero_finance_fields_in_items: nonZeroFieldsInItems,
        non_zero_finance_fields_anywhere: allNonZeroInRaw,
        items_sample: items.slice(0, 3),
      };
    });

  return {
    reservation_id: reservationMeta.id,
    label: reservationMeta.label,
    endpoints: endpointResults.map((r) => ({
      key: r.key,
      url: r.url,
      http_status: r.http_status,
      item_count: r.item_count,
      response_shape: r.response_shape,
      error: r.error,
      response_body: r.response_body,
    })),
    finance_on_reservation_get: financeOnReservation,
    non_zero_finance_on_reservation_get: nonZeroOnReservation,
    nested_summary: nestedSummary,
  };
}

function compareReports(reportA, reportB) {
  const endpointKeys = ['reservation', 'reservation_transactions', 'sales', 'rate_reservations'];
  const rows = endpointKeys.map((key) => {
    const a = reportA.endpoints.find((e) => e.key === key);
    const b = reportB.endpoints.find((e) => e.key === key);
    return {
      endpoint: key,
      A: {
        http_status: a?.http_status ?? null,
        item_count: a?.item_count ?? null,
      },
      B: {
        http_status: b?.http_status ?? null,
        item_count: b?.item_count ?? null,
      },
    };
  });

  return {
    reservation_ids: { A: reportA.reservation_id, B: reportB.reservation_id },
    endpoint_comparison: rows,
    non_zero_on_reservation_get: {
      A: reportA.non_zero_finance_on_reservation_get,
      B: reportB.non_zero_finance_on_reservation_get,
    },
    nested_non_zero_fields: {
      A: reportA.nested_summary.map((n) => ({
        endpoint: n.endpoint,
        http_status: n.http_status,
        item_count: n.item_count,
        non_zero_in_items: n.non_zero_finance_fields_in_items,
      })),
      B: reportB.nested_summary.map((n) => ({
        endpoint: n.endpoint,
        http_status: n.http_status,
        item_count: n.item_count,
        non_zero_in_items: n.non_zero_finance_fields_in_items,
      })),
    },
  };
}

async function main() {
  assertSafeEnvironment();

  const { getHospedinConfig } = require('../dist/integrations/hospedin/constants/config');
  const { hospedinAuthService } = require('../dist/integrations/hospedin/services/HospedinAuthService');
  const { hospedinApiClient } = require('../dist/integrations/hospedin/api/HospedinApiClient');

  const cfg = getHospedinConfig();

  log('PROBE_READONLY_META', {
    phase: 'FASE_1_FINANCEIRO_SOMENTE_GET',
    account_id: ACCOUNT_ID,
    api_url: cfg.apiUrl,
    reservations: RESERVATIONS,
    methods_allowed: ['GET'],
  });

  await hospedinAuthService.ensureAuthenticated();
  const accountId = await hospedinAuthService.ensureAccountId();
  if (String(accountId) !== ACCOUNT_ID) {
    log('WARN_ACCOUNT_ID', {
      expected: ACCOUNT_ID,
      resolved: accountId,
    });
  }

  const reports = {};

  for (const [slot, meta] of Object.entries(RESERVATIONS)) {
    log(`=== INICIO ${slot} reservation_id=${meta.id} ===`);
    const endpointResults = [];

    for (const spec of NESTED_SUFFIXES) {
      const url = spec.path(meta.id);
      const result = await fetchGet(hospedinApiClient, url);
      endpointResults.push({ key: spec.key, ...result });

      log(`${slot}_${spec.key}_GET`, {
        url: result.url,
        http_status: result.http_status,
        item_count: result.item_count,
        response_shape: result.response_shape,
        error: result.error,
      });
      log(`${slot}_${spec.key}_RESPONSE_BODY`, result.response_body);
    }

    reports[slot] = buildReservationReport(meta, endpointResults);
    log(`${slot}_SUMMARY`, {
      reservation_id: reports[slot].reservation_id,
      non_zero_finance_on_reservation_get: reports[slot].non_zero_finance_on_reservation_get,
      nested_summary: reports[slot].nested_summary.map((n) => ({
        endpoint: n.endpoint,
        http_status: n.http_status,
        item_count: n.item_count,
        non_zero_finance_fields_in_items: n.non_zero_finance_fields_in_items,
      })),
    });
    log(`=== FIM ${slot} ===`);
  }

  const comparison = compareReports(reports.A, reports.B);
  log('COMPARACAO_A_x_B', comparison);
  log('RELATORIO_FINAL_JSON', {
    captured_at: new Date().toISOString(),
    account_id: ACCOUNT_ID,
    reports,
    comparison,
  });
}

main().catch((error) => {
  if (error && error.stack) console.error(error.stack);
  else console.error('PROBE_READONLY_FATAL', error);
  process.exit(1);
});
