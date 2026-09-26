import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fromZonedTime } from 'date-fns-tz';
import { TZ_HOSPEDAGEM } from '../../../utils/reservaSuiteUtils';
import { HospedinOutboundDesiredAction } from '../../../models/HospedinOutboundSyncState';
import { isOutboundOperationEligible } from './hospedinOutboundOperationalEligibility';

describe('isOutboundOperationEligible', () => {
    const now = fromZonedTime('2026-09-26T03:26:30', TZ_HOSPEDAGEM);
    const pastCheckin = fromZonedTime('2026-09-25T16:00:00', TZ_HOSPEDAGEM);
    const futureCheckin = fromZonedTime('2026-09-27T16:00:00', TZ_HOSPEDAGEM);
    const futureCheckout = fromZonedTime('2026-09-28T12:00:00', TZ_HOSPEDAGEM);
    const pastCheckout = fromZonedTime('2026-09-25T12:00:00', TZ_HOSPEDAGEM);

    it('CREATE com check-in passado → não elegível', () => {
        assert.equal(
            isOutboundOperationEligible({
                desiredAction: HospedinOutboundDesiredAction.CREATE,
                checkin: pastCheckin,
                checkout: futureCheckout,
                now,
            }),
            false
        );
    });

    it('CREATE com check-in futuro → elegível', () => {
        assert.equal(
            isOutboundOperationEligible({
                desiredAction: HospedinOutboundDesiredAction.CREATE,
                checkin: futureCheckin,
                checkout: futureCheckout,
                now,
            }),
            true
        );
    });

    it('UPDATE com check-in passado mas checkout futuro → elegível', () => {
        assert.equal(
            isOutboundOperationEligible({
                desiredAction: HospedinOutboundDesiredAction.UPDATE,
                checkin: pastCheckin,
                checkout: futureCheckout,
                now,
            }),
            true
        );
    });

    it('UPDATE com check-in e checkout passados → não elegível', () => {
        assert.equal(
            isOutboundOperationEligible({
                desiredAction: HospedinOutboundDesiredAction.UPDATE,
                checkin: pastCheckin,
                checkout: pastCheckout,
                now,
            }),
            false
        );
    });

    it('CANCEL com check-in passado → elegível', () => {
        assert.equal(
            isOutboundOperationEligible({
                desiredAction: HospedinOutboundDesiredAction.CANCEL,
                checkin: pastCheckin,
                checkout: pastCheckout,
                now,
            }),
            true
        );
    });

    it('retry PENDING_CREATE com check-in passado → não elegível (não reenvia CREATE)', () => {
        assert.equal(
            isOutboundOperationEligible({
                desiredAction: null,
                outboundStatus: 'PENDING_CREATE',
                checkin: pastCheckin,
                checkout: futureCheckout,
                now,
            }),
            false
        );
    });

    it('retry PENDING_CANCEL com estadia encerrada → ainda elegível', () => {
        assert.equal(
            isOutboundOperationEligible({
                desiredAction: null,
                outboundStatus: 'PENDING_CANCEL',
                checkin: pastCheckin,
                checkout: pastCheckout,
                now,
            }),
            true
        );
    });
});
