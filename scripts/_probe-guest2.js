require('dotenv').config();
require('ts-node/register/transpile-only');

(async () => {
  require('../src/database');
  await new Promise((r) => setTimeout(r, 1200));
  const {
    hospedinAuthService,
  } = require('../src/integrations/hospedin/services/HospedinAuthService');
  const {
    hospedinApiClient,
  } = require('../src/integrations/hospedin/api/HospedinApiClient');

  await hospedinAuthService.ensureAuthenticated();
  const accountId = await hospedinAuthService.ensureAccountId();
  const path = `/api/v2/${accountId}/guests/17942028`;
  const r = await hospedinApiClient.get(path);
  console.log('type', typeof r);
  console.log('keys', r && typeof r === 'object' ? Object.keys(r) : null);
  console.log('raw', JSON.stringify(r, null, 2).slice(0, 2000));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
