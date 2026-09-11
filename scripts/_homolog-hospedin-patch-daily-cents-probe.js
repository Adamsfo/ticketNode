/**
 * Homologação isolada — PATCH oficial API V2: daily_cents / total_daily_cents.
 *
 * Verifica se PATCH /api/v2/{account_id}/reservations/{id} aceita e persiste
 * campos financeiros de diária em reserva existente.
 *
 * NÃO altera integração outbound, services, controllers, models ou banco.
 * NÃO usa endpoint interno /services/reservations do painel.
 * NÃO testa rate_reservations.
 *
 * Fluxo:
 *   1. GET baseline
 *   2. PATCH { daily_cents, total_daily_cents } (somente se --execute)
 *   3. GET comparativo
 *
 * Uso:
 *   cd ticket-node
 *   npm run build
 *   node scripts/_homolog-hospedin-patch-daily-cents-probe.js          # dry-run
 *   node scripts/_homolog-hospedin-patch-daily-cents-probe.js --execute
 *
 * Variáveis (.env):
 *   HOSPEDIN_API_URL, HOSPEDIN_EMAIL, HOSPEDIN_PASSWORD (ou HOSPEDIN_TOKEN)
 *   HOSPEDIN_ACCOUNT_ID=69532
 *
 * Opcionais:
 *   HOSPEDIN_PROBE_RESERVATION_ID=30416006
 *   HOSPEDIN_PROBE_DAILY_CENTS=40100
 *   HOSPEDIN_PROBE_TOTAL_DAILY_CENTS=80200
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const DEFAULT_ACCOUNT_ID = '69532';
const DEFAULT_RESERVATION_ID = 30416006;
const DEFAULT_DAILY_CENTS = 40100;
const DEFAULT_TOTAL_DAILY_CENTS = 80200;

const FINANCE_COMPARE_FIELDS = [
  'daily_cents',
  'total_daily_cents',
  'total_amount',
  'total_to_receive',
  'total_received',
  'report_total_daily',
];

const args = new Set(process.argv.slice(2));
const MODE_EXECUTE = args.has('--execute');

function log(tag, data) {
  if (data === undefined) console.log(tag);
  else console.log(tag, JSON.stringify(data, null, 2));
}

function assertSafeEnvironment() {
  if (!MODE_EXECUTE) {
    console.error(
      'Modo seguro: use --execute para enviar PATCH real ao Hospedin.\n' +
        'Sem --execute o script apenas exibe o plano e aborta.'
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

function maskToken(token) {
  if (!token || typeof token !== 'string') return null;
  const t = token.trim();
  if (t.length <= 12) return '***';
  return `${t.slice(0, 6)}...${t.slice(-4)}`;
}

function sanitizeResponse(body) {
  if (body == null) return body;
  if (typeof body !== 'object') return body;
  try {
    const clone = JSON.parse(JSON.stringify(body));
    if (clone.token) clone.token = maskToken(clone.token);
    return clone;
  } catch {
    return '[unserializable response]';
  }
}

function pickFinanceFields(body) {
  const row = body && typeof body === 'object' ? body : {};
  const out = {};
  for (const field of FINANCE_COMPARE_FIELDS) {
    out[field] = asNumber(row[field]);
  }
  return out;
}

function compareFinance(before, after, patchSent) {
  const rows = FINANCE_COMPARE_FIELDS.map((field) => ({
    field,
    before: before[field],
    after: after[field],
    changed: before[field] !== after[field],
    patch_sent:
      field === 'daily_cents'
        ? patchSent.daily_cents
        : field === 'total_daily_cents'
          ? patchSent.total_daily_cents
          : null,
    matches_patch_sent:
      field === 'daily_cents'
        ? after[field] === patchSent.daily_cents
        : field === 'total_daily_cents'
          ? after[field] === patchSent.total_daily_cents
          : null,
  }));
  return rows;
}

async function getReservation(client, accountId, reservationId) {
  const path = `/api/v2/${accountId}/reservations/${reservationId}`;
  const meta = await client.requestMeta('GET', path);
  const body =
    meta.data && typeof meta.data === 'object' ? meta.data : null;
  const foundId = body ? asNumber(body.id) : null;

  return {
    path,
    url: meta.url,
    http_status: meta.status,
    success: meta.success,
    error: meta.errorMessage || null,
    reservation_found: foundId === reservationId,
    finance: pickFinanceFields(body),
    response_body: meta.data,
  };
}

async function main() {
  const { getHospedinConfig } = require('../dist/integrations/hospedin/constants/config');
  const { hospedinAuthService } = require('../dist/integrations/hospedin/services/HospedinAuthService');
  const { hospedinApiClient } = require('../dist/integrations/hospedin/api/HospedinApiClient');

  const cfg = getHospedinConfig();
  const accountId =
    (process.env.HOSPEDIN_PROBE_ACCOUNT_ID || cfg.accountId || DEFAULT_ACCOUNT_ID).trim();
  const reservationId =
    asNumber(process.env.HOSPEDIN_PROBE_RESERVATION_ID) || DEFAULT_RESERVATION_ID;
  const patchBody = {
    daily_cents:
      asNumber(process.env.HOSPEDIN_PROBE_DAILY_CENTS) || DEFAULT_DAILY_CENTS,
    total_daily_cents:
      asNumber(process.env.HOSPEDIN_PROBE_TOTAL_DAILY_CENTS) || DEFAULT_TOTAL_DAILY_CENTS,
  };

  const patchPath = `/api/v2/${accountId}/reservations/${reservationId}`;
  const patchUrl = `${cfg.apiUrl}${patchPath}`;

  const plan = {
    phase: 'HOMOLOG_PATCH_DAILY_CENTS_API_V2',
    mode: MODE_EXECUTE ? 'execute' : 'dry-run',
    authentication: {
      type: 'Bearer JWT (API v2 login)',
      mechanism: 'HospedinAuthService.ensureAuthenticated()',
      no_internal_panel_endpoint: true,
    },
    reservation_id: reservationId,
    account_id: accountId,
    expected_stay: {
      check_in: '2027-10-15',
      check_out: '2027-10-17',
      nights: 2,
      note: '2 diárias — total_daily_cents enviado = 80200 (40100 x 2)',
    },
    steps: [
      `GET ${patchPath}`,
      `PATCH ${patchPath} body=${JSON.stringify(patchBody)}`,
      `GET ${patchPath} (comparativo)`,
    ],
    patch_body: patchBody,
    excluded_from_patch: ['total_amount'],
    not_tested: ['rate_reservations', '/services/reservations'],
    compare_fields: FINANCE_COMPARE_FIELDS,
  };

  log('PROBE_PLAN', plan);

  if (!MODE_EXECUTE) {
    log('PROBE_ABORT', {
      reason: 'dry-run — reexecute com --execute após aprovação',
    });
    return;
  }

  assertSafeEnvironment();

  await hospedinAuthService.ensureAuthenticated();
  const resolvedAccountId = await hospedinAuthService.ensureAccountId();
  const token = hospedinAuthService.getToken();

  log('AUTH_USED', {
    type: 'Bearer JWT',
    token_preview: maskToken(token),
    account_id_env: accountId,
    account_id_resolved: resolvedAccountId,
  });

  log('=== 1. GET ANTES ===');
  const getBefore = await getReservation(hospedinApiClient, accountId, reservationId);
  log('GET_BEFORE', {
    url: getBefore.url,
    http_status: getBefore.http_status,
    reservation_found: getBefore.reservation_found,
    finance: getBefore.finance,
    response_body: sanitizeResponse(getBefore.response_body),
    error: getBefore.error,
  });

  if (getBefore.http_status !== 200 || !getBefore.success || !getBefore.reservation_found) {
    log('PROBE_ABORT', {
      reason: 'GET baseline inválido — PATCH não será executado',
      http_status: getBefore.http_status,
      reservation_found: getBefore.reservation_found,
      error: getBefore.error,
    });
    process.exit(1);
  }

  log('=== 2. PATCH API V2 OFICIAL ===');
  const patchMeta = await hospedinApiClient.requestMeta('PATCH', patchPath, {
    data: patchBody,
  });

  log('PATCH_RESULT', {
    method: 'PATCH',
    url: patchMeta.url,
    http_status: patchMeta.status,
    success: patchMeta.success,
    duration_ms: patchMeta.durationMs,
    request_body: patchBody,
    error: patchMeta.errorMessage || null,
    response_body: sanitizeResponse(patchMeta.data),
  });

  if (!patchMeta.success) {
    log('PROBE_STOP', {
      reason: 'PATCH retornou erro — encerrando sem GET comparativo adicional',
      http_status: patchMeta.status,
    });
    process.exit(1);
  }

  log('=== 3. GET DEPOIS ===');
  const getAfter = await getReservation(hospedinApiClient, accountId, reservationId);
  log('GET_AFTER', {
    url: getAfter.url,
    http_status: getAfter.http_status,
    finance: getAfter.finance,
    response_body: sanitizeResponse(getAfter.response_body),
    error: getAfter.error,
  });

  const comparison = compareFinance(getBefore.finance, getAfter.finance, patchBody);
  const persistedDaily =
    getAfter.finance.daily_cents === patchBody.daily_cents &&
    getAfter.finance.total_daily_cents === patchBody.total_daily_cents;

  log('FINANCE_COMPARISON', {
    antes: getBefore.finance,
    depois: getAfter.finance,
    patch_enviado: patchBody,
    rows: comparison,
    daily_cents_persisted: persistedDaily,
  });

  log('CONCLUSION', {
    patch_http_status: patchMeta.status,
    daily_cents_accepted_and_persisted: persistedDaily
      ? 'SIM — GET posterior igual ao PATCH'
      : patchMeta.success
        ? 'NÃO — PATCH 200 mas GET não refletiu os valores enviados'
        : 'NÃO — PATCH falhou',
    note:
      'HTTP 200 no PATCH sozinho não prova persistência; comparar GET antes/depois.',
  });
}

main().catch((error) => {
  if (error && error.stack) console.error(error.stack);
  else console.error('PROBE_FATAL', error);
  process.exit(1);
});
