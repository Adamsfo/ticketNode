/**
 * Tenta importar reservas Hospedin (staging) via services existentes.
 * node scripts/_try-import-reservations.js
 */
require('dotenv').config();
require('ts-node/register/transpile-only');

(async () => {
  // Garante init dos models
  require('../src/database');
  await new Promise((r) => setTimeout(r, 2000));

  const { importHospedinReservations } = require('../src/integrations/hospedin/services/HospedinImportReservationService');
  const result = await importHospedinReservations({ fetchDetails: true });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error('IMPORT_FAIL', e?.message || e);
  process.exit(1);
});
