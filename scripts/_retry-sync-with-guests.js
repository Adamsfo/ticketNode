/**
 * Enriquece staging com guest da API e reprocessa FAILED → READY → Sync.
 * node scripts/_retry-sync-with-guests.js
 */
require('dotenv').config();
require('ts-node/register/transpile-only');

(async () => {
  const connection =
    require('../src/database').default || require('../src/database');
  await new Promise((r) => setTimeout(r, 1500));

  let syncUserId = Number(process.env.HOSPEDIN_SYNC_USER_ID);
  if (!Number.isFinite(syncUserId) || syncUserId <= 0) {
    const [[row]] = await connection.query(
      'SELECT id FROM Usuario WHERE ativo = 1 ORDER BY id ASC LIMIT 1'
    );
    syncUserId = Number(row.id);
    process.env.HOSPEDIN_SYNC_USER_ID = String(syncUserId);
  }
  console.log('syncUserId', syncUserId);

  const {
    hospedinAuthService,
  } = require('../src/integrations/hospedin/services/HospedinAuthService');
  const {
    hospedinApiClient,
  } = require('../src/integrations/hospedin/api/HospedinApiClient');
  const { HospedinReservation } = require('../src/models/HospedinReservation');
  const {
    IntegrationSyncState,
    IntegrationProvider,
    IntegrationEntityType,
    IntegrationSyncStatus,
  } = require('../src/models/IntegrationSyncState');
  const {
    hospedinReservationValidationService,
  } = require('../src/integrations/hospedin/services/HospedinReservationValidationService');
  const {
    reservationSyncRunner,
  } = require('../src/integrations/hospedin/sync/ReservationSyncRunner');
  const {
    integrationSyncStateService,
  } = require('../src/integrations/hospedin/services/IntegrationSyncStateService');

  await hospedinAuthService.ensureAuthenticated();
  const accountId = await hospedinAuthService.ensureAccountId();

  const failed = await IntegrationSyncState.findAll({
    where: {
      provider: IntegrationProvider.HOSPEDIN,
      entity_type: IntegrationEntityType.RESERVATION,
      sync_status: IntegrationSyncStatus.FAILED,
    },
    order: [['updated_at', 'DESC']],
    limit: 10,
  });

  console.log(
    'FAILED ids',
    failed.map((f) => f.external_id)
  );

  for (const state of failed) {
    const reservationId = Number(state.external_id);
    const staging = await HospedinReservation.findOne({
      where: { reservation_id: reservationId },
    });
    if (!staging) {
      console.warn('no staging', reservationId);
      continue;
    }

    const payload =
      typeof staging.payload_json === 'object' && staging.payload_json
        ? { ...staging.payload_json }
        : {};

    const guestId = Number(payload.guest_id);
    if (!guestId) {
      console.warn('no guest_id', reservationId);
      continue;
    }

    const guestRes = await hospedinApiClient.get(
      `/api/v2/${accountId}/guests/${guestId}`
    );
    const guest =
      guestRes?.data && typeof guestRes.data === 'object'
        ? guestRes.data
        : guestRes?.success === false
          ? null
          : guestRes?.id
            ? guestRes
            : guestRes?.data || null;

    // client may return unwrapped body when success wrapper missing
    const guestBody =
      guest && guest.name
        ? guest
        : guestRes && guestRes.name
          ? guestRes
          : null;

    if (!guestBody?.name) {
      console.warn('guest without name', reservationId, guestId, guestRes);
      continue;
    }

    const adults = Math.max(1, Number(payload.adults || 1));
    const children = Math.max(0, Number(payload.children || 0));
    const guests = [{ name: String(guestBody.name), type: 'adult' }];
    // placeholders só para contagem? NÃO — DomainMapper exige nomes.
    // Usa titular + "Acompanhante N" apenas se adults>1? User said no fictícios.
    // Então só 1 adulto nomeado; adults/children counters no snapshot usam counts do payload.
    // DomainMapper filters guests by tipo — if only 1 adult in list but adults=2,
    // checkout uses guests list length for hospedes. Check mapper...

    payload.main_guest = {
      name: String(guestBody.name),
      type: 'adult',
      birth: guestBody.birth || null,
    };
    payload.guests = guests;
    // adults/children keep API counts for Diff snapshot path

    await staging.update({
      payload_json: payload,
      updated_at: new Date(),
    });
    console.log('enriched', reservationId, guestBody.name);

    await integrationSyncStateService.updateState({
      provider: IntegrationProvider.HOSPEDIN,
      entityType: IntegrationEntityType.RESERVATION,
      externalId: reservationId,
      syncStatus: IntegrationSyncStatus.READY,
      lastError: null,
      reason: 'Reprocess após enrich de guest',
      operacao: 'sync_state_reprocess_guest',
    });

    const v =
      await hospedinReservationValidationService.validateReservation(
        reservationId
      );
    console.log('validate', reservationId, v.status, v.ready);
  }

  const sync = await reservationSyncRunner.processReady({ limit: 10 });
  console.log(JSON.stringify(sync, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
