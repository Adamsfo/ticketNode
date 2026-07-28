require('dotenv').config();
require('ts-node/register/transpile-only');

(async () => {
  require('../src/database');
  await new Promise((r) => setTimeout(r, 1500));
  const {
    hospedinAuthService,
  } = require('../src/integrations/hospedin/services/HospedinAuthService');
  const {
    hospedinApiClient,
  } = require('../src/integrations/hospedin/api/HospedinApiClient');
  const { HospedinReservation } = require('../src/models/HospedinReservation');

  await hospedinAuthService.ensureAuthenticated();
  const accountId = await hospedinAuthService.ensureAccountId();
  const row = await HospedinReservation.findOne({
    where: { reservation_id: 29661017 },
  });
  const p = row.payload_json;
  console.log(
    JSON.stringify(
      {
        guest_id: p?.guest_id,
        guests: p?.guests,
        guest_reservations: p?.guest_reservations,
        main_guest: p?.main_guest,
        guest: p?.guest,
        adults: p?.adults,
        children: p?.children,
        status: p?.status,
        place_id: p?.place_id,
        topKeys: Object.keys(p || {}).slice(0, 40),
      },
      null,
      2
    )
  );

  if (p?.guest_id) {
    const paths = [
      `/api/v2/${accountId}/guests/${p.guest_id}`,
      `/api/v1/${accountId}/guests/${p.guest_id}`,
      `/api/v2/${accountId}/guest/${p.guest_id}`,
    ];
    for (const path of paths) {
      try {
        const r = await hospedinApiClient.get(path);
        console.log('OK', path, JSON.stringify(r.data).slice(0, 800));
        break;
      } catch (e) {
        console.log('FAIL', path, e?.response?.status || e?.message);
      }
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
