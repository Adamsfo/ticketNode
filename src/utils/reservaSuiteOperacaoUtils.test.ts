import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StatusReservaSuite } from '../models/ReservaSuite';
import { StatusReservaHospedagem } from '../models/ReservaHospedagem';
import {
    resolverChegadaLinhaSuite,
    resolverStatusOperacionalLinhaSuite,
    todasLinhasReservaHospedadas,
} from './reservaSuiteOperacaoUtils';

describe('reservaSuiteOperacaoUtils', () => {
    it('multi-suíte: chegada da reserva não libera outra linha', () => {
        const linha = {
            status: StatusReservaSuite.Confirmada,
            dataHoraChegadaReal: null,
            dataHoraCheckinReal: null,
        };
        const reserva = {
            status: StatusReservaHospedagem.Confirmada,
            dataHoraChegadaReal: new Date('2026-09-11T16:00:00Z'),
            dataHoraCheckinReal: null,
        };

        assert.equal(resolverChegadaLinhaSuite(linha, reserva, 2), null);
    });

    it('mono-suíte legada: usa chegada da reserva', () => {
        const data = new Date('2026-09-11T16:00:00Z');
        const linha = {
            status: StatusReservaSuite.Confirmada,
            dataHoraChegadaReal: null,
            dataHoraCheckinReal: null,
        };
        const reserva = {
            status: StatusReservaHospedagem.Confirmada,
            dataHoraChegadaReal: data,
            dataHoraCheckinReal: null,
        };

        assert.equal(resolverChegadaLinhaSuite(linha, reserva, 1)?.getTime(), data.getTime());
    });

    it('status operacional por linha em multi-suíte', () => {
        const hospedada = {
            status: StatusReservaSuite.Hospedada,
            dataHoraChegadaReal: new Date(),
            dataHoraCheckinReal: new Date(),
        };
        const confirmada = {
            status: StatusReservaSuite.Confirmada,
            dataHoraChegadaReal: null,
            dataHoraCheckinReal: null,
        };
        const reserva = {
            status: StatusReservaHospedagem.Hospedada,
            dataHoraChegadaReal: new Date(),
            dataHoraCheckinReal: new Date(),
        };

        assert.equal(
            resolverStatusOperacionalLinhaSuite(hospedada, reserva, 2),
            'Hospedada'
        );
        assert.equal(
            resolverStatusOperacionalLinhaSuite(confirmada, reserva, 2),
            'Confirmada'
        );
    });

    it('todasLinhasReservaHospedadas', () => {
        assert.equal(
            todasLinhasReservaHospedadas([
                { status: StatusReservaSuite.Hospedada },
                { status: StatusReservaSuite.Hospedada },
            ]),
            true
        );
        assert.equal(
            todasLinhasReservaHospedadas([
                { status: StatusReservaSuite.Hospedada },
                { status: StatusReservaSuite.Confirmada },
            ]),
            false
        );
    });
});
