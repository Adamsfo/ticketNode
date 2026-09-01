/**
 * Probe somente-leitura: reservation_transactions por canal OTA.
 * Não altera sync, financeiro nem regras de negócio.
 *
 * node scripts/_probe-hospedin-reservation-transactions.js
 */
require('dotenv').config();
require('ts-node/register/transpile-only');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(
  __dirname,
  'fixtures',
  'hospedin-reservation-transactions-probe'
);
const OUT_REPORT = path.join(OUT_DIR, 'report.json');

const TARGET_CHANNELS = ['expedia', 'booking', 'airbnb'];
const MAX_PAGES = 15;
const MAX_PER_CHANNEL = 5;

function channelName(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    return raw.name || raw.title || raw.label || raw.slug || null;
  }
  return String(raw);
}

function matchChannel(raw) {
  const n = String(channelName(raw) || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (!n) return null;
  if (n.includes('expedia')) return 'expedia';
  if (n.includes('booking')) return 'booking';
  if (n.includes('airbnb')) return 'airbnb';
  return null;
}

function deepKeys(value, prefix = '', acc = new Set()) {
  if (value == null) return acc;
  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((item, i) => deepKeys(item, `${prefix}[${i}]`, acc));
    return acc;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const p = prefix ? `${prefix}.${k}` : k;
      acc.add(p);
      deepKeys(v, p, acc);
    }
  }
  return acc;
}

function findKeywordHits(obj) {
  const blob = JSON.stringify(obj || {}).toLowerCase();
  const keywords = [
    'payment_method',
    'coming_from_ota',
    'transaction_type',
    'payment_status',
    'note',
    'description',
    'vcc',
    'virtual',
    'credit_card',
    'card',
    'expedia collect',
    'hotel collect',
    'expedia_collect',
    'hotel_collect',
    'payment_collect',
    'payment_instruction',
    'payment_type',
    'collect',
  ];
  return keywords.filter((k) => blob.includes(k));
}

function unwrapList(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.reservations)) return body.reservations;
  return [];
}

(async () => {
  require('../src/database');
  await new Promise((r) => setTimeout(r, 1200));

  const { hospedinAuthService } = require('../src/integrations/hospedin/services/HospedinAuthService');
  const { hospedinApiClient } = require('../src/integrations/hospedin/api/HospedinApiClient');

  await hospedinAuthService.ensureAuthenticated();
  const accountId = await hospedinAuthService.ensureAccountId();

  const byChannel = {
    expedia: [],
    booking: [],
    airbnb: [],
  };
  const channelCounts = {};
  let listed = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await hospedinApiClient.get(`/api/v2/${accountId}/reservations`, {
      params: { page, limit: 100 },
    });
    const rows = unwrapList(body);
    if (!rows.length) break;
    listed += rows.length;

    for (const raw of rows) {
      const ch = matchChannel(raw.sale_channel);
      const label = channelName(raw.sale_channel) || '(null)';
      channelCounts[label] = (channelCounts[label] || 0) + 1;
      if (!ch) continue;
      if (byChannel[ch].length >= MAX_PER_CHANNEL) continue;
      byChannel[ch].push({
        reservation_id: Number(raw.id),
        status: raw.status ?? null,
        sale_channel: raw.sale_channel ?? null,
        sale_channel_id: raw.sale_channel_id ?? null,
        has_payment_coming_from_ota: raw.has_payment_coming_from_ota ?? null,
        total_amount: raw.total_amount ?? null,
        total_received: raw.total_received ?? null,
        total_to_receive: raw.total_to_receive ?? null,
        searchable_code: raw.searchable_code ?? null,
        list_row: raw,
      });
    }

    const filled = TARGET_CHANNELS.every(
      (c) => byChannel[c].length >= MAX_PER_CHANNEL
    );
    if (filled || rows.length < 100) break;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const samples = [];

  for (const channel of TARGET_CHANNELS) {
    const picks = byChannel[channel];
    if (!picks.length) {
      samples.push({
        channel,
        found: false,
        message: 'Nenhuma reserva deste canal na listagem amostrada.',
      });
      continue;
    }

    for (const pick of picks) {
      const id = pick.reservation_id;
      const base = path.join(OUT_DIR, `${channel}_${id}`);

      let reservationPayload = null;
      let reservationError = null;
      try {
        reservationPayload = await hospedinApiClient.get(
          `/api/v2/${accountId}/reservations/${id}`
        );
      } catch (e) {
        reservationError = {
          message: e?.message || String(e),
          status: e?.status || e?.httpStatus || null,
          body: e?.body ?? e?.response?.data ?? null,
        };
      }

      let transactionsRaw = null;
      let transactionsError = null;
      let transactionsHttp = null;
      try {
        const meta = await hospedinApiClient.requestMeta(
          'GET',
          `/api/v2/${accountId}/reservations/${id}/reservation_transactions`
        );
        transactionsHttp = {
          success: meta.success,
          status: meta.status,
          url: meta.url,
          errorMessage: meta.errorMessage || null,
        };
        transactionsRaw = meta.data ?? null;
        if (!meta.success) {
          transactionsError = {
            message: meta.errorMessage || `HTTP ${meta.status}`,
            status: meta.status,
            body: meta.data ?? null,
          };
        }
      } catch (e) {
        transactionsError = {
          message: e?.message || String(e),
          status: e?.status || null,
          body: e?.body ?? null,
        };
      }

      const txArray = Array.isArray(transactionsRaw)
        ? transactionsRaw
        : Array.isArray(transactionsRaw?.data)
          ? transactionsRaw.data
          : null;

      const reservationKeys = reservationPayload
        ? Object.keys(reservationPayload).sort()
        : [];
      const txKeys = deepKeys(transactionsRaw);

      const interestingFields = {
        payment_method: [],
        coming_from_ota: [],
        transaction_type: [],
        payment_status: [],
        note: [],
        description: [],
      };

      const collectField = (obj, pathHint = '') => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          obj.forEach((x, i) => collectField(x, `${pathHint}[${i}]`));
          return;
        }
        for (const [k, v] of Object.entries(obj)) {
          const p = pathHint ? `${pathHint}.${k}` : k;
          const lk = k.toLowerCase();
          if (lk in interestingFields || lk === 'status') {
            if (lk === 'status') {
              interestingFields.payment_status.push({ path: p, value: v });
            } else if (lk in interestingFields) {
              interestingFields[lk].push({ path: p, value: v });
            }
          }
          if (v && typeof v === 'object') collectField(v, p);
        }
      };
      collectField(transactionsRaw);

      const comparison = {
        reservation_has_payment_coming_from_ota:
          reservationPayload?.has_payment_coming_from_ota ??
          pick.has_payment_coming_from_ota,
        reservation_totals: {
          total_amount:
            reservationPayload?.total_amount ?? pick.total_amount,
          total_received:
            reservationPayload?.total_received ?? pick.total_received,
          total_to_receive:
            reservationPayload?.total_to_receive ?? pick.total_to_receive,
        },
        reservation_has_sale_channel: reservationPayload?.sale_channel != null,
        list_sale_channel: pick.sale_channel,
        transactions_count: Array.isArray(txArray) ? txArray.length : null,
        transactions_empty:
          Array.isArray(txArray) && txArray.length === 0,
        keyword_hits_in_transactions: findKeywordHits(transactionsRaw),
        keyword_hits_in_reservation: findKeywordHits(reservationPayload),
      };

      fs.writeFileSync(
        `${base}_reservation.json`,
        JSON.stringify(
          {
            channel,
            reservation_id: id,
            list_summary: {
              status: pick.status,
              sale_channel: pick.sale_channel,
              sale_channel_id: pick.sale_channel_id,
              searchable_code: pick.searchable_code,
              has_payment_coming_from_ota: pick.has_payment_coming_from_ota,
              total_amount: pick.total_amount,
              total_received: pick.total_received,
              total_to_receive: pick.total_to_receive,
            },
            list_row: pick.list_row,
            reservation_error: reservationError,
            reservation_payload: reservationPayload,
          },
          null,
          2
        ),
        'utf8'
      );

      fs.writeFileSync(
        `${base}_transactions.json`,
        JSON.stringify(
          {
            channel,
            reservation_id: id,
            http: transactionsHttp,
            error: transactionsError,
            raw: transactionsRaw,
          },
          null,
          2
        ),
        'utf8'
      );

      samples.push({
        channel,
        found: true,
        reservation_id: id,
        searchable_code: pick.searchable_code,
        status: pick.status,
        sale_channel: pick.sale_channel,
        files: {
          reservation: path.basename(`${base}_reservation.json`),
          transactions: path.basename(`${base}_transactions.json`),
        },
        http_transactions: transactionsHttp,
        transactions_error: transactionsError,
        reservation_keys: reservationKeys,
        transaction_paths_sample: [...txKeys].sort().slice(0, 200),
        interesting_fields: interestingFields,
        comparison,
      });
    }
  }

  const report = {
    capturedAt: new Date().toISOString(),
    accountId,
    note:
      'Probe somente-leitura de /reservation_transactions para canais Expedia/Booking/Airbnb. Sem alteração de regras.',
    listPagesScannedUpTo: MAX_PAGES,
    listedRows: listed,
    channelCountsFromList: channelCounts,
    pickedPerChannel: Object.fromEntries(
      TARGET_CHANNELS.map((c) => [c, byChannel[c].length])
    ),
    samples,
  };

  fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2), 'utf8');
  console.log(
    JSON.stringify(
      {
        accountId,
        listedRows: listed,
        pickedPerChannel: report.pickedPerChannel,
        channelCountsTop: Object.entries(channelCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20),
        sampleSummaries: samples.map((s) => ({
          channel: s.channel,
          found: s.found,
          id: s.reservation_id,
          txStatus: s.http_transactions?.status,
          txCount: s.comparison?.transactions_count,
          txEmpty: s.comparison?.transactions_empty,
          otaFlag: s.comparison?.reservation_has_payment_coming_from_ota,
          totals: s.comparison?.reservation_totals,
          keywordHitsTx: s.comparison?.keyword_hits_in_transactions,
        })),
        out: OUT_REPORT,
      },
      null,
      2
    )
  );
  process.exit(0);
})().catch((e) => {
  console.error('FAIL', e?.message || e);
  if (e?.stack) console.error(e.stack);
  process.exit(1);
});
