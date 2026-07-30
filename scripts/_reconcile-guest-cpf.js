/**
 * Reconcilia "HÓSPEDE SEM CPF" → Usuario real quando há CPF em ReservaHospedeDocumento.
 *
 * Uso:
 *   node scripts/_reconcile-guest-cpf.js
 *   node scripts/_reconcile-guest-cpf.js --dry-run
 *   node scripts/_reconcile-guest-cpf.js --limit=200
 *   node scripts/_reconcile-guest-cpf.js --id=12345
 */
require('dotenv').config();
require('ts-node/register/transpile-only');

(async () => {
  require('../src/database');
  await new Promise((r) => setTimeout(r, 1500));

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const idArg = args.find((a) => a.startsWith('--id='));

  const {
    reconcileGuestCpfFromDocuments,
  } = require('../src/integrations/hospedin/services/GuestCpfReconcileService');

  const result = await reconcileGuestCpfFromDocuments({
    dryRun,
    limit: limitArg ? Number(limitArg.split('=')[1]) : 500,
    idReservaHospedagem: idArg ? Number(idArg.split('=')[1]) : undefined,
  });

  console.log(
    JSON.stringify(
      {
        dryRun,
        scanned: result.scanned,
        upgraded: result.upgraded,
        skipped: result.skipped,
        failures: result.failures,
        sample: result.items.filter((i) => i.upgraded).slice(0, 20),
      },
      null,
      2
    )
  );

  process.exit(result.failures > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
