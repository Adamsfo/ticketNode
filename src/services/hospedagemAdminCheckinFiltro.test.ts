/**
 * Filtro da aba Suítes → Check-in (checkin_hoje).
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/services/hospedagemAdminCheckinFiltro.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filtrarCardsOperacionais } from './hospedagemAdminService';

type CardMin = {
    id: number;
    status: 'CheckInHoje' | 'CheckOutHoje' | 'Livre' | 'Hospedada';
    checkinHoje?: boolean;
    checkoutHoje?: boolean;
    bloqueadaPorCheckinNaData?: boolean;
};

function card(partial: CardMin): CardMin {
    return partial;
}

describe('filtrarCardsOperacionais — checkin_hoje', () => {
    it('1. check-in 04/09 + checkout 05/09 → aparece (possuiCheckinNaData)', () => {
        const cards = [
            card({
                id: 1,
                status: 'CheckInHoje',
                checkinHoje: true,
                bloqueadaPorCheckinNaData: true,
            }),
        ];
        const out = filtrarCardsOperacionais(cards, 'checkin_hoje');
        assert.equal(out.length, 1);
        assert.equal(out[0].id, 1);
    });

    it('2. check-in 04/09 + checkout 04/09 → aparece mesmo com badge CHECKOUT_HOJE', () => {
        const cards = [
            card({
                id: 2,
                status: 'CheckOutHoje',
                checkinHoje: false,
                checkoutHoje: true,
                bloqueadaPorCheckinNaData: true,
            }),
        ];
        const out = filtrarCardsOperacionais(cards, 'checkin_hoje');
        assert.equal(out.length, 1);
        assert.equal(out[0].id, 2);
    });

    it('3. checkout 04/09 + check-in 03/09 → não aparece em 04/09', () => {
        const cards = [
            card({
                id: 3,
                status: 'CheckOutHoje',
                checkoutHoje: true,
                bloqueadaPorCheckinNaData: false,
            }),
        ];
        const out = filtrarCardsOperacionais(cards, 'checkin_hoje');
        assert.equal(out.length, 0);
    });

    it('4. check-in 05/09 consultando 04/09 → não aparece', () => {
        const cards = [
            card({
                id: 4,
                status: 'Livre',
                bloqueadaPorCheckinNaData: false,
            }),
        ];
        const out = filtrarCardsOperacionais(cards, 'checkin_hoje');
        assert.equal(out.length, 0);
    });

    it('badge CHECKIN_HOJE sem bloqueadaPorCheckinNaData → não aparece', () => {
        const cards = [
            card({
                id: 5,
                status: 'CheckInHoje',
                checkinHoje: true,
                bloqueadaPorCheckinNaData: false,
            }),
        ];
        const out = filtrarCardsOperacionais(cards, 'checkin_hoje');
        assert.equal(out.length, 0);
    });
});
