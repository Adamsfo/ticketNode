/**
 * FASE 1b — Encontrar reserva(s) com reservation_transactions ou sales não vazios.
 * SOMENTE GET. Conta 69532.
 *
 * Uso:
 *   cd ticket-node
 *   npm run build
 *   node scripts/_homolog-hospedin-finance-find-nested-readonly.js --execute
 *
 * Opcional:
 *   HOSPEDIN_PROBE_MAX_PAGES=30
 *   HOSPEDIN_PROBE_PAGE_SIZE=100
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const ACCOUNT_ID = '69532';

const args = new Set(process.argv.slice(2));

function log(tag, data) {
  if (data === undefined) console.log(tag);
  else console.log(tag, JSON.stringify(data, null, 2));
}

function assertSafeEnvironment() {
  if (!args.has('--execute')) {
    console.error('Use --execute para rodar GET real no Hospedin.');
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

function extractDataArray(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body.data)) return body.data;
  return [];
}

function getPaginationCount(body) {
  if (!body || typeof body !== 'object') return null;
  const c = asNumber(body.pagination?.count);
  return c != null ? c : null;
}

function summarizeApiFailure(error) {
  return {
    status: typeof error?.status === 'number' ? error.status : null,
    message: error?.message ? String(error.message) : String(error),
    body: error?.details != null ? error.details : null,
  };
}

async function safeGet(client, path) {
  try {
    const body = await client.get(path);
    return { http_status: 200, body, error: null };
  } catch (error) {
    const fail = summarizeApiFailure(error);
    return { http_status: fail.status, body: fail.body, error: fail.message };
  }
}

function collectKeysDeep(value, prefix = '', acc = new Set()) {
  if (value == null) return acc;
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectKeysDeep(item, `${prefix}[${i}]`, acc));
    return acc;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const p = prefix ? `${prefix}.${k}` : k;
      acc.add(p);
      if (v && typeof v === 'object') collectKeysDeep(v, p, acc);
    }
  }
  return acc;
}

function pickReservationFinance(row) {
  return {
    daily_cents: row?.daily_cents ?? null,
    total_daily_cents: row?.total_daily_cents ?? null,
    total_amount: row?.total_amount ?? null,
    total_received: row?.total_received ?? null,
    total_to_receive: row?.total_to_receive ?? null,
    total_product: row?.total_product ?? null,
    total_service: row?.total_service ?? null,
    sale_channel_id: row?.sale_channel_id ?? null,
  };
}

async function main() {
  assertSafeEnvironment();

  const { getHospedinConfig } = require('../dist/integrations/hospedin/constants/config');
  const { hospedinAuthService } = require('../dist/integrations/hospedin/services/HospedinAuthService');
  const { hospedinApiClient } = require('../dist/integrations/hospedin/api/HospedinApiClient');

  const cfg = getHospedinConfig();
  const maxPages = asNumber(process.env.HOSPEDIN_PROBE_MAX_PAGES) || 30;
  const pageSize = asNumber(process.env.HOSPEDIN_PROBE_PAGE_SIZE) || 100;

  log('FASE_1B_META', {
    account_id: ACCOUNT_ID,
    api_url: cfg.apiUrl,
    max_pages: maxPages,
    page_size: pageSize,
    methods: ['GET'],
  });

  await hospedinAuthService.ensureAuthenticated();
  await hospedinAuthService.ensureAccountId(ACCOUNT_ID);

  let reservationsScanned = 0;
  let pagesFetched = 0;
  const withTransactions = [];
  const withSales = [];
  const scanLog = [];

  for (let page = 1; page <= maxPages; page++) {
    const listPath = `/api/v2/${ACCOUNT_ID}/reservations`;
    let listBody;
    try {
      listBody = await hospedinApiClient.get(listPath, {
        params: { page, limit: pageSize },
      });
    } catch (error) {
      const fail = summarizeApiFailure(error);
      log('LIST_FATAL', { page, ...fail });
      break;
    }

    pagesFetched += 1;
    const rows = extractDataArray(listBody);
    if (rows.length === 0) {
      log('LIST_EMPTY_PAGE', { page });
      break;
    }

    log('LIST_PAGE', {
      page,
      rows_in_page: rows.length,
      pagination: listBody?.pagination ?? null,
    });

    for (const row of rows) {
      reservationsScanned += 1;
      const id = asNumber(row?.id);
      if (!id) continue;

      const needTx = withTransactions.length === 0;
      const needSales = withSales.length === 0;
      if (!needTx && !needSales) break;

      const txPath = `/api/v2/${ACCOUNT_ID}/reservations/${id}/reservation_transactions`;
      const salesPath = `/api/v2/${ACCOUNT_ID}/reservations/${id}/sales`;

      let txResult = null;
      let salesResult = null;

      if (needTx) {
        txResult = await safeGet(hospedinApiClient, txPath);
      }
      if (needSales) {
        salesResult = await safeGet(hospedinApiClient, salesPath);
      }

      const txItems = txResult ? extractDataArray(txResult.body) : [];
      const salesItems = salesResult ? extractDataArray(salesResult.body) : [];
      const txCount = getPaginationCount(txResult?.body) ?? txItems.length;
      const salesCount = getPaginationCount(salesResult?.body) ?? salesItems.length;

      const hitTx = needTx && txCount > 0;
      const hitSales = needSales && salesCount > 0;

      if (hitTx || hitSales) {
        const detailPath = `/api/v2/${ACCOUNT_ID}/reservations/${id}`;
        const detailResult = await safeGet(hospedinApiClient, detailPath);
        const detail = detailResult.body && typeof detailResult.body === 'object'
          ? detailResult.body
          : row;

        const record = {
          reservation_id: id,
          searchable_code: detail.searchable_code ?? row.searchable_code ?? null,
          status: detail.status ?? row.status ?? null,
          finance_on_reservation_get: pickReservationFinance(detail),
          list_row_finance: pickReservationFinance(row),
        };

        if (hitTx) {
          withTransactions.push({
            ...record,
            endpoint: 'reservation_transactions',
            url: txPath,
            http_status: txResult.http_status,
            item_count: txCount,
            response_body: txResult.body,
            items: txItems,
            item_field_paths: [...collectKeysDeep(txItems)].sort(),
          });
          log('HIT_RESERVATION_TRANSACTIONS', {
            reservation_id: id,
            searchable_code: record.searchable_code,
            item_count: txCount,
          });
        }

        if (hitSales) {
          withSales.push({
            ...record,
            endpoint: 'sales',
            url: salesPath,
            http_status: salesResult.http_status,
            item_count: salesCount,
            response_body: salesResult.body,
            items: salesItems,
            item_field_paths: [...collectKeysDeep(salesItems)].sort(),
          });
          log('HIT_SALES', {
            reservation_id: id,
            searchable_code: record.searchable_code,
            item_count: salesCount,
          });
        }
      } else if (reservationsScanned <= 5 || reservationsScanned % 50 === 0) {
        scanLog.push({
          reservation_id: id,
          searchable_code: row.searchable_code ?? null,
          tx_count: needTx ? txCount : 'skipped',
          sales_count: needSales ? salesCount : 'skipped',
        });
      }

      if (withTransactions.length > 0 && withSales.length > 0) {
        break;
      }
    }

    if (withTransactions.length > 0 && withSales.length > 0) {
      break;
    }

    const last = asNumber(listBody?.pagination?.last);
    if (last != null && page >= last) break;
    if (rows.length < pageSize) break;
  }

  const report = {
    captured_at: new Date().toISOString(),
    account_id: ACCOUNT_ID,
    pages_fetched: pagesFetched,
    reservations_scanned: reservationsScanned,
    max_pages_limit: maxPages,
    page_size: pageSize,
    found_with_reservation_transactions: withTransactions.length,
    found_with_sales: withSales.length,
    with_reservation_transactions: withTransactions,
    with_sales: withSales,
    sample_scan_log: scanLog,
    stopped_because:
      withTransactions.length > 0 && withSales.length > 0
        ? 'found_both_types'
        : withTransactions.length > 0 || withSales.length > 0
          ? 'found_one_type_max_pages_or_end_of_list'
          : 'exhausted_scan_without_hits',
  };

  log('RELATORIO_FINAL_FASE_1B', report);
}

main().catch((error) => {
  if (error && error.stack) console.error(error.stack);
  else console.error('FASE_1B_FATAL', error);
  process.exit(1);
});
