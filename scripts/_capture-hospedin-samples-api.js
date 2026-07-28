/**
 * Captura amostras reais via API (lista + detalhes pontuais).
 * Não importa o catálogo inteiro.
 *
 * node scripts/_capture-hospedin-samples-api.js
 */
require('dotenv').config();
require('ts-node/register/transpile-only');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'fixtures', 'hospedin-reservation-samples.json');

function isCancelled(status) {
  return /cancel|no_?show|void|deleted/i.test(String(status || ''));
}

(async () => {
  require('../src/database');
  await new Promise((r) => setTimeout(r, 1500));

  const { hospedinAuthService } = require('../src/integrations/hospedin/services/HospedinAuthService');
  const { hospedinReservationService } = require('../src/integrations/hospedin/services/HospedinReservationService');
  const { HospedinApiClient } = require('../src/integrations/hospedin/api/HospedinApiClient');
  // use service methods only

  await hospedinAuthService.ensureAuthenticated();
  const accountId = await hospedinAuthService.ensureAccountId();

  // lista só primeiras páginas (rápido)
  const { getHospedinConfig } = require('../src/integrations/hospedin/constants/config');
  const cfg = getHospedinConfig();
  const client = require('../src/integrations/hospedin/api/HospedinApiClient').hospedinApiClient;

  const listPage = async (page) => {
    const res = await client.get(`/api/v2/${accountId}/reservations`, {
      params: { page, limit: 100 },
    });
    const body = res?.data;
    if (Array.isArray(body)) return body;
    if (Array.isArray(body?.data)) return body.data;
    if (Array.isArray(body?.reservations)) return body.reservations;
    return [];
  };

  let list = [];
  for (let p = 1; p <= 3; p++) {
    const chunk = await listPage(p);
    list = list.concat(chunk);
    if (chunk.length < 100) break;
  }

  const statusCounts = {};
  for (const raw of list) {
    const s = String(raw?.status ?? 'unknown');
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }

  const pickIds = {
    any: [],
    cancelled: [],
    active: [],
  };
  for (const raw of list) {
    const id = Number(raw?.id);
    if (!id) continue;
    if (pickIds.any.length < 3) pickIds.any.push(id);
    if (isCancelled(raw.status) && pickIds.cancelled.length < 3) {
      pickIds.cancelled.push(id);
    }
    if (!isCancelled(raw.status) && pickIds.active.length < 3) {
      pickIds.active.push(id);
    }
  }

  const ids = [...new Set([...pickIds.any, ...pickIds.cancelled, ...pickIds.active])];
  const samples = [];

  for (const id of ids) {
    const dto = await hospedinReservationService.getReservationDto(id, accountId);
    const payload = dto.sourcePayload || {};

    let guestReservations = null;
    try {
      const gr = await client.get(
        `/api/v2/${accountId}/reservations/${id}/guest_reservations`
      );
      guestReservations = gr?.data ?? null;
    } catch (e) {
      guestReservations = { error: e?.message || 'fail' };
    }

    const label = isCancelled(dto.status)
      ? 'cancelled'
      : Array.isArray(payload.guests) || Array.isArray(guestReservations)
        ? 'with_guests_or_guest_reservations'
        : 'active_or_other';

    samples.push({
      label,
      reservation_id: id,
      staging_status: dto.status,
      checkin: dto.checkin,
      checkout: dto.checkout,
      placeId: dto.placeId,
      summary: {
        keys: Object.keys(payload).sort(),
        status: payload.status ?? dto.status,
        place_id: payload.place_id ?? dto.placeId,
        has_guests: Array.isArray(payload.guests),
        guests_len: Array.isArray(payload.guests) ? payload.guests.length : 0,
        guest_reservations_type: Array.isArray(guestReservations)
          ? 'array'
          : guestReservations && typeof guestReservations === 'object'
            ? Object.keys(guestReservations).slice(0, 12)
            : typeof guestReservations,
      },
      payload,
      guest_reservations: guestReservations,
    });
  }

  const report = {
    capturedAt: new Date().toISOString(),
    accountId,
    listSampleSize: list.length,
    statusCounts,
    note:
      'Amostras via API (3 páginas de lista + GET detalhe + guest_reservations). Sem sync financeiro.',
    samples,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  console.log('STATUSES', JSON.stringify(statusCounts));
  console.log(
    'SAMPLES',
    samples.map((s) => `${s.label}#${s.reservation_id}:${s.staging_status}`).join(', ')
  );
  console.log('WROTE', OUT);
  process.exit(0);
})().catch((e) => {
  console.error('FAIL', e?.message || e);
  process.exit(1);
});
