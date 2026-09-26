import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fromZonedTime } from 'date-fns-tz';
import { Op } from 'sequelize';
import { databaseReady } from '../../../database';
import { TZ_HOSPEDAGEM } from '../../../utils/reservaSuiteUtils';
import {
    IntegrationEntityType,
    IntegrationProvider,
    IntegrationSyncState,
    IntegrationSyncStatus,
} from '../../../models/IntegrationSyncState';
import { HospedinReservation } from '../../../models/HospedinReservation';
import {
    hasPendingFutureInboundSync,
    PENDING_FUTURE_INBOUND_SYNC_SQL,
} from './hospedinInboundWorkProbe';
import { getCheckinSqlExclusiveThreshold } from '../utils/operationalSyncWindow';

const TEST_PREFIX = 910_000_000;

describe('PENDING_FUTURE_INBOUND_SYNC_SQL', () => {
    it('não usa LIMIT 200 nem loop N+1', () => {
        assert.match(PENDING_FUTURE_INBOUND_SYNC_SQL, /JOIN hospedin_reservations/i);
        assert.doesNotMatch(PENDING_FUTURE_INBOUND_SYNC_SQL, /LIMIT 200/i);
    });
});

describe('hasPendingFutureInboundSync (DB)', () => {
    const now = fromZonedTime('2026-09-26T12:00:00', TZ_HOSPEDAGEM);
    const futureCheckin = fromZonedTime('2026-10-15T14:00:00', TZ_HOSPEDAGEM);
    const pastCheckin = fromZonedTime('2026-09-01T14:00:00', TZ_HOSPEDAGEM);
    const ts = new Date();

    async function cleanupProbeRows(): Promise<void> {
        await HospedinReservation.destroy({
            where: {
                reservation_id: { [Op.gte]: TEST_PREFIX, [Op.lt]: TEST_PREFIX + 1000 },
            },
        });
        await IntegrationSyncState.destroy({
            where: {
                external_id: {
                    [Op.gte]: String(TEST_PREFIX),
                    [Op.lt]: String(TEST_PREFIX + 1000),
                },
            },
        });
    }

    before(async () => {
        await databaseReady;
        await cleanupProbeRows();
    });

    after(async () => {
        await cleanupProbeRows();
    });

    async function seedPair(
        reservationId: number,
        checkin: Date,
        syncStatus: string
    ): Promise<void> {
        await HospedinReservation.create({
            reservation_id: reservationId,
            status: 'confirmed',
            checkin,
            checkout: fromZonedTime('2026-10-20T10:00:00', TZ_HOSPEDAGEM),
            payload_json: { id: reservationId },
            imported_at: ts,
            updated_at: ts,
        });
        await IntegrationSyncState.create({
            provider: IntegrationProvider.HOSPEDIN,
            entity_type: IntegrationEntityType.RESERVATION,
            external_id: String(reservationId),
            correlation_id: `probe-${reservationId}`,
            sync_status: syncStatus,
            resolution_status: 'OPEN',
            created_at: ts,
            updated_at: ts,
        });
    }

    it('A — 201 pendências e futura após 200 passadas → true', async () => {
        await cleanupProbeRows();
        for (let i = 0; i < 200; i += 1) {
            await seedPair(
                TEST_PREFIX + i,
                pastCheckin,
                IntegrationSyncStatus.READY
            );
        }
        await seedPair(
            TEST_PREFIX + 200,
            futureCheckin,
            IntegrationSyncStatus.READY
        );

        const hit = await hasPendingFutureInboundSync(now);
        assert.equal(hit, true);
    });

    it('B — nenhuma pendência futura (só passadas) → false', async () => {
        await cleanupProbeRows();
        await seedPair(
            TEST_PREFIX + 50,
            pastCheckin,
            IntegrationSyncStatus.READY
        );
        assert.equal(await hasPendingFutureInboundSync(now), false);
    });

    it('C — READY futuro → true', async () => {
        await cleanupProbeRows();
        await seedPair(
            TEST_PREFIX + 301,
            futureCheckin,
            IntegrationSyncStatus.READY
        );
        assert.equal(await hasPendingFutureInboundSync(now), true);
    });

    it('D — QUEUED futuro → true', async () => {
        await cleanupProbeRows();
        await seedPair(
            TEST_PREFIX + 302,
            futureCheckin,
            IntegrationSyncStatus.QUEUED
        );
        assert.equal(await hasPendingFutureInboundSync(now), true);
    });

    it('E — FAILED futuro → true', async () => {
        await cleanupProbeRows();
        await seedPair(
            TEST_PREFIX + 303,
            futureCheckin,
            IntegrationSyncStatus.FAILED
        );
        assert.equal(await hasPendingFutureInboundSync(now), true);
    });

    it('F — READY passado → false', async () => {
        await cleanupProbeRows();
        await seedPair(
            TEST_PREFIX + 304,
            pastCheckin,
            IntegrationSyncStatus.READY
        );
        const threshold = getCheckinSqlExclusiveThreshold(now);
        assert.ok(pastCheckin.getTime() <= threshold.getTime());
        assert.equal(await hasPendingFutureInboundSync(now), false);
    });
});
