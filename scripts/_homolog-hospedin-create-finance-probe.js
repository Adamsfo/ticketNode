/**
 * Homologação isolada — prova quais campos financeiros o Hospedin aceita no CREATE.
 *
 * Envia POST /api/v2/{accountId}/reservations com daily_cents, total_daily_cents e
 * total_amount explícitos, depois GET da mesma reserva para comparar persistência.
 *
 * NÃO usa fila outbound, NÃO altera banco, NÃO altera integração principal.
 * Cria uma reserva real na conta Hospedin configurada no .env (somente homolog/teste).
 *
 * Uso:
 *   cd ticket-node
 *   npm run build
 *   node scripts/_homolog-hospedin-create-finance-probe.js --execute
 *
 * Variáveis (.env):
 *   HOSPEDIN_API_URL      — default https://pms-api.hospedin.com
 *   HOSPEDIN_EMAIL        — obrigatório (ou HOSPEDIN_TOKEN)
 *   HOSPEDIN_PASSWORD     — obrigatório se não houver token
 *   HOSPEDIN_ACCOUNT_ID   — conta homolog (ex.: 69532, usada nos fixtures/homologs do projeto)
 *
 * Opcionais (evitam dependência de suíte ocupada):
 *   HOSPEDIN_PROBE_PLACE_ID=445906
 *   HOSPEDIN_PROBE_PLACE_TYPE_ID=131939
 *   HOSPEDIN_PROBE_GUEST_ID=     — se informado, não cria hóspede via POST /guests
 */
process.chdir(__dirname + '/..');
require('dotenv').config();

const { formatInTimeZone } = require('date-fns-tz');

const TZ_HOSPEDAGEM = 'America/Cuiaba';

/** Valores financeiros do experimento (centavos). */
const FINANCE_SENT = {
  daily_cents: 40000,
  total_daily_cents: 80000,
  total_amount: 88000,
};

/** Defaults da conta homolog 69532 (fixtures + homolog outbound etapa 3/7.5). */
const DEFAULT_PLACE_ID = 445906;
const DEFAULT_PLACE_TYPE_ID = 131939;

const args = new Set(process.argv.slice(2));
const MODE_EXECUTE = args.has('--execute');

function log(tag, data) {
  if (data === undefined) console.log(tag);
  else console.log(tag, JSON.stringify(data, null, 2));
}

function assertSafeEnvironment() {
  if (!MODE_EXECUTE) {
    console.error(
      'Modo seguro: use --execute para enviar POST real ao Hospedin.\n' +
        'Sem --execute o script apenas exibe a configuração e aborta.'
    );
    process.exit(1);
  }

  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error('Abortado: NODE_ENV=production — não executar este probe em produção.');
    process.exit(1);
  }
}

function formatCheckDatetime(date) {
  return formatInTimeZone(date, TZ_HOSPEDAGEM, "yyyy-MM-dd'T'HH:mm");
}

function buildStayDates(daysFromNow = 400) {
  const checkin = new Date();
  checkin.setUTCDate(checkin.getUTCDate() + daysFromNow);
  checkin.setUTCHours(14, 0, 0, 0);
  const checkout = new Date(checkin);
  checkout.setUTCDate(checkout.getUTCDate() + 2);
  checkout.setUTCHours(12, 0, 0, 0);
  return { checkin, checkout };
}

function asNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickReservationId(body) {
  if (!body || typeof body !== 'object') return null;
  const id = asNumber(body.id);
  return id != null && id > 0 ? id : null;
}

function pickFinanceFromBody(body) {
  const row = body && typeof body === 'object' ? body : {};
  return {
    daily_cents: asNumber(row.daily_cents),
    total_daily_cents: asNumber(row.total_daily_cents),
    total_amount: asNumber(row.total_amount),
  };
}

/**
 * Classifica um campo financeiro comparando valor enviado vs GET posterior.
 * HTTP 2xx no POST sozinho NÃO é prova de persistência.
 */
function classifyField(fieldName, sent, received) {
  if (received == null) {
    return {
      field: fieldName,
      sent,
      received,
      conclusion: 'IMPOSSÍVEL DETERMINAR',
      reason: 'campo ausente ou não numérico no GET',
    };
  }

  if (received === sent) {
    return {
      field: fieldName,
      sent,
      received,
      conclusion: 'ACEITOU E PERSISTIU',
      reason: 'GET retornou o mesmo valor enviado',
    };
  }

  return {
    field: fieldName,
    sent,
    received,
    conclusion: 'ACEITOU MAS IGNOROU',
    reason: 'POST retornou sucesso mas GET diverge do valor enviado',
  };
}

function summarizeApiFailure(error) {
  const status = error && typeof error.status === 'number' ? error.status : null;
  const message = error && error.message ? String(error.message) : String(error);
  const body =
    error && error.details != null
      ? error.details
      : error && error.body != null
        ? error.body
        : null;
  return { status, message, body };
}

async function createGuestIfNeeded(client, auth, accountId) {
  const fromEnv = asNumber(process.env.HOSPEDIN_PROBE_GUEST_ID);
  if (fromEnv != null && fromEnv > 0) {
    return { guestId: fromEnv, created: false, requestBody: null, responseBody: null };
  }

  const guestPath = `/api/v2/${encodeURIComponent(accountId)}/guests`;
  const guestBody = {
    name: `HOMOLOG FINANCE CREATE PROBE ${new Date().toISOString()}`,
  };

  log('GUEST_POST_ENDPOINT', guestPath);
  log('GUEST_POST_BODY', guestBody);

  const guestResponse = await client.post(guestPath, guestBody);
  const guestId = pickReservationId(guestResponse);

  log('GUEST_POST_RESPONSE', guestResponse);

  if (!guestId) {
    throw new Error('POST /guests não retornou id válido — abortado antes do POST /reservations.');
  }

  return {
    guestId,
    created: true,
    requestBody: guestBody,
    responseBody: guestResponse,
  };
}

async function main() {
  assertSafeEnvironment();

  const { getHospedinConfig } = require('../dist/integrations/hospedin/constants/config');
  const { hospedinAuthService } = require('../dist/integrations/hospedin/services/HospedinAuthService');
  const { hospedinApiClient } = require('../dist/integrations/hospedin/api/HospedinApiClient');
  const cfg = getHospedinConfig();

  log('PROBE_META', {
    purpose: 'Provar aceitação/persistência de campos financeiros no CREATE Hospedin',
    node_env: process.env.NODE_ENV || '(unset)',
    api_url: cfg.apiUrl,
    account_id_env: cfg.accountId,
    place_id: asNumber(process.env.HOSPEDIN_PROBE_PLACE_ID) || DEFAULT_PLACE_ID,
    place_type_id:
      asNumber(process.env.HOSPEDIN_PROBE_PLACE_TYPE_ID) || DEFAULT_PLACE_TYPE_ID,
    finance_sent_cents: FINANCE_SENT,
    does_not_touch: ['banco Jango', 'fila outbound', 'HospedinOutbound*', 'PATCH/UPDATE'],
  });

  await hospedinAuthService.ensureAuthenticated();
  const accountId = await hospedinAuthService.ensureAccountId();

  const placeId = asNumber(process.env.HOSPEDIN_PROBE_PLACE_ID) || DEFAULT_PLACE_ID;
  const placeTypeId =
    asNumber(process.env.HOSPEDIN_PROBE_PLACE_TYPE_ID) || DEFAULT_PLACE_TYPE_ID;
  const { checkin, checkout } = buildStayDates(400);

  const guestInfo = await createGuestIfNeeded(
    hospedinApiClient,
    hospedinAuthService,
    accountId
  );

  const reservationBody = {
    place_id: placeId,
    place_type_id: placeTypeId,
    status: 'reservation',
    check_in: formatCheckDatetime(checkin),
    check_out: formatCheckDatetime(checkout),
    adults: 2,
    children: 0,
    exempt: 0,
    note: `HOMOLOG FINANCE CREATE PROBE ${new Date().toISOString()}\nSomente teste de campos financeiros no POST.`,
    guest_id: guestInfo.guestId,
    daily_cents: FINANCE_SENT.daily_cents,
    total_daily_cents: FINANCE_SENT.total_daily_cents,
    total_amount: FINANCE_SENT.total_amount,
    has_payment_coming_from_ota: false,
    has_breakfast: false,
    sale_channel_id: null,
  };

  const reservationPath = `/api/v2/${encodeURIComponent(accountId)}/reservations`;

  log('RESERVATION_POST_ENDPOINT', reservationPath);
  log('RESERVATION_POST_BODY_EXACT', reservationBody);

  let postStatus = null;
  let postResponseBody = null;
  let reservationId = null;

  try {
    postResponseBody = await hospedinApiClient.post(reservationPath, reservationBody);
    postStatus = 200;
    reservationId = pickReservationId(postResponseBody);

    log('RESERVATION_POST_HTTP_STATUS', postStatus);
    log('RESERVATION_POST_RESPONSE_BODY', postResponseBody);
  } catch (error) {
    const fail = summarizeApiFailure(error);
    postStatus = fail.status;
    postResponseBody = fail.body;

    log('RESERVATION_POST_HTTP_STATUS', postStatus);
    log('RESERVATION_POST_ERROR', fail.message);
    log('RESERVATION_POST_RESPONSE_BODY', postResponseBody);

    log('CONCLUSAO_GERAL', {
      resultado: 'ERRO DE VALIDAÇÃO',
      motivo: 'POST /reservations falhou — GET posterior não aplicável',
    });

    process.exit(1);
  }

  if (!reservationId) {
    log('CONCLUSAO_GERAL', {
      resultado: 'IMPOSSÍVEL DETERMINAR',
      motivo: 'POST retornou sucesso sem id de reserva — GET posterior não aplicável',
      post_response_body: postResponseBody,
    });
    process.exit(2);
  }

  log('RESERVATION_ID', reservationId);

  const getPath = `/api/v2/${encodeURIComponent(accountId)}/reservations/${reservationId}`;
  log('RESERVATION_GET_ENDPOINT', getPath);

  let getResponseBody = null;
  let getStatus = null;

  try {
    getResponseBody = await hospedinApiClient.get(getPath);
    getStatus = 200;
    log('RESERVATION_GET_HTTP_STATUS', getStatus);
    log('RESERVATION_GET_RESPONSE_BODY', getResponseBody);
  } catch (error) {
    const fail = summarizeApiFailure(error);
    getStatus = fail.status;

    log('RESERVATION_GET_HTTP_STATUS', getStatus);
    log('RESERVATION_GET_ERROR', fail.message);
    log('RESERVATION_GET_RESPONSE_BODY', fail.body);

    log('CONCLUSAO_GERAL', {
      resultado: 'IMPOSSÍVEL DETERMINAR',
      motivo: 'POST criou reserva mas GET falhou — persistência não verificável',
      reservation_id: reservationId,
    });
    process.exit(3);
  }

  const received = pickFinanceFromBody(getResponseBody);
  const postFinance = pickFinanceFromBody(postResponseBody);

  log('COMPARACAO_FINANCEIRA', {
    enviado: FINANCE_SENT,
    recebido_no_post_response: postFinance,
    recebido_no_get: received,
  });

  const fieldResults = [
    classifyField('daily_cents', FINANCE_SENT.daily_cents, received.daily_cents),
    classifyField(
      'total_daily_cents',
      FINANCE_SENT.total_daily_cents,
      received.total_daily_cents
    ),
    classifyField('total_amount', FINANCE_SENT.total_amount, received.total_amount),
  ];

  log('CONCLUSAO_POR_CAMPO', fieldResults);

  const conclusions = new Set(fieldResults.map((r) => r.conclusion));
  let overall = 'IMPOSSÍVEL DETERMINAR';

  if (conclusions.size === 1 && conclusions.has('ACEITOU E PERSISTIU')) {
    overall = 'ACEITOU E PERSISTIU';
  } else if (conclusions.size === 1 && conclusions.has('ACEITOU MAS IGNOROU')) {
    overall = 'ACEITOU MAS IGNOROU';
  } else if (fieldResults.some((r) => r.conclusion === 'ACEITOU E PERSISTIU')) {
    overall = 'IMPOSSÍVEL DETERMINAR';
  } else if (fieldResults.every((r) => r.conclusion === 'ACEITOU MAS IGNOROU')) {
    overall = 'ACEITOU MAS IGNOROU';
  }

  log('CONCLUSAO_GERAL', {
    resultado: overall,
    reservation_id: reservationId,
    searchable_code: getResponseBody?.searchable_code ?? null,
    guest_id: guestInfo.guestId,
    guest_created: guestInfo.created,
    nota:
      'Prova baseada no GET posterior. HTTP 200 no POST não implica persistência financeira.',
    proximo_passo_manual:
      'Cancelar ou arquivar a reserva de teste no Hospedin se necessário.',
  });
}

main().catch((error) => {
  if (error && error.stack) console.error(error.stack);
  else console.error('PROBE_FATAL', error);
  process.exit(1);
});
