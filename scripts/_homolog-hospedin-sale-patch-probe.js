/**
 * Homologação isolada — PATCH de SALE existente (alterar price_cents).
 *
 * Uso:
 *   cd ticket-node
 *   npm run build
 *   node scripts/_homolog-hospedin-sale-patch-probe.js
 *   node scripts/_homolog-hospedin-sale-patch-probe.js --execute
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const ACCOUNT_ID = '69532';
const RESERVATION_ID = 30417128;
const SALE_ID = 24449566;
const NEW_PRICE_CENTS = 10000;

const MODE_EXECUTE = process.argv.includes('--execute');

function log(tag, data) {
  if (data === undefined) console.log(tag);
  else console.log(tag, JSON.stringify(data, null, 2));
}

function extractSales(body) {
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body)) return body;
  return [];
}

function findSale(sales, saleId) {
  return sales.find((s) => Number(s?.id) === Number(saleId)) || null;
}

function pickSaleFields(sale) {
  if (!sale) return null;
  return {
    id: sale.id,
    item_id: sale.item_id,
    selling_point_id: sale.selling_point_id,
    quantity: sale.quantity,
    price_cents: sale.price_cents,
    note: sale.note ?? null,
  };
}

function pickReservationFinance(body) {
  if (!body || typeof body !== 'object') return null;
  return {
    daily_cents: body.daily_cents,
    total_daily_cents: body.total_daily_cents,
    total_amount: body.total_amount,
    total_to_receive: body.total_to_receive,
    total_service: body.total_service,
    total_items: body.total_items,
    total_received: body.total_received,
    total_discount: body.total_discount,
    report_total_daily: body.report_total_daily,
  };
}

function buildPatchBodyFromSale(sale, newPriceCents) {
  const patch = {
    item_id: sale.item_id,
    selling_point_id: sale.selling_point_id,
    quantity: sale.quantity,
    price_cents: newPriceCents,
  };
  if (sale.note !== undefined && sale.note !== null) {
    patch.note = sale.note;
  }
  return patch;
}

async function main() {
  const { hospedinAuthService } = require('../dist/integrations/hospedin/services/HospedinAuthService');
  const { hospedinApiClient } = require('../dist/integrations/hospedin/api/HospedinApiClient');
  const { getHospedinConfig } = require('../dist/integrations/hospedin/constants/config');
  const cfg = getHospedinConfig();

  await hospedinAuthService.ensureAuthenticated();

  const resPath = `/api/v2/${ACCOUNT_ID}/reservations/${RESERVATION_ID}`;
  const salesListPath = `/api/v2/${ACCOUNT_ID}/reservations/${RESERVATION_ID}/sales`;
  const salePath = `/api/v2/${ACCOUNT_ID}/reservations/${RESERVATION_ID}/sales/${SALE_ID}`;

  const getResBefore = await hospedinApiClient.requestMeta('GET', resPath);
  const getSalesBefore = await hospedinApiClient.requestMeta('GET', salesListPath);
  const salesBefore = extractSales(getSalesBefore.data);
  const saleBefore = findSale(salesBefore, SALE_ID);

  const getSaleDetailBefore = await hospedinApiClient.requestMeta('GET', salePath);

  const plan = {
    mode: MODE_EXECUTE ? 'execute' : 'dry-run',
    reservation: {
      id: RESERVATION_ID,
      searchable_code: 'HO:001348',
    },
    sale_target: {
      sale_id: SALE_ID,
      new_price_cents: NEW_PRICE_CENTS,
    },
    get_reservation_before: {
      http_status: getResBefore.status,
      body: getResBefore.data,
      finance: pickReservationFinance(getResBefore.data),
    },
    get_sales_list_before: {
      http_status: getSalesBefore.status,
      body: getSalesBefore.data,
      sale_found: Boolean(saleBefore),
      sale_summary: pickSaleFields(saleBefore),
    },
    get_sale_detail_before: {
      http_status: getSaleDetailBefore.status,
      body: getSaleDetailBefore.data,
      sale_summary: pickSaleFields(getSaleDetailBefore.data),
    },
    patch_plan: saleBefore
      ? {
          method: 'PATCH',
          url: `${cfg.apiUrl}${salePath}`,
          request_body: buildPatchBodyFromSale(saleBefore, NEW_PRICE_CENTS),
          fields_changed: ['price_cents'],
          fields_unchanged: ['item_id', 'selling_point_id', 'quantity', 'note'],
        }
      : { error: 'SALE não encontrada na listagem — PATCH não será montado' },
  };

  log('PROBE_PLAN', plan);

  if (!MODE_EXECUTE) {
    log('PROBE_ABORT', { reason: 'dry-run — use --execute para PATCH real' });
    return;
  }

  if (!saleBefore) {
    log('PROBE_ABORT', { reason: `sale_id ${SALE_ID} não encontrada em GET /sales` });
    process.exit(1);
  }

  const patchBody = buildPatchBodyFromSale(saleBefore, NEW_PRICE_CENTS);
  const patchMeta = await hospedinApiClient.requestMeta('PATCH', salePath, {
    data: patchBody,
  });

  const getSaleAfter = await hospedinApiClient.requestMeta('GET', salePath);
  const getSalesAfter = await hospedinApiClient.requestMeta('GET', salesListPath);
  const getResAfter = await hospedinApiClient.requestMeta('GET', resPath);

  const saleAfter =
    getSaleAfter.data && typeof getSaleAfter.data === 'object'
      ? getSaleAfter.data
      : findSale(extractSales(getSalesAfter.data), SALE_ID);

  const resFinanceBefore = pickReservationFinance(getResBefore.data);
  const resFinanceAfter = pickReservationFinance(getResAfter.data);

  const financeCompare = {};
  for (const key of Object.keys(resFinanceBefore || {})) {
    financeCompare[key] = {
      before: resFinanceBefore[key],
      after: resFinanceAfter[key],
      changed: resFinanceBefore[key] !== resFinanceAfter[key],
    };
  }

  log('PROBE_RESULT', {
    patch: {
      http_status: patchMeta.status,
      success: patchMeta.success,
      request_body_exact: patchBody,
      response_body: patchMeta.data,
      error: patchMeta.errorMessage || null,
    },
    sale_before: pickSaleFields(saleBefore),
    sale_after: pickSaleFields(saleAfter),
    sale_compare: {
      id: { before: saleBefore?.id, after: saleAfter?.id },
      item_id: { before: saleBefore?.item_id, after: saleAfter?.item_id },
      selling_point_id: {
        before: saleBefore?.selling_point_id,
        after: saleAfter?.selling_point_id,
      },
      quantity: { before: saleBefore?.quantity, after: saleAfter?.quantity },
      price_cents: { before: saleBefore?.price_cents, after: saleAfter?.price_cents },
      note: { before: saleBefore?.note ?? null, after: saleAfter?.note ?? null },
    },
    reservation_finance_before: resFinanceBefore,
    reservation_finance_after: resFinanceAfter,
    reservation_finance_compare: financeCompare,
    checks: {
      patch_http_success: patchMeta.success,
      sale_price_cents_10000: saleAfter?.price_cents === NEW_PRICE_CENTS,
      total_service_70000_to_30000:
        resFinanceBefore?.total_service === 70000 &&
        resFinanceAfter?.total_service === 30000,
      total_amount_70000_to_30000:
        resFinanceBefore?.total_amount === 70000 &&
        resFinanceAfter?.total_amount === 30000,
      total_to_receive_recalculated:
        resFinanceBefore?.total_to_receive !== resFinanceAfter?.total_to_receive,
      total_items_recalculated:
        resFinanceBefore?.total_items !== resFinanceAfter?.total_items,
      daily_cents_unchanged:
        resFinanceBefore?.daily_cents === resFinanceAfter?.daily_cents,
    },
    conclusion: patchMeta.success
      ? saleAfter?.price_cents === NEW_PRICE_CENTS
        ? 'PATCH SALE aceito e price_cents persistido — verificar recálculo da reserva'
        : 'PATCH retornou sucesso mas price_cents não persistiu no GET'
      : 'PATCH SALE falhou — ver http_status e response_body',
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
