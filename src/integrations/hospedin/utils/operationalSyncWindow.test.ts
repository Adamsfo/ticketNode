import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fromZonedTime } from 'date-fns-tz';
import { TZ_HOSPEDAGEM } from '../../../utils/reservaSuiteUtils';
import {
    formatCheckinMinuteKey,
    isCheckinAfterNow,
    isCheckoutAfterNow,
    isWithinOperationalSyncWindow,
} from './operationalSyncWindow';

describe('isCheckinAfterNow (America/Cuiaba, minuto)', () => {
    const now = fromZonedTime('2026-09-26T03:26:30', TZ_HOSPEDAGEM);

    it('check-in passado no mesmo dia → não processa', () => {
        const checkin = fromZonedTime('2026-09-26T03:00:00', TZ_HOSPEDAGEM);
        assert.equal(isCheckinAfterNow(checkin, now), false);
    });

    it('check-in exatamente no minuto atual → não processa', () => {
        const checkin = fromZonedTime('2026-09-26T03:26:00', TZ_HOSPEDAGEM);
        assert.equal(isCheckinAfterNow(checkin, now), false);
    });

    it('check-in 1 minuto no futuro → processa', () => {
        const checkin = fromZonedTime('2026-09-26T03:27:00', TZ_HOSPEDAGEM);
        assert.equal(isCheckinAfterNow(checkin, now), true);
    });

    it('check-in mais tarde no dia → processa', () => {
        const checkin = fromZonedTime('2026-09-26T10:00:00', TZ_HOSPEDAGEM);
        assert.equal(isCheckinAfterNow(checkin, now), true);
    });

    it('check-in amanhã → processa', () => {
        const checkin = fromZonedTime('2026-09-27T00:00:00', TZ_HOSPEDAGEM);
        assert.equal(isCheckinAfterNow(checkin, now), true);
    });

    it('isWithinOperationalSyncWindow delega à mesma regra', () => {
        const past = fromZonedTime('2026-09-26T03:00:00', TZ_HOSPEDAGEM);
        const future = fromZonedTime('2026-09-26T03:27:00', TZ_HOSPEDAGEM);
        assert.equal(isWithinOperationalSyncWindow(past, null, undefined, now), false);
        assert.equal(isWithinOperationalSyncWindow(future, null, undefined, now), true);
    });

    it('formatCheckinMinuteKey usa fuso hospedagem', () => {
        const d = fromZonedTime('2026-09-26T03:27:00', TZ_HOSPEDAGEM);
        assert.equal(formatCheckinMinuteKey(d), '2026-09-26 03:27');
    });
});

describe('isCheckoutAfterNow', () => {
    const now = fromZonedTime('2026-09-26T03:26:30', TZ_HOSPEDAGEM);

    it('checkout no minuto atual → não', () => {
        const checkout = fromZonedTime('2026-09-26T03:26:00', TZ_HOSPEDAGEM);
        assert.equal(isCheckoutAfterNow(checkout, now), false);
    });

    it('checkout futuro → sim', () => {
        const checkout = fromZonedTime('2026-09-28T12:00:00', TZ_HOSPEDAGEM);
        assert.equal(isCheckoutAfterNow(checkout, now), true);
    });
});
