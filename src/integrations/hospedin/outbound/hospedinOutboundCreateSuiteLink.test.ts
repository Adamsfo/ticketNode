/**
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/outbound/hospedinOutboundCreateSuiteLink.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveSuiteExistingHospedinReservationId } from './hospedinOutboundCreateSuiteLink';

describe('resolveSuiteExistingHospedinReservationId', () => {
    it('prioriza hospedinReservationId da linha', () => {
        const id = resolveSuiteExistingHospedinReservationId({
            linha: { id: 10, hospedinReservationId: '1001' } as any,
            suiteIndex: 0,
            suites: [{ id: 10, hospedinReservationId: '1001' } as any],
            reservaIdExterno: '9999',
            queueReservationId: '8888',
        });
        assert.equal(id, '1001');
    });

    it('reserva com 1 suíte usa idExterno legado', () => {
        const id = resolveSuiteExistingHospedinReservationId({
            linha: { id: 10 } as any,
            suiteIndex: 0,
            suites: [{ id: 10 } as any],
            reservaIdExterno: '1001',
            queueReservationId: null,
        });
        assert.equal(id, '1001');
    });

    it('multi-suíte: suíte B não herda idExterno da reserva', () => {
        const suites = [
            { id: 10, hospedinReservationId: '1001' } as any,
            { id: 11 } as any,
        ];
        const id = resolveSuiteExistingHospedinReservationId({
            linha: suites[1],
            suiteIndex: 1,
            suites,
            reservaIdExterno: '1001',
            queueReservationId: null,
        });
        assert.equal(id, null);
    });

    it('multi-suíte: 1ª linha sem ID usa idExterno quando nenhuma suíte tem ID', () => {
        const suites = [{ id: 10 } as any, { id: 11 } as any];
        const id = resolveSuiteExistingHospedinReservationId({
            linha: suites[0],
            suiteIndex: 0,
            suites,
            reservaIdExterno: '1001',
            queueReservationId: null,
        });
        assert.equal(id, '1001');
    });
});
