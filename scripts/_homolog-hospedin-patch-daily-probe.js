/**
 * Homologação isolada — probe do endpoint interno do painel Hospedin (Network).
 *
 * Testa se a autenticação JWT já usada pela integração (login API v2) também
 * autoriza o PATCH interno capturado no painel web:
 *
 *   PATCH /{account_slug}/services/reservations/{reservation_id}
 *   Body: { reservation: { id, daily } }
 *
 * NÃO altera integração outbound, services, controllers, models ou banco.
 * NÃO usa cookie de sessão do navegador nem X-CSRF-Token manual.
 *
 * Fluxo:
 *   1. GET reserva via API v2 documentada (baseline)
 *   2. PATCH endpoint interno do painel (somente se --execute)
 *   3. GET reserva novamente (comparar daily / daily_cents)
 *
 * Uso:
 *   cd ticket-node
 *   npm run build
 *   node scripts/_homolog-hospedin-patch-daily-probe.js          # dry-run (plano)
 *   node scripts/_homolog-hospedin-patch-daily-probe.js --execute
 *
 * Variáveis (.env):
 *   HOSPEDIN_API_URL        — default https://pms-api.hospedin.com
 *   HOSPEDIN_EMAIL          — ou HOSPEDIN_TOKEN
 *   HOSPEDIN_PASSWORD
 *   HOSPEDIN_ACCOUNT_ID     — usado no GET API v2 (ex.: 69532)
 *
 * Opcionais:
 *   HOSPEDIN_PROBE_RESERVATION_ID=30416006
 *   HOSPEDIN_PROBE_ACCOUNT_SLUG=pousada-jango
 *   HOSPEDIN_PROBE_DAILY=401
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const DEFAULT_RESERVATION_ID = 30416006;
const DEFAULT_ACCOUNT_SLUG = 'pousada-jango';
const DEFAULT_DAILY_SENT = 401;

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

function pickDailyFields(body) {
  const row = body && typeof body === 'object' ? body : {};
  const nested =
    row.reservation && typeof row.reservation === 'object' ? row.reservation : null;

  return {
    daily: asNumber(row.daily ?? nested?.daily),
    daily_cents: asNumber(row.daily_cents ?? nested?.daily_cents),
    total_daily_cents: asNumber(row.total_daily_cents ?? nested?.total_daily_cents),
    total_amount: asNumber(row.total_amount ?? nested?.total_amount),
  };
}

async function fetchReservationV2(client, accountId, reservationId) {
  const path = `/api/v2/${accountId}/reservations/${reservationId}`;
  const meta = await client.requestMeta('GET', path);
  return {
    path,
    url: meta.url,
    http_status: meta.status,
    success: meta.success,
    error: meta.errorMessage || null,
    response_body: meta.data,
    daily_fields: pickDailyFields(meta.data),
  };
}

async function main() {
  const { getHospedinConfig } = require('../dist/integrations/hospedin/constants/config');
  const { hospedinAuthService } = require('../dist/integrations/hospedin/services/HospedinAuthService');
  const { hospedinApiClient } = require('../dist/integrations/hospedin/api/HospedinApiClient');

  const cfg = getHospedinConfig();
  const reservationId =
    asNumber(process.env.HOSPEDIN_PROBE_RESERVATION_ID) || DEFAULT_RESERVATION_ID;
  const accountSlug =
    (process.env.HOSPEDIN_PROBE_ACCOUNT_SLUG || DEFAULT_ACCOUNT_SLUG).trim();
  const dailySent = asNumber(process.env.HOSPEDIN_PROBE_DAILY) || DEFAULT_DAILY_SENT;

  const patchPath = `/${accountSlug}/services/reservations/${reservationId}`;
  const patchUrl = `${cfg.apiUrl}${patchPath}`;
  const patchPayload = {
    reservation: {
      id: reservationId,
      daily: dailySent,
    },
  };

  const plan = {
    phase: 'HOMOLOG_PATCH_DAILY_PROBE',
    mode: MODE_EXECUTE ? 'execute' : 'dry-run',
    authentication: {
      type: 'Bearer JWT (API v2 login)',
      mechanism:
        'HospedinAuthService.ensureAuthenticated() → POST /api/v2/authentication/sessions',
      source: cfg.token ? 'HOSPEDIN_TOKEN ou login email/senha' : 'HOSPEDIN_EMAIL + HOSPEDIN_PASSWORD',
      no_browser_cookie: true,
      no_csrf_token: true,
    },
    api_v2_get: {
      method: 'GET',
      path_template: '/api/v2/{account_id}/reservations/{id}',
      account_id_from_env: cfg.accountId,
    },
    patch_internal_panel: {
      method: 'PATCH',
      url: patchUrl,
      path: patchPath,
      body: patchPayload,
    },
    reservation_id: reservationId,
    daily_sent: dailySent,
    restrictions: [
      'Somente esta reserva de teste',
      'Sem POST/PATCH em outros endpoints',
      'Sem cookie de navegador',
      'Sem alteração de código de integração',
    ],
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
  const accountId = await hospedinAuthService.ensureAccountId();
  const token = hospedinAuthService.getToken();

  log('AUTH_USED', {
    type: 'Bearer JWT',
    token_preview: maskToken(token),
    account_id_api_v2: accountId,
    account_slug_panel: accountSlug,
    user_email: cfg.email || null,
  });

  log('=== GET ANTES (API v2) ===');
  const getBefore = await fetchReservationV2(hospedinApiClient, accountId, reservationId);
  log('GET_BEFORE', {
    method: 'GET',
    url: getBefore.url,
    http_status: getBefore.http_status,
    success: getBefore.success,
    error: getBefore.error,
    daily_fields: getBefore.daily_fields,
    response_body: sanitizeResponse(getBefore.response_body),
  });

  if (!getBefore.success) {
    log('PROBE_ABORT', {
      reason: 'GET baseline falhou — PATCH não será executado',
      http_status: getBefore.http_status,
    });
    process.exit(1);
  }

  log('=== PATCH INTERNO (painel) ===');
  const patchMeta = await hospedinApiClient.requestMeta('PATCH', patchPath, {
    data: patchPayload,
  });

  log('PATCH_RESULT', {
    method: 'PATCH',
    url: patchMeta.url,
    http_status: patchMeta.status,
    success: patchMeta.success,
    duration_ms: patchMeta.durationMs,
    request_body: patchPayload,
    error: patchMeta.errorMessage || null,
    response_body: sanitizeResponse(patchMeta.data),
  });

  log('=== GET DEPOIS (API v2) ===');
  const getAfter = await fetchReservationV2(hospedinApiClient, accountId, reservationId);
  log('GET_AFTER', {
    method: 'GET',
    url: getAfter.url,
    http_status: getAfter.http_status,
    success: getAfter.success,
    error: getAfter.error,
    daily_fields: getAfter.daily_fields,
    response_body: sanitizeResponse(getAfter.response_body),
  });

  const before = getBefore.daily_fields;
  const after = getAfter.daily_fields;

  const dailyChanged =
    before.daily !== after.daily ||
    before.daily_cents !== after.daily_cents ||
    before.total_daily_cents !== after.total_daily_cents ||
    before.total_amount !== after.total_amount;

  log('SUMMARY_A_TO_G', {
    A_authentication: {
      type: 'Bearer JWT via HospedinAuthService (login API v2)',
      token_preview: maskToken(token),
      no_cookie_no_csrf: true,
    },
    B_patch_status: patchMeta.status,
    C_value_before: before,
    D_value_sent: { daily: dailySent },
    E_value_after: after,
    F_daily_changed: dailyChanged,
    G_patch_success_http: patchMeta.success,
  });

  log('CONCLUSION', {
    patch_accepted_auth:
      patchMeta.success
        ? 'SIM — endpoint interno aceitou Bearer JWT da integração'
        : 'NÃO — ver http_status e response_body acima',
    financial_fields_changed: dailyChanged,
    note:
      'Campo painel usa "daily" (ex.: 502 no capture); API v2 expõe daily_cents. Compare ambos.',
  });
}

main().catch((error) => {
  if (error && error.stack) console.error(error.stack);
  else console.error('PROBE_FATAL', error);
  process.exit(1);
});
