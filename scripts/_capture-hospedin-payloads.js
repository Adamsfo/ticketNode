/**
 * Captura amostras de payload_json de hospedin_reservations (staging)
 * e, se possível, enriquece via API (GET reservation + guest_reservations).
 *
 * Uso: node scripts/_capture-hospedin-payloads.js
 * Saída: scripts/fixtures/hospedin-reservation-samples.json (sem credenciais)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');

const OUT_DIR = path.join(__dirname, 'fixtures');
const OUT_FILE = path.join(OUT_DIR, 'hospedin-reservation-samples.json');

function summarize(payload) {
  if (!payload || typeof payload !== 'object') return { empty: true };
  const keys = Object.keys(payload).sort();
  const guests =
    payload.guests ||
    payload.guest_list ||
    payload.reservation_guests ||
    payload.hospedes ||
    null;
  return {
    keys,
    id: payload.id ?? null,
    status: payload.status ?? null,
    check_in: payload.check_in ?? null,
    check_out: payload.check_out ?? null,
    place_id: payload.place_id ?? null,
    place_type_id: payload.place_type_id ?? null,
    searchable_code: payload.searchable_code ?? null,
    has_guests_array: Array.isArray(guests),
    guests_count: Array.isArray(guests) ? guests.length : 0,
    has_main_guest: Boolean(
      payload.main_guest || payload.guest || payload.customer || payload.client
    ),
    note_fields: ['notes', 'observation', 'observations', 'obs', 'comment'].filter(
      (k) => payload[k] != null && String(payload[k]).trim() !== ''
    ),
  };
}

function parsePayload(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function pickSamples(rows) {
  const byStatus = new Map();
  for (const row of rows) {
    const p = parsePayload(row.payload_json);
    const status = String((p && p.status) || row.status || 'unknown').toLowerCase();
    if (!byStatus.has(status)) byStatus.set(status, []);
    byStatus.get(status).push({ row, payload: p });
  }

  const samples = [];
  const take = (label, predicate, limit = 2) => {
    let n = 0;
    for (const row of rows) {
      if (n >= limit) break;
      const payload = parsePayload(row.payload_json);
      if (!predicate(row, payload)) continue;
      samples.push({
        label,
        reservation_id: row.reservation_id,
        staging_status: row.status,
        checkin: row.checkin,
        checkout: row.checkout,
        summary: summarize(payload),
        payload,
      });
      n += 1;
    }
  };

  take('any_with_payload', (_r, p) => !!p, 3);
  take(
    'likely_cancelled',
    (_r, p) => {
      const s = String((p && p.status) || '').toLowerCase();
      return /cancel|no_?show|void/.test(s);
    },
    2
  );
  take(
    'with_guests',
    (_r, p) => {
      if (!p) return false;
      const g = p.guests || p.guest_list || p.reservation_guests || p.hospedes;
      return Array.isArray(g) && g.length > 0;
    },
    2
  );
  take(
    'with_main_guest_only',
    (_r, p) => {
      if (!p) return false;
      const g = p.guests || p.guest_list || p.reservation_guests || p.hospedes;
      const hasList = Array.isArray(g) && g.length > 0;
      return (
        !hasList &&
        Boolean(p.main_guest || p.guest || p.customer || p.client)
      );
    },
    2
  );

  // Dedup by reservation_id+label
  const seen = new Set();
  const unique = [];
  for (const s of samples) {
    const key = `${s.label}:${s.reservation_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
  }

  return {
    capturedAt: new Date().toISOString(),
    stagingCount: rows.length,
    statusesObserved: [...byStatus.keys()].sort(),
    statusCounts: Object.fromEntries(
      [...byStatus.entries()].map(([k, v]) => [k, v.length])
    ),
    samples: unique,
  };
}

(async () => {
  const s = new Sequelize(
    process.env.DB_NAME || 'ticketJango',
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
      host: process.env.DB_HOST,
      dialect: process.env.DB_DIALECT || 'mysql',
      logging: false,
    }
  );

  try {
    await s.authenticate();
    const [rows] = await s.query(
      `SELECT reservation_id, status, checkin, checkout, payload_json, updated_at
       FROM hospedin_reservations
       ORDER BY updated_at DESC
       LIMIT 200`
    );

    if (!rows.length) {
      console.log('NO_STAGING_ROWS');
      console.log(
        'Rode antes: POST /api/integrations/hospedin/import/reservations com fetchDetails:true'
      );
      const empty = {
        capturedAt: new Date().toISOString(),
        stagingCount: 0,
        statusesObserved: [],
        statusCounts: {},
        samples: [],
        note: 'Staging vazio — importar reservas com fetchDetails antes de fechar mapeamento.',
      };
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(OUT_FILE, JSON.stringify(empty, null, 2), 'utf8');
      console.log('WROTE', OUT_FILE);
      await s.close();
      return;
    }

    const report = pickSamples(rows);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), 'utf8');
    console.log('STAGING_COUNT', report.stagingCount);
    console.log('STATUSES', JSON.stringify(report.statusCounts));
    console.log('SAMPLES', report.samples.length);
    console.log(
      'LABELS',
      report.samples.map((x) => `${x.label}#${x.reservation_id}`).join(', ')
    );
    console.log('WROTE', OUT_FILE);
    await s.close();
  } catch (e) {
    console.error('FAIL', e.message);
    try {
      await s.close();
    } catch (_) {}
    process.exit(1);
  }
})();
