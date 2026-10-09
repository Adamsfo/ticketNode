import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    linhaPrevisaoCheckoutNaData,
    montarPrevisaoLimpezaSuites,
    reservaValidaPrevisaoLimpeza,
    type LinhaPrevisaoLimpezaInput,
} from './eventoSuiteLimpezaPrevisaoService';

function linha(
    partial: Partial<LinhaPrevisaoLimpezaInput> & {
        idEventoSuite: number;
        idReservaSuite: number;
        idReservaHospedagem: number;
    }
): LinhaPrevisaoLimpezaInput {
    return {
        nomeSuite: partial.nomeSuite ?? `Suite ${partial.idEventoSuite}`,
        eventoNome: partial.eventoNome ?? 'Evento',
        hospede: partial.hospede ?? 'Hóspede',
        checkin: partial.checkin ?? '2026-10-08T19:00:00.000Z',
        checkout: partial.checkout ?? '2026-10-09T16:00:00.000Z',
        statusReservaHospedagem:
            partial.statusReservaHospedagem ?? 'Hospedada',
        statusReservaSuite: partial.statusReservaSuite ?? 'Hospedada',
        ...partial,
    };
}

describe('eventoSuiteLimpezaPrevisaoService', () => {
    it('exclui reserva cancelada', () => {
        assert.equal(
            reservaValidaPrevisaoLimpeza('Cancelada', 'Hospedada'),
            false
        );
        assert.equal(
            reservaValidaPrevisaoLimpeza('Hospedada', 'Cancelada'),
            false
        );
    });

    it('checkout sem novo check-in na data', () => {
        const data = '2026-10-09';
        const rows = [
            linha({
                idEventoSuite: 10,
                idReservaSuite: 1,
                idReservaHospedagem: 100,
                checkout: '2026-10-09T16:00:00.000Z',
            }),
        ];
        const result = montarPrevisaoLimpezaSuites(rows, data, new Set());
        assert.equal(result.length, 1);
        assert.equal(result[0].prioridade, false);
    });

    it('checkout com novo check-in na mesma data marca prioridade', () => {
        const data = '2026-10-09';
        const rows = [
            linha({
                idEventoSuite: 10,
                idReservaSuite: 1,
                idReservaHospedagem: 100,
                checkout: '2026-10-09T16:00:00.000Z',
            }),
        ];
        const result = montarPrevisaoLimpezaSuites(rows, data, new Set([10]));
        assert.equal(result.length, 1);
        assert.equal(result[0].prioridade, true);
    });

    it('deduplica mesma suíte no mesmo dia', () => {
        const data = '2026-10-09';
        const rows = [
            linha({
                idEventoSuite: 10,
                idReservaSuite: 1,
                idReservaHospedagem: 100,
                checkout: '2026-10-09T16:00:00.000Z',
            }),
            linha({
                idEventoSuite: 10,
                idReservaSuite: 2,
                idReservaHospedagem: 101,
                checkout: '2026-10-09T16:00:00.000Z',
            }),
        ];
        const result = montarPrevisaoLimpezaSuites(rows, data, new Set());
        assert.equal(result.length, 1);
        assert.equal(result[0].idReservaSuite, 2);
    });

    it('não inclui checkout de outro dia', () => {
        const data = '2026-10-10';
        const rows = [
            linha({
                idEventoSuite: 10,
                idReservaSuite: 1,
                idReservaHospedagem: 100,
                checkout: '2026-10-09T16:00:00.000Z',
            }),
        ];
        const result = montarPrevisaoLimpezaSuites(rows, data, new Set());
        assert.equal(result.length, 0);
    });

    it('linhaPrevisaoCheckoutNaData usa relação civil dia_checkout', () => {
        assert.equal(
            linhaPrevisaoCheckoutNaData(
                {
                    checkin: '2026-10-08T19:00:00.000Z',
                    checkout: '2026-10-09T16:00:00.000Z',
                },
                '2026-10-09'
            ),
            true
        );
    });
});
