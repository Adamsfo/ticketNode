/**
 * Testes — ReservationNotificationPolicy
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    isInternalReservationOrigin,
    shouldSendAutomaticConfirmation,
} from './ReservationNotificationPolicy';

describe('shouldSendAutomaticConfirmation', () => {
    it('permite origens internas do PMS', () => {
        for (const origem of [
            'CLIENTE',
            'ATENDENTE',
            'SITE',
            'LINK_CLIENTE',
            'JANGO',
            'cliente',
            'Atendente',
        ]) {
            assert.equal(
                shouldSendAutomaticConfirmation(origem),
                true,
                origem
            );
        }
    });

    it('bloqueia providers / origens externas', () => {
        for (const origem of [
            'HOSPEDIN',
            'BOOKING_API',
            'AIRBNB',
            'OMNIBEES',
            'BOOKING',
            'EXPEDIA',
        ]) {
            assert.equal(
                shouldSendAutomaticConfirmation(origem),
                false,
                origem
            );
        }
    });

    it('aceita objeto reserva', () => {
        assert.equal(
            shouldSendAutomaticConfirmation({ origemReserva: 'HOSPEDIN' }),
            false
        );
        assert.equal(
            shouldSendAutomaticConfirmation({ origemReserva: 'ATENDENTE' }),
            true
        );
    });

    it('origem vazia/null → interna (legado)', () => {
        assert.equal(shouldSendAutomaticConfirmation(null), true);
        assert.equal(shouldSendAutomaticConfirmation(undefined), true);
        assert.equal(shouldSendAutomaticConfirmation(''), true);
        assert.equal(isInternalReservationOrigin(null), true);
    });
});
