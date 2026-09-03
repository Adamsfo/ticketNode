import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StatusEventoSuiteLimpeza } from '../models/EventoSuiteLimpeza';
import {
    avaliarLimpezasParaCheckin,
    mensagemLimpezaBloqueiaCheckin,
} from './eventoSuiteLimpezaCheckinService';
import { calcularDisponibilidadeSuite } from './suiteDisponibilidadeService';

describe('avaliarLimpezasParaCheckin', () => {
    it('sem limpeza → check-in permitido', () => {
        assert.deepEqual(avaliarLimpezasParaCheckin([10], []), {
            bloqueado: false,
        });
    });

    it('limpeza Pendente → check-in bloqueado', () => {
        assert.deepEqual(
            avaliarLimpezasParaCheckin(
                [10],
                [{ idEventoSuite: 10, status: StatusEventoSuiteLimpeza.Pendente }]
            ),
            {
                bloqueado: true,
                idEventoSuite: 10,
                status: StatusEventoSuiteLimpeza.Pendente,
            }
        );
    });

    it('limpeza EmAndamento → check-in bloqueado', () => {
        assert.deepEqual(
            avaliarLimpezasParaCheckin(
                [10],
                [
                    {
                        idEventoSuite: 10,
                        status: StatusEventoSuiteLimpeza.EmAndamento,
                    },
                ]
            ),
            {
                bloqueado: true,
                idEventoSuite: 10,
                status: StatusEventoSuiteLimpeza.EmAndamento,
            }
        );
    });

    it('limpeza Concluida → check-in permitido', () => {
        assert.deepEqual(
            avaliarLimpezasParaCheckin(
                [10],
                [{ idEventoSuite: 10, status: StatusEventoSuiteLimpeza.Concluida }]
            ),
            { bloqueado: false }
        );
    });

    it('limpeza aberta em outra suíte não bloqueia', () => {
        assert.deepEqual(
            avaliarLimpezasParaCheckin(
                [10],
                [{ idEventoSuite: 99, status: StatusEventoSuiteLimpeza.Pendente }]
            ),
            { bloqueado: false }
        );
    });
});

describe('mensagemLimpezaBloqueiaCheckin', () => {
    it('informa suíte e fase da limpeza', () => {
        const msg = mensagemLimpezaBloqueiaCheckin(
            10,
            StatusEventoSuiteLimpeza.Pendente,
            'Azaléia'
        );
        assert.match(msg, /Azaléia/);
        assert.match(msg, /limpeza/i);
        assert.match(msg, /pendente/i);
    });
});

describe('disponibilidade inalterada pela limpeza', () => {
    it('SuiteDisponibilidadeService não recebe sinal de limpeza', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-28',
            hoje: '2026-07-28',
            reservas: [
                {
                    id: 1,
                    status: 'Confirmada',
                    checkin: '2026-07-28T16:00:00.000Z',
                    checkout: '2026-07-29T13:00:00.000Z',
                    saldoPendente: 0,
                    dataHoraChegadaReal: '2026-07-28T15:00:00.000Z',
                },
            ],
        });

        assert.equal(r.badge, 'CHECKIN_HOJE');
        assert.equal(r.podeCheckin, true);
        assert.equal(r.podeReservar, false);
    });
});
