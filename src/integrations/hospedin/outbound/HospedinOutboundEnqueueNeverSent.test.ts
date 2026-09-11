/**
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/outbound/HospedinOutboundEnqueueNeverSent.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { outboundEnqueueTestHelpers } from './HospedinOutboundEnqueueService';

function suite(input: {
    id: number;
    hospedinReservationId?: string | null;
}) {
    return {
        id: input.id,
        idEventoSuite: input.id,
        adultos: 2,
        criancas: 0,
        hospedinReservationId: input.hospedinReservationId ?? null,
    };
}

describe('resolveNeverSent — CREATE vs UPDATE', () => {
    it('TESTE 1 — uma suíte: compat legado com idExterno', () => {
        const hospedagem = {
            idExterno: '304111',
            ReservaSuite: [suite({ id: 10 })],
        } as any;

        assert.equal(
            outboundEnqueueTestHelpers.resolveNeverSent(hospedagem, null),
            false
        );
        assert.equal(
            outboundEnqueueTestHelpers.hasHospedinLink(hospedagem, null),
            true
        );
    });

    it('TESTE 1b — uma suíte sem vínculo e sem legado → CREATE', () => {
        const hospedagem = {
            idExterno: null,
            ReservaSuite: [suite({ id: 10 })],
        } as any;

        assert.equal(
            outboundEnqueueTestHelpers.resolveNeverSent(hospedagem, null),
            true
        );
    });

    it('TESTE 1c — uma suíte com hospedinReservationId → já enviada', () => {
        const hospedagem = {
            idExterno: null,
            ReservaSuite: [suite({ id: 10, hospedinReservationId: '304111' })],
        } as any;

        assert.equal(
            outboundEnqueueTestHelpers.resolveNeverSent(hospedagem, null),
            false
        );
    });

    it('TESTE 4 — multi-suíte: suíte B sem ID → never sent (CREATE)', () => {
        const hospedagem = {
            idExterno: '304111',
            ReservaSuite: [
                suite({ id: 10, hospedinReservationId: '304111' }),
                suite({ id: 11, hospedinReservationId: null }),
            ],
        } as any;

        assert.equal(
            outboundEnqueueTestHelpers.resolveNeverSent(hospedagem, {
                hospedin_reservation_id: '304111',
            } as any),
            true
        );
    });

    it('TESTE 5 — duas suítes sincronizadas → não é never sent', () => {
        const hospedagem = {
            idExterno: '304111',
            ReservaSuite: [
                suite({ id: 10, hospedinReservationId: '304111' }),
                suite({ id: 11, hospedinReservationId: '304222' }),
            ],
        } as any;

        assert.equal(
            outboundEnqueueTestHelpers.resolveNeverSent(hospedagem, {
                hospedin_reservation_id: '304111',
            } as any),
            false
        );
    });

    it('TESTE 5b — multi-suíte: idExterno sozinho não basta para considerar envio completo', () => {
        const hospedagem = {
            idExterno: '304111',
            ReservaSuite: [
                suite({ id: 10, hospedinReservationId: '304111' }),
                suite({ id: 11, hospedinReservationId: null }),
            ],
        } as any;

        assert.equal(
            outboundEnqueueTestHelpers.resolveNeverSent(hospedagem, null),
            true,
            'resolveNeverSent exige hospedinReservationId em todas as suítes'
        );
    });
});

describe('hasAnyHospedinReservationToCancel — enqueue CANCEL', () => {
    it('TESTE 9 — 2 suítes sincronizadas → deve enfileirar CANCEL', () => {
        const hospedagem = {
            idExterno: '304111',
            ReservaSuite: [
                suite({ id: 10, hospedinReservationId: '111' }),
                suite({ id: 11, hospedinReservationId: '222' }),
            ],
        } as any;

        assert.equal(
            outboundEnqueueTestHelpers.hasAnyHospedinReservationToCancel(
                hospedagem,
                { hospedin_reservation_id: '304111' } as any
            ),
            true
        );
    });

    it('TESTE 10 — parcial A=111, B=NULL → deve enfileirar CANCEL', () => {
        const hospedagem = {
            idExterno: null,
            ReservaSuite: [
                suite({ id: 10, hospedinReservationId: '111' }),
                suite({ id: 11, hospedinReservationId: null }),
            ],
        } as any;

        assert.equal(
            outboundEnqueueTestHelpers.hasAnyHospedinReservationToCancel(
                hospedagem,
                null
            ),
            true
        );
    });

    it('TESTE D — sem IDs e sem legado → não enfileira', () => {
        const hospedagem = {
            idExterno: null,
            ReservaSuite: [
                suite({ id: 10, hospedinReservationId: null }),
                suite({ id: 11, hospedinReservationId: null }),
            ],
        } as any;

        assert.equal(
            outboundEnqueueTestHelpers.hasAnyHospedinReservationToCancel(
                hospedagem,
                null
            ),
            false
        );
    });

    it('legado 1 suíte somente idExterno → deve enfileirar CANCEL', () => {
        const hospedagem = {
            idExterno: '304111',
            ReservaSuite: [suite({ id: 10, hospedinReservationId: null })],
        } as any;

        assert.equal(
            outboundEnqueueTestHelpers.hasAnyHospedinReservationToCancel(
                hospedagem,
                null
            ),
            true
        );
    });
});
